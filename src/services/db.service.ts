/**
 * Singleton de conexão `better-sqlite3` para o cache do Tubemind v0.2.
 *
 * Lazy init: a conexão só é aberta na primeira chamada de `getDb()`.
 * Fail-soft: se a DB indisponível (disco cheio, permissão, etc.), retorna `null`
 *   e os callers cacheGet/cacheSet viram no-ops graceful (RNF-1.3).
 *
 * Toggle global: `TUBEMIND_CACHE_ENABLED=false` desliga a DB completamente.
 */

import Database from 'better-sqlite3'
import { auditLog } from '../security/audit.service.js'
import { getDefaultDbPath, initDatabase } from '../cache/migrations.service.js'

let dbInstance: Database.Database | null = null
let initAttempted = false

/**
 * Verifica se o cache está habilitado via env. Default: true.
 */
export function isCacheEnabled(): boolean {
  return process.env['TUBEMIND_CACHE_ENABLED'] !== 'false'
}

/**
 * Retorna a conexão singleton. Lazy init na primeira chamada.
 * Retorna `null` se:
 * - Cache desabilitado via env
 * - Init falhou (erro logado em audit, mas não lança)
 */
export function getDb(): Database.Database | null {
  if (!isCacheEnabled()) return null
  if (dbInstance) return dbInstance
  if (initAttempted) return null // já tentou e falhou, não retentar a cada call

  initAttempted = true
  try {
    dbInstance = initDatabase(getDefaultDbPath())
    return dbInstance
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    void auditLog({
      action: 'CACHE_INIT_FAILED',
      toolName: 'db.service',
      success: false,
      durationMs: 0,
      errorCode: message,
    })
    return null
  }
}

/**
 * Para uso em testes apenas — força fechar e re-iniciar o singleton.
 * Não usar em código de produção.
 */
export function resetDbForTesting(): void {
  if (dbInstance) {
    try {
      dbInstance.close()
    } catch {
      // ignorar (DB pode estar em estado inválido)
    }
  }
  dbInstance = null
  initAttempted = false
}
