/**
 * Migrations idempotentes para o cache SQLite local do Tubemind v0.2.
 *
 * Estratégia:
 * - SQL inline (não lê arquivos em runtime — não dá conflito com tsc + npm publish)
 * - Tabela `_migrations(filename, applied_at)` rastreia o estado
 * - Cada migration roda em transaction (atomicidade)
 * - PRAGMAs aplicados no boot: WAL + synchronous NORMAL + auto_vacuum INCREMENTAL
 * - PRAGMA integrity_check valida saúde da DB; se falhar, lança erro para o caller
 *   decidir entre recriar ou abortar
 *
 * Path default:
 * - Linux/macOS: ~/.tubemind/cache.db
 * - Windows:     %LOCALAPPDATA%\tubemind\cache.db
 * Override via env TUBEMIND_CACHE_PATH.
 *
 * Anti-stub contract: nada de TODO/FIXME aqui. Toda migration listada é SQL real.
 */

import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { mkdirSync, chmodSync, renameSync, existsSync } from 'node:fs'

// ─── Migrations registradas (ordem importa — alfabética por nome) ─────────────

interface Migration {
  readonly name: string
  readonly sql: string
}

const MIGRATIONS: readonly Migration[] = [
  {
    name: '001_create_cache_entries',
    sql: `
      CREATE TABLE IF NOT EXISTS cache_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cache_key TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        payload BLOB NOT NULL,
        payload_size_bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 1,
        tubemind_version TEXT NOT NULL,
        UNIQUE(cache_key)
      );
    `,
  },
  {
    name: '002_create_quota_log',
    sql: `
      CREATE TABLE IF NOT EXISTS quota_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        tool_name TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        units_consumed INTEGER NOT NULL,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        token_hash TEXT NOT NULL,
        success INTEGER NOT NULL DEFAULT 1,
        day_bucket TEXT NOT NULL
      );
    `,
  },
  {
    name: '003_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_cache_token_hash    ON cache_entries(token_hash);
      CREATE INDEX IF NOT EXISTS idx_cache_expires_at    ON cache_entries(expires_at);
      CREATE INDEX IF NOT EXISTS idx_cache_last_accessed ON cache_entries(last_accessed);
      CREATE INDEX IF NOT EXISTS idx_cache_tool_name     ON cache_entries(tool_name);
      CREATE INDEX IF NOT EXISTS idx_quota_day_bucket    ON quota_log(day_bucket);
      CREATE INDEX IF NOT EXISTS idx_quota_token_hash    ON quota_log(token_hash);
      CREATE INDEX IF NOT EXISTS idx_quota_tool_name     ON quota_log(tool_name);
      CREATE INDEX IF NOT EXISTS idx_quota_endpoint      ON quota_log(endpoint);
    `,
  },
]

// ─── Errors ───────────────────────────────────────────────────────────────────

export class MigrationsCorruptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationsCorruptError'
  }
}

export class CachePathTraversalError extends Error {
  constructor(path: string) {
    super(`Cache path inválido (path traversal detectado): ${path}`)
    this.name = 'CachePathTraversalError'
  }
}

// ─── Path resolution ──────────────────────────────────────────────────────────

/**
 * Resolve o caminho default do cache SQLite por plataforma.
 * Linux/macOS: ~/.tubemind/cache.db
 * Windows:     %LOCALAPPDATA%\tubemind\cache.db (fallback para %APPDATA% ou homedir)
 */
export function getDefaultDbPath(): string {
  const envPath = process.env['TUBEMIND_CACHE_PATH']
  if (envPath && envPath.length > 0) {
    assertSafePath(envPath)
    return envPath
  }

  if (process.platform === 'win32') {
    const base = process.env['LOCALAPPDATA'] ?? process.env['APPDATA'] ?? homedir()
    return join(base, 'tubemind', 'cache.db')
  }
  return join(homedir(), '.tubemind', 'cache.db')
}

/**
 * Bloqueia paths com `..` (RS-1.5 — path traversal).
 */
function assertSafePath(path: string): void {
  if (path.includes('..')) throw new CachePathTraversalError(path)
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Abre (ou cria) o DB no path informado, aplica PRAGMAs de durabilidade,
 * roda migrations pendentes e valida integridade.
 *
 * Permissões:
 * - Unix: chmod 600 no arquivo (RS-1.7)
 * - Windows: depende da ACL do diretório do usuário (LOCALAPPDATA é restrito por default)
 */
export function initDatabase(dbPath?: string): Database.Database {
  const finalPath = dbPath ?? getDefaultDbPath()
  assertSafePath(finalPath)

  const dir = dirname(finalPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const db = new Database(finalPath)

  // RS-1.8 — durabilidade + anti-corrupção
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('auto_vacuum = INCREMENTAL')

  // RS-1.7 — restringir permissão em Unix (no-op em Windows)
  if (process.platform !== 'win32') {
    try {
      chmodSync(finalPath, 0o600)
    } catch {
      // arquivos WAL associados podem não existir ainda — não fatal
    }
  }

  runMigrations(db)

  return db
}

// ─── Migrations runner ────────────────────────────────────────────────────────

/**
 * Aplica todas as migrations registradas que ainda não foram executadas.
 * Idempotente: rodar 2x é seguro.
 *
 * Após aplicar, roda PRAGMA integrity_check. Se != 'ok', lança MigrationsCorruptError
 * — o caller decide entre recuperar (mover .corrupted e re-init) ou abortar.
 */
export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `)

  const appliedRows = db
    .prepare('SELECT filename FROM _migrations')
    .all() as Array<{ filename: string }>

  const applied = new Set(appliedRows.map((r) => r.filename))

  const insertMigration = db.prepare(
    'INSERT INTO _migrations (filename, applied_at) VALUES (?, ?)',
  )

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue
    const tx = db.transaction(() => {
      db.exec(migration.sql)
      insertMigration.run(migration.name, Date.now())
    })
    tx()
  }

  const integrity = db.pragma('integrity_check', { simple: true }) as string
  if (integrity !== 'ok') {
    throw new MigrationsCorruptError(`integrity_check failed: ${integrity}`)
  }
}

/**
 * Recupera de uma DB corrompida: fecha conexão atual, move arquivo para .corrupted
 * e re-inicializa. Útil para chamar dentro de catch(MigrationsCorruptError).
 *
 * Retorna o novo Database aberto e migrado.
 */
export function recoverCorruptedDatabase(db: Database.Database, dbPath: string): Database.Database {
  db.close()
  const backup = `${dbPath}.corrupted.${Date.now()}`
  renameSync(dbPath, backup)
  return initDatabase(dbPath)
}

/**
 * Lista das migrations conhecidas (útil para testes e introspecção).
 */
export function listMigrations(): readonly string[] {
  return MIGRATIONS.map((m) => m.name)
}
