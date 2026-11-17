import { appendFile, mkdir } from 'fs/promises'
import { dirname } from 'path'

export type AuditAction =
  // v0.1 tools
  | 'SEARCH_TRENDING'
  | 'GET_KEYWORD_STATS'
  | 'GET_VIDEO_TAGS'
  | 'SUGGEST_TAGS'
  | 'UPDATE_VIDEO_METADATA'
  | 'LIST_CHANNEL_VIDEOS'
  | 'GET_CHANNEL_ANALYTICS'
  | 'GET_COMPETITOR_VIDEOS'
  | 'ESTIMATE_KEYWORD_DIFFICULTY'
  | 'ANALYZE_TITLE_PATTERNS'
  | 'DETECT_CONTENT_GAPS'
  | 'SCORE_BEST_PUBLISH_WINDOW'
  | 'BENCHMARK_CHANNEL'
  | 'ESTIMATE_CTR_POTENTIAL'
  | 'SUGGEST_HOOK_ANGLES'
  | 'FIND_TRENDING_KEYWORDS'
  | 'ANALYZE_RETENTION_SIGNALS'
  | 'GENERATE_CONTENT_CALENDAR'
  | 'OAUTH_INIT'
  | 'OAUTH_CALLBACK'
  | 'TOKEN_REFRESH'
  | 'TOKEN_REVOKE'
  // v0.2 Camada 1 — Cache + Quota
  | 'CACHE_HIT'
  | 'CACHE_MISS'
  | 'CACHE_BYPASS'
  | 'CACHE_EVICT'
  | 'CACHE_INIT_FAILED'
  | 'QUOTA_RECORD'
  | 'QUOTA_THRESHOLD_70'
  | 'QUOTA_THRESHOLD_90'
  | 'GET_QUOTA_USAGE'
  | 'YOUTUBE_BATCH_FETCH'
  // v0.2 Camada 2 — Vision
  | 'VISION_API_CALL'
  | 'ANALYZE_THUMBNAIL_VISUALS'
  | 'SCORE_MY_THUMBNAIL'
  // v0.2 Camada 3 — NLP
  | 'NLP_LLM_CALL'
  | 'ANALYZE_VIDEO_COMMENTS'
  | 'ANALYZE_VIDEO_TRANSCRIPT'
  | 'REVERSE_ENGINEER_VIRAL_VIDEO'
  // v0.2 Camada 4 — Pipeline
  | 'GENERATE_FULL_SCRIPT'
  | 'OPTIMIZE_VIDEO_DESCRIPTION'
  | 'PREDICT_VIDEO_PERFORMANCE'
  | 'RUN_WORKFLOW'
  | 'WORKFLOW_STEP'

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
