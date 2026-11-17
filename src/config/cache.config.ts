/**
 * TTL (em segundos) por tool. Defaults sensatos baseados em:
 * - Volatilidade do dado (trending muda rápido; análise estrutural lentamente)
 * - Custo da API externa (Vision/NLP são caros → TTL longo)
 * - Quota YouTube API (search.list=100u → cache mais agressivo)
 *
 * Tools não listadas usam DEFAULT_TTL_SECONDS.
 */

export const DEFAULT_TTL_SECONDS = 3600 // 1h

export const CACHE_TTL: Readonly<Record<string, number>> = Object.freeze({
  // ── Search & SEO (volatilidade alta) ──
  search_trending_topics: 3600, // 1h
  get_keyword_stats: 21600, // 6h
  suggest_tags: 21600, // 6h
  find_trending_keywords: 21600, // 6h

  // ── Heurísticas (estabilidade média; cache 24h) ──
  estimate_keyword_difficulty: 86400, // 24h
  analyze_title_patterns: 86400, // 24h
  detect_content_gaps: 43200, // 12h
  analyze_retention_signals: 86400, // 24h
  estimate_ctr_potential: 86400, // 24h
  suggest_hook_angles: 86400, // 24h
  generate_content_calendar: 43200, // 12h

  // ── Analytics do canal (atualiza diariamente) ──
  get_channel_analytics: 3600, // 1h (refletir uploads recentes)
  score_best_publish_window: 86400, // 24h
  benchmark_channel: 43200, // 12h

  // ── Vídeos individuais (metadados estáveis após publicação) ──
  get_video_tags: 86400, // 24h
  list_channel_videos: 3600, // 1h
  get_competitor_videos: 21600, // 6h

  // ── Batch fetch interno (videos.list batched) ──
  videos_batch: 21600, // 6h — reuso em múltiplas heurísticas

  // ── Camada 2 — Visão (caro: Claude Vision API) ──
  analyze_thumbnail_visuals: 604800, // 7d (thumbnails de top vídeos mudam pouco)
  score_my_thumbnail: 86400, // 24h

  // ── Camada 3 — NLP ──
  analyze_video_comments: 86400, // 24h
  analyze_video_transcript: 604800, // 7d (transcrição não muda)
  reverse_engineer_viral_video: 604800, // 7d

  // ── Camada 4 — Pipeline ──
  // Roteiros NÃO são cacheados (input sempre único).
  optimize_video_description: 86400, // 24h se input idêntico
  predict_video_performance: 3600, // 1h (channel analytics muda)
})

/**
 * Resolve o TTL para um tool. Tools desconhecidas caem em DEFAULT_TTL_SECONDS
 * (não lança erro — fail-soft para extensões futuras).
 */
export function getTtlSeconds(toolName: string): number {
  return CACHE_TTL[toolName] ?? DEFAULT_TTL_SECONDS
}

/**
 * Limite duro de tamanho do cache antes de evict LRU disparar (RF-1.4).
 */
export const CACHE_MAX_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB

/**
 * Quanto liberar quando o LRU evict é acionado (em fração do max).
 */
export const CACHE_EVICT_TARGET_FRACTION = 0.2 // libera 20%
