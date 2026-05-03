import { appendFile, mkdir } from 'fs/promises'
import { dirname } from 'path'

export type AuditAction =
  | 'SEARCH_TRENDING'
  | 'GET_KEYWORD_STATS'
  | 'GET_VIDEO_TAGS'
  | 'SUGGEST_TAGS'
  | 'UPDATE_VIDEO_METADATA'
  | 'LIST_CHANNEL_VIDEOS'
  | 'GET_CHANNEL_ANALYTICS'
  | 'GET_COMPETITOR_VIDEOS'
  | 'OAUTH_INIT'
  | 'OAUTH_CALLBACK'
  | 'TOKEN_REFRESH'
  | 'TOKEN_REVOKE'

interface AuditEntry {
  timestamp: string
  action: AuditAction
  toolName: string
  success: boolean
  durationMs: number
  errorCode?: string      // NUNCA stack trace em produção
  channelIdHash?: string  // hash do channelId, não o valor real
}

const LOG_PATH = process.env['AUDIT_LOG_PATH'] ?? './logs/audit.log'

async function ensureLogDir(): Promise<void> {
  await mkdir(dirname(LOG_PATH), { recursive: true })
}

export async function auditLog(entry: Omit<AuditEntry, 'timestamp'>): Promise<void> {
  const record: AuditEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  }

  // Nunca logar dados sensíveis
  const line = JSON.stringify(record) + '\n'

  try {
    await ensureLogDir()
    await appendFile(LOG_PATH, line, 'utf-8')
  } catch {
    // Falha silenciosa no log — não deve parar a operação principal
    if (process.env['NODE_ENV'] === 'development') {
      console.error('[audit] Falha ao gravar log:', record.action)
    }
  }
}

export function withAudit<T>(
  action: AuditAction,
  toolName: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now()
  return fn()
    .then(async result => {
      await auditLog({ action, toolName, success: true, durationMs: Date.now() - start })
      return result
    })
    .catch(async (err: unknown) => {
      const errorCode = err instanceof Error ? err.constructor.name : 'UnknownError'
      await auditLog({ action, toolName, success: false, durationMs: Date.now() - start, errorCode })
      throw err
    })
}
