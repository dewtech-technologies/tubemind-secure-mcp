/**
 * Quota Tracker — Tubemind v0.2 Camada 1.
 *
 * Persiste cada chamada de API externa em `quota_log` (SQLite) com:
 * - units consumidas (YouTube quota) OU custo USD (Anthropic)
 * - day_bucket (YYYY-MM-DD) para reset diário automático
 * - token_hash (isolamento por OAuth)
 *
 * Dispara warnings/errors no audit log ao atingir 70% / 90% do limite diário.
 *
 * Falha graceful: se DB indisponível, record() vira no-op (não bloqueia tools).
 */

import { auditLog } from '../security/audit.service.js'
import { getDb } from './db.service.js'
import { getQuotaCost, YOUTUBE_DAILY_LIMIT } from '../config/youtube-quota-costs.js'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type Period = 'today' | 'week' | 'month'

export interface UsageReport {
  period: Period
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  totalYouTubeUnits: number
  totalAnthropicCostUsd: number
  youtubeLimit: number
  youtubePercent: number
  byTool: Array<{
    toolName: string
    calls: number
    units: number
    costUsd: number
  }>
  byEndpoint: Array<{
    endpoint: string
    calls: number
    units: number
    costUsd: number
  }>
}

// ─── Day bucket helpers ───────────────────────────────────────────────────────

function getDayBucket(date: Date = new Date()): string {
  // YYYY-MM-DD em UTC para consistência cross-timezone
  return date.toISOString().split('T')[0] as string
}

function getDayBucketsForPeriod(period: Period, now: Date = new Date()): string[] {
  const today = getDayBucket(now)
  if (period === 'today') return [today]

  const days = period === 'week' ? 7 : 30
  const result: string[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    result.push(getDayBucket(d))
  }
  return result
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Registra uma chamada de API. Sempre seguro chamar (no-op se DB off).
 *
 * @param endpoint  ex: 'youtube:search.list', 'anthropic:haiku'
 * @param tokenHash hash SHA-256 do OAuth token (de cache.service.computeCacheKey contexto)
 * @param toolName  nome da tool MCP que originou a chamada
 * @param options.units      override do custo em units (default = QUOTA_COSTS lookup)
 * @param options.costUsd    custo monetário (Anthropic) — default 0
 * @param options.success    flag — default true
 */
export function recordQuota(
  endpoint: string,
  tokenHash: string,
  toolName: string,
  options: { units?: number; costUsd?: number; success?: boolean } = {},
): void {
  const db = getDb()
  if (!db) return

  const units = options.units ?? getQuotaCost(endpoint)
  const costUsd = options.costUsd ?? 0
  const success = options.success !== false
  const dayBucket = getDayBucket()
  const ts = Date.now()

  db.prepare(
    `INSERT INTO quota_log
      (timestamp, tool_name, endpoint, units_consumed, estimated_cost_usd, token_hash, success, day_bucket)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(ts, toolName, endpoint, units, costUsd, tokenHash, success ? 1 : 0, dayBucket)

  // Thresholds só fazem sentido para YouTube quota (Anthropic tem cap separado)
  if (endpoint.startsWith('youtube:')) {
    checkThresholds(tokenHash, dayBucket)
  }
}

/**
 * Soma units do dia para um token; emite warn/error se ultrapassou thresholds.
 * No-op se DB indisponível.
 */
export function checkThresholds(tokenHash: string, dayBucket: string = getDayBucket()): void {
  const db = getDb()
  if (!db) return

  const row = db
    .prepare(
      `SELECT COALESCE(SUM(units_consumed), 0) as total
       FROM quota_log
       WHERE day_bucket = ? AND token_hash = ? AND endpoint LIKE 'youtube:%'`,
    )
    .get(dayBucket, tokenHash) as { total: number }

  const totalUnits = row.total
  const pct = (totalUnits / YOUTUBE_DAILY_LIMIT) * 100

  if (pct >= 90) {
    void auditLog({
      action: 'QUOTA_THRESHOLD_90',
      toolName: 'quota.service',
      success: false,
      durationMs: 0,
      errorCode: `pct:${pct.toFixed(1)},units:${totalUnits}`,
    })
  } else if (pct >= 70) {
    void auditLog({
      action: 'QUOTA_THRESHOLD_70',
      toolName: 'quota.service',
      success: true,
      durationMs: 0,
      errorCode: `pct:${pct.toFixed(1)},units:${totalUnits}`,
    })
  }
}

/**
 * Retorna o relatório de uso para o período solicitado, isolado por token.
 */
export function getUsage(period: Period, tokenHash: string): UsageReport {
  const db = getDb()
  const buckets = getDayBucketsForPeriod(period)
  const sortedBuckets = [...buckets].sort()
  const startDate = sortedBuckets[0] ?? getDayBucket()
  const endDate = sortedBuckets[sortedBuckets.length - 1] ?? getDayBucket()

  if (!db) {
    return {
      period,
      startDate,
      endDate,
      totalYouTubeUnits: 0,
      totalAnthropicCostUsd: 0,
      youtubeLimit: YOUTUBE_DAILY_LIMIT,
      youtubePercent: 0,
      byTool: [],
      byEndpoint: [],
    }
  }

  const placeholders = buckets.map(() => '?').join(',')

  const totalsRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN endpoint LIKE 'youtube:%' THEN units_consumed ELSE 0 END), 0) as yt_units,
         COALESCE(SUM(estimated_cost_usd), 0) as anth_cost
       FROM quota_log
       WHERE token_hash = ? AND day_bucket IN (${placeholders})`,
    )
    .get(tokenHash, ...buckets) as { yt_units: number; anth_cost: number }

  const byToolRows = db
    .prepare(
      `SELECT tool_name, COUNT(*) as calls,
         SUM(units_consumed) as units, SUM(estimated_cost_usd) as cost
       FROM quota_log
       WHERE token_hash = ? AND day_bucket IN (${placeholders})
       GROUP BY tool_name ORDER BY units DESC, cost DESC`,
    )
    .all(tokenHash, ...buckets) as Array<{
    tool_name: string
    calls: number
    units: number
    cost: number
  }>

  const byEndpointRows = db
    .prepare(
      `SELECT endpoint, COUNT(*) as calls,
         SUM(units_consumed) as units, SUM(estimated_cost_usd) as cost
       FROM quota_log
       WHERE token_hash = ? AND day_bucket IN (${placeholders})
       GROUP BY endpoint ORDER BY units DESC, cost DESC`,
    )
    .all(tokenHash, ...buckets) as Array<{
    endpoint: string
    calls: number
    units: number
    cost: number
  }>

  return {
    period,
    startDate,
    endDate,
    totalYouTubeUnits: totalsRow.yt_units,
    totalAnthropicCostUsd: totalsRow.anth_cost,
    youtubeLimit: YOUTUBE_DAILY_LIMIT,
    youtubePercent:
      YOUTUBE_DAILY_LIMIT > 0 ? (totalsRow.yt_units / YOUTUBE_DAILY_LIMIT) * 100 : 0,
    byTool: byToolRows.map((r) => ({
      toolName: r.tool_name,
      calls: r.calls,
      units: r.units ?? 0,
      costUsd: r.cost ?? 0,
    })),
    byEndpoint: byEndpointRows.map((r) => ({
      endpoint: r.endpoint,
      calls: r.calls,
      units: r.units ?? 0,
      costUsd: r.cost ?? 0,
    })),
  }
}
