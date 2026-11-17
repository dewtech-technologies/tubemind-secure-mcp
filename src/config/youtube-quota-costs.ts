/**
 * Tabela canonical de custos da YouTube Data API v3 (em "quota units").
 * Referência: https://developers.google.com/youtube/v3/determine_quota_cost
 *
 * Limite padrão diário do Google Cloud Project: 10.000 units.
 * Configurável via env YOUTUBE_DAILY_QUOTA (caso o projeto tenha cota maior).
 */

export const QUOTA_COSTS: Readonly<Record<string, number>> = Object.freeze({
  // YouTube Data API v3
  'youtube:search.list': 100,
  'youtube:videos.list': 1,
  'youtube:channels.list': 1,
  'youtube:commentThreads.list': 1,
  'youtube:comments.list': 1,
  'youtube:captions.list': 50,
  'youtube:captions.download': 200,
  'youtube:videos.update': 50,
  'youtube:playlists.list': 1,
  'youtube:playlistItems.list': 1,
  // YouTube Analytics API (cobrança própria, não conta na quota Data API)
  'youtubeanalytics:reports.query': 0,
  // Anthropic Claude (não conta em quota YouTube — apenas custo USD)
  'anthropic:haiku': 0,
  'anthropic:sonnet': 0,
  'anthropic:vision': 0,
})

export const YOUTUBE_DAILY_LIMIT = (() => {
  const fromEnv = process.env['YOUTUBE_DAILY_QUOTA']
  if (fromEnv) {
    const n = parseInt(fromEnv, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 10_000
})()

/**
 * Resolve o custo em units para um endpoint conhecido. Retorna 0 se não mapeado
 * (endpoints futuros ou APIs externas que não contam na quota YouTube).
 */
export function getQuotaCost(endpoint: string): number {
  return QUOTA_COSTS[endpoint] ?? 0
}
