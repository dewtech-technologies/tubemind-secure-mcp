import { z } from 'zod'
import { SearchTrendingSchema, GetKeywordStatsSchema, SuggestTagsSchema } from '../schemas/input.schemas.js'
import { searchVideos, getVideoById, getYouTubeClient } from '../services/youtube.service.js'
import { checkRateLimit } from '../security/rate-limiter.service.js'
import { withAudit } from '../security/audit.service.js'

// ─── search_trending_topics ───────────────────────────────────────────────────

export const searchTrendingTopicsDefinition = {
  name: 'search_trending_topics',
  description:
    'Busca vídeos em alta no YouTube para um tema ou keyword. Retorna título, canal, views e link de cada vídeo encontrado.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Tema ou keyword a pesquisar' },
      maxResults: { type: 'number', description: 'Número de resultados (1-50)', default: 10 },
      regionCode: { type: 'string', description: 'Código de região: BR, US, PT, ES, AR', default: 'BR' },
      order: { type: 'string', description: 'Ordenação: relevance, viewCount, date, rating', default: 'relevance' },
    },
    required: ['query'],
  },
} as const

export async function searchTrendingTopics(
  rawInput: unknown,
  accessToken: string,
): Promise<string> {
  return withAudit('SEARCH_TRENDING', 'search_trending_topics', async () => {
    checkRateLimit('search_trending_topics')

    const input = SearchTrendingSchema.parse(rawInput)
    const client = getYouTubeClient(accessToken)

    const results = await searchVideos(
      client,
      input.query,
      input.maxResults,
      input.regionCode,
      input.order as 'relevance' | 'viewCount' | 'date' | 'rating',
    )

    if (results.length === 0) {
      return `Nenhum vídeo encontrado para "${input.query}" na região ${input.regionCode}.`
    }

    const formatted = results.map((item, i) => {
      const title = item.snippet?.title ?? 'Sem título'
      const channel = item.snippet?.channelTitle ?? 'Canal desconhecido'
      const videoId = item.id?.videoId ?? ''
      const publishedAt = item.snippet?.publishedAt?.split('T')[0] ?? ''
      return `${i + 1}. **${title}**\n   Canal: ${channel} | Publicado: ${publishedAt}\n   Link: https://youtube.com/watch?v=${videoId}`
    })

    return `## Tendências para "${input.query}" (${input.regionCode})\n\n${formatted.join('\n\n')}`
  })
}

// ─── get_keyword_stats ────────────────────────────────────────────────────────

export const getKeywordStatsDefinition = {
  name: 'get_keyword_stats',
  description:
    'Analisa uma keyword no YouTube: retorna os top vídeos ranqueados, estimativa de dificuldade baseada em tamanho dos canais e idade dos vídeos, e sugestões de ângulos com menor concorrência.',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: 'Keyword a analisar' },
      regionCode: { type: 'string', description: 'Código de região', default: 'BR' },
      maxVideos: { type: 'number', description: 'Vídeos a analisar (5-20)', default: 10 },
    },
    required: ['keyword'],
  },
} as const

export async function getKeywordStats(
  rawInput: unknown,
  accessToken: string,
): Promise<string> {
  return withAudit('GET_KEYWORD_STATS', 'get_keyword_stats', async () => {
    checkRateLimit('get_keyword_stats')

    const input = GetKeywordStatsSchema.parse(rawInput)
    const client = getYouTubeClient(accessToken)

    const results = await searchVideos(client, input.keyword, input.maxVideos, input.regionCode, 'relevance')

    if (results.length === 0) {
      return `Nenhum dado encontrado para a keyword "${input.keyword}".`
    }

    // Heurística: busca detalhes de cada vídeo para extrair métricas
    const videoIds = results
      .map(r => r.id?.videoId)
      .filter((id): id is string => !!id)

    const videoDetails = await Promise.all(
      videoIds.slice(0, 5).map(id => getVideoById(client, id))
    )

    const validVideos = videoDetails.filter(Boolean)

    // Calcula heurísticas de dificuldade
    const viewCounts = validVideos
      .map(v => parseInt(v?.statistics?.viewCount ?? '0', 10))
      .filter(n => n > 0)

    const avgViews = viewCounts.length > 0
      ? Math.round(viewCounts.reduce((a, b) => a + b, 0) / viewCounts.length)
      : 0

    const difficulty = avgViews > 1_000_000
      ? '🔴 Alta'
      : avgViews > 100_000
        ? '🟡 Média'
        : '🟢 Baixa'

    const topVideos = validVideos.slice(0, 5).map((v, i) => {
      const title = v?.snippet?.title ?? 'Sem título'
      const channel = v?.snippet?.channelTitle ?? '?'
      const views = parseInt(v?.statistics?.viewCount ?? '0', 10).toLocaleString('pt-BR')
      const publishedAt = v?.snippet?.publishedAt?.split('T')[0] ?? ''
      return `${i + 1}. **${title}**\n   Canal: ${channel} | Views: ${views} | Data: ${publishedAt}`
    })

    return [
      `## Análise de Keyword: "${input.keyword}" (${input.regionCode})`,
      '',
      `**Dificuldade estimada:** ${difficulty}`,
      `**Média de views (top 5):** ${avgViews.toLocaleString('pt-BR')}`,
      '',
      '### Top Vídeos Ranqueados',
      ...topVideos,
      '',
      '> ⚠️ Dificuldade estimada por heurística (views médias). Não reflete dados internos do YouTube.',
    ].join('\n')
  })
}

// ─── suggest_tags ─────────────────────────────────────────────────────────────

export const suggestTagsDefinition = {
  name: 'suggest_tags',
  description:
    'Sugere tags estratégicas para um vídeo analisando os top vídeos que ranqueiam para uma keyword. Extrai padrões de tags e agrupa por relevância.',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: 'Keyword principal do vídeo' },
      videoCount: { type: 'number', description: 'Número de vídeos a analisar (3-15)', default: 8 },
      regionCode: { type: 'string', description: 'Código de região', default: 'BR' },
    },
    required: ['keyword'],
  },
} as const

export async function suggestTags(
  rawInput: unknown,
  accessToken: string,
): Promise<string> {
  return withAudit('GET_VIDEO_TAGS', 'suggest_tags', async () => {
    checkRateLimit('suggest_tags')

    const input = SuggestTagsSchema.parse(rawInput)
    const client = getYouTubeClient(accessToken)

    const results = await searchVideos(client, input.keyword, input.videoCount, input.regionCode, 'relevance')
    const videoIds = results.map(r => r.id?.videoId).filter((id): id is string => !!id)

    const videoDetails = await Promise.all(videoIds.map(id => getVideoById(client, id)))

    // Coleta todas as tags dos top vídeos
    const allTags: string[] = videoDetails
      .flatMap(v => v?.snippet?.tags ?? [])
      .map(t => t.toLowerCase().trim())

    // Conta frequência de cada tag
    const tagFrequency = new Map<string, number>()
    for (const tag of allTags) {
      tagFrequency.set(tag, (tagFrequency.get(tag) ?? 0) + 1)
    }

    // Ordena por frequência e pega top 30
    const sortedTags = [...tagFrequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)

    if (sortedTags.length === 0) {
      return `Não foi possível extrair tags para "${input.keyword}". Tente outra keyword.`
    }

    const formatted = sortedTags.map(([tag, count]) =>
      `- \`${tag}\` (aparece em ${count} vídeos)`
    )

    return [
      `## Tags Sugeridas para "${input.keyword}"`,
      '',
      `Analisados ${videoDetails.filter(Boolean).length} vídeos do top YouTube.`,
      '',
      '### Tags por Frequência',
      ...formatted,
      '',
      '> 💡 Priorize as tags com maior frequência. Adicione variações (singular/plural, PT/EN).',
    ].join('\n')
  })
}
