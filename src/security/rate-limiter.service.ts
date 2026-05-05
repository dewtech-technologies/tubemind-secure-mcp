// A07 — Rate Limiting por tool para proteger quotas da YouTube API

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

const LIMITS: Record<string, number> = {
  search_trending_topics: 10,
  get_keyword_stats: 15,
  get_video_tags: 30,
  suggest_tags: 10,
  update_video_metadata: 5,
  list_channel_videos: 20,
  get_channel_analytics: 10,
  get_competitor_videos: 10,
  estimate_keyword_difficulty: 8,
  analyze_title_patterns: 5,
  detect_content_gaps: 3,
  score_best_publish_window: 5,
  benchmark_channel: 3,
  estimate_ctr_potential: 20,
  suggest_hook_angles: 5,
  find_trending_keywords: 3,
  analyze_retention_signals: 3,
  generate_content_calendar: 2,
  default: parseInt(process.env['RATE_LIMIT_PER_MINUTE'] ?? '60', 10),
}

export class RateLimitError extends Error {
  constructor(tool: string, resetsIn: number) {
    super(`[rate-limit] Limite atingido para "${tool}". Tente novamente em ${resetsIn}s.`)
    this.name = 'RateLimitError'
  }
}

export function checkRateLimit(toolName: string): void {
  const now = Date.now()
  const key = toolName
  const limit = LIMITS[toolName] ?? LIMITS['default'] ?? 60
  const windowMs = 60_000 // 1 minuto

  const entry = store.get(key)

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return
  }

  if (entry.count >= limit) {
    const resetsIn = Math.ceil((entry.resetAt - now) / 1000)
    throw new RateLimitError(toolName, resetsIn)
  }

  entry.count++
}
