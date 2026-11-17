/**
 * Cache Service — Tubemind v0.2 Camada 1.
 *
 * API pública (fail-soft):
 * - cacheGet<T>(key): T | null
 * - cacheSet<T>(key, value, opts): void
 * - cacheBypass<T>(key, fetcher, opts): T  (força fetcher + re-escreve)
 * - cacheEvictLRU(maxBytes): bytes liberados
 * - cacheStats(): { totalEntries, totalBytes, oldestEntry }
 * - withCache<T>(toolName, params, tokenHash, fetcher, opts): T  (wrapper típico)
 *
 * Garantias:
 * - Isolamento por OAuth token via SHA-256(token) na chave (RS-1.3)
 * - Invalidação automática em upgrade (tubemind_version na chave) (R-1.4)
 * - LRU evict quando size > 100MB (RF-1.4)
 * - Fail-soft: se DB indisponível, get retorna null, set é no-op (RNF-1.3)
 * - Audit log de hit/miss/evict/bypass (RS-1.6)
 */

import { auditLog } from '../security/audit.service.js'
import { getDb, isCacheEnabled } from './db.service.js'
import { sha256 } from '../utils/hash.js'
import {
  CACHE_MAX_SIZE_BYTES,
  CACHE_EVICT_TARGET_FRACTION,
  getTtlSeconds,
} from '../config/cache.config.js'

// ─── Versão usada na chave (invalida cache em upgrade) ────────────────────────
// Mantida em sync com package.json — quando bumpar versão major/minor do MCP,
// entradas antigas ficam inalcançáveis (chave nova diferente) e são limpas via LRU.
const CACHE_KEY_VERSION = '0.2'

interface CacheSetOptions {
  readonly tool: string
  readonly tokenHash: string
  readonly ttlSeconds?: number
}

interface CacheStats {
  totalEntries: number
  totalBytes: number
  oldestEntryUnix: number | null
}

// ─── Key derivation ───────────────────────────────────────────────────────────

/**
 * Computa a chave canonical: SHA-256(tool + paramsJSON + tokenHash + version).
 * Determinística — params devem ser serializáveis e ordem-estável.
 */
export function computeCacheKey(tool: string, params: unknown, tokenHash: string): string {
  const paramsJson = stableStringify(params)
  const raw = `${tool}|${paramsJson}|${tokenHash}|${CACHE_KEY_VERSION}`
  return sha256(raw)
}

/**
 * Serialização determinística (ordenação de chaves) para que `{a:1,b:2}` e
 * `{b:2,a:1}` produzam a mesma chave de cache.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value)
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => JSON.stringify(k) + ':' + stableStringify(v))
  return '{' + entries.join(',') + '}'
}

// ─── Get / Set ────────────────────────────────────────────────────────────────

/**
 * Lê do cache. Retorna `null` em:
 * - Cache desabilitado
 * - DB indisponível
 * - Chave inexistente
 * - TTL expirado (a entry é deletada lazy)
 *
 * Side effects: atualiza last_accessed + access_count em caso de hit (LRU).
 */
export function cacheGet<T>(key: string): T | null {
  const db = getDb()
  if (!db) return null

  const now = Date.now()
  const row = db
    .prepare(
      `SELECT payload, expires_at FROM cache_entries WHERE cache_key = ? AND tubemind_version = ?`,
    )
    .get(key, CACHE_KEY_VERSION) as { payload: Buffer; expires_at: number } | undefined

  if (!row) {
    void auditLog({
      action: 'CACHE_MISS',
      toolName: 'cache.service',
      success: true,
      durationMs: 0,
    })
    return null
  }

  if (row.expires_at <= now) {
    // Expirou — limpa lazy
    db.prepare('DELETE FROM cache_entries WHERE cache_key = ?').run(key)
    void auditLog({
      action: 'CACHE_MISS',
      toolName: 'cache.service',
      success: true,
      durationMs: 0,
    })
    return null
  }

  // Hit — atualiza LRU metadata
  db.prepare(
    `UPDATE cache_entries SET last_accessed = ?, access_count = access_count + 1 WHERE cache_key = ?`,
  ).run(now, key)

  void auditLog({
    action: 'CACHE_HIT',
    toolName: 'cache.service',
    success: true,
    durationMs: 0,
  })

  try {
    return JSON.parse(row.payload.toString('utf-8')) as T
  } catch {
    // Payload corrompido — descarta e trata como miss
    db.prepare('DELETE FROM cache_entries WHERE cache_key = ?').run(key)
    return null
  }
}

/**
 * Escreve no cache. No-op se cache desabilitado ou DB indisponível.
 * Dispara eviction LRU se size > CACHE_MAX_SIZE_BYTES após o insert.
 *
 * Idempotência: chamada repetida com mesma key faz UPSERT.
 */
export function cacheSet<T>(key: string, value: T, opts: CacheSetOptions): void {
  const db = getDb()
  if (!db) return

  const payload = Buffer.from(JSON.stringify(value), 'utf-8')
  const now = Date.now()
  const ttlSeconds = opts.ttlSeconds ?? getTtlSeconds(opts.tool)
  const expiresAt = now + ttlSeconds * 1000

  db.prepare(
    `INSERT INTO cache_entries
      (cache_key, tool_name, token_hash, payload, payload_size_bytes, created_at, expires_at, last_accessed, access_count, tubemind_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
      payload = excluded.payload,
      payload_size_bytes = excluded.payload_size_bytes,
      expires_at = excluded.expires_at,
      last_accessed = excluded.last_accessed,
      access_count = 1`,
  ).run(
    key,
    opts.tool,
    opts.tokenHash,
    payload,
    payload.length,
    now,
    expiresAt,
    now,
    CACHE_KEY_VERSION,
  )

  // LRU eviction se passar do cap
  const sizeRow = db
    .prepare('SELECT COALESCE(SUM(payload_size_bytes), 0) as total FROM cache_entries')
    .get() as { total: number }

  if (sizeRow.total > CACHE_MAX_SIZE_BYTES) {
    cacheEvictLRU(CACHE_MAX_SIZE_BYTES * (1 - CACHE_EVICT_TARGET_FRACTION))
  }
}

/**
 * Força execução do fetcher (ignora cache) e re-escreve o resultado.
 * Útil quando o usuário passa `fresh: true`.
 */
export async function cacheBypass<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: CacheSetOptions,
): Promise<T> {
  void auditLog({
    action: 'CACHE_BYPASS',
    toolName: 'cache.service',
    success: true,
    durationMs: 0,
  })
  const result = await fetcher()
  cacheSet(key, result, opts)
  return result
}

// ─── Eviction ─────────────────────────────────────────────────────────────────

/**
 * LRU eviction: remove entries com `last_accessed` mais antigo até que
 * o tamanho total seja <= targetBytes.
 *
 * Retorna o número de bytes efetivamente liberados.
 */
export function cacheEvictLRU(targetBytes: number): number {
  const db = getDb()
  if (!db) return 0

  const bytesBefore =
    (db.prepare('SELECT COALESCE(SUM(payload_size_bytes), 0) as t FROM cache_entries').get() as {
      t: number
    }).t

  if (bytesBefore <= targetBytes) return 0

  // Itera removendo em batches de 50 entries até atingir o target
  let bytesNow = bytesBefore
  let totalEvicted = 0

  while (bytesNow > targetBytes) {
    const batch = db
      .prepare(
        `SELECT id, payload_size_bytes FROM cache_entries ORDER BY last_accessed ASC LIMIT 50`,
      )
      .all() as Array<{ id: number; payload_size_bytes: number }>

    if (batch.length === 0) break

    const ids = batch.map((b) => b.id)
    const batchBytes = batch.reduce((s, b) => s + b.payload_size_bytes, 0)
    const placeholders = ids.map(() => '?').join(',')
    db.prepare(`DELETE FROM cache_entries WHERE id IN (${placeholders})`).run(...ids)

    bytesNow -= batchBytes
    totalEvicted += batchBytes
  }

  void auditLog({
    action: 'CACHE_EVICT',
    toolName: 'cache.service',
    success: true,
    durationMs: 0,
    errorCode: `freed:${totalEvicted}bytes`,
  })

  return totalEvicted
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export function cacheStats(): CacheStats {
  const db = getDb()
  if (!db) return { totalEntries: 0, totalBytes: 0, oldestEntryUnix: null }

  const row = db
    .prepare(
      `SELECT COUNT(*) as entries, COALESCE(SUM(payload_size_bytes), 0) as bytes, MIN(created_at) as oldest
       FROM cache_entries`,
    )
    .get() as { entries: number; bytes: number; oldest: number | null }

  return {
    totalEntries: row.entries,
    totalBytes: row.bytes,
    oldestEntryUnix: row.oldest,
  }
}

// ─── withCache wrapper ────────────────────────────────────────────────────────

interface WithCacheOptions {
  readonly fresh?: boolean
  readonly ttlSeconds?: number
}

/**
 * Wrapper típico para tools: lê do cache (se hit retorna direto), senão
 * executa fetcher e escreve no cache antes de retornar.
 *
 * Se `fresh: true`, sempre executa fetcher (bypass).
 * Se cache desabilitado/DB indisponível, executa fetcher direto (sem persistir).
 */
export async function withCache<T>(
  toolName: string,
  params: unknown,
  tokenHash: string,
  fetcher: () => Promise<T>,
  options: WithCacheOptions = {},
): Promise<T> {
  // Se cache desabilitado, executa direto (não tenta nem computar key)
  if (!isCacheEnabled()) return fetcher()

  const key = computeCacheKey(toolName, params, tokenHash)
  const setOpts: CacheSetOptions = {
    tool: toolName,
    tokenHash,
    ...(options.ttlSeconds !== undefined ? { ttlSeconds: options.ttlSeconds } : {}),
  }

  if (options.fresh) {
    return cacheBypass(key, fetcher, setOpts)
  }

  const hit = cacheGet<T>(key)
  if (hit !== null) return hit

  const result = await fetcher()
  cacheSet(key, result, setOpts)
  return result
}
