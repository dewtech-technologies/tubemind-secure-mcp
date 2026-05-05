import { GetCompetitorVideosSchema } from '../schemas/input.schemas.js'
import { getYouTubeClient, getCompetitorChannelVideos } from '../services/youtube.service.js'
import { checkRateLimit } from '../security/rate-limiter.service.js'
import { withAudit } from '../security/audit.service.js'

export const getCompetitorVideosDefinition = {
  name: 'get_competitor_videos',
  description:
    'Lista os vídeos de um canal concorrente com título, views, likes, duração e data. Útil para analisar estratégia de conteúdo de competidores. Requer o Channel ID (começa com UC).',
  inputSchema: {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        description: 'Channel ID do concorrente (começa com UC, 24 chars). Ex: UCVjlpEjEY9GpksqbEesJnNA',
      },
      maxResults: { type: 'number', description: 'Número de vídeos (1-50)', default: 10 },
      order: {
        type: 'string',
        description: 'Ordenação: viewCount (mais vistos), date (mais recentes), rating (mais curtidos)',
        default: 'viewCount',
      },
    },
    required: ['channelId'],
  },
} as const

export async function getCompetitorVideos(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('GET_COMPETITOR_VIDEOS', 'get_competitor_videos', async () => {
    checkRateLimit('get_competitor_videos')

    const input = GetCompetitorVideosSchema.parse(rawInput)
    const client = getYouTubeClient(accessToken)

    const videos = await getCompetitorChannelVideos(
      client,
      input.channelId,
      input.maxResults,
      input.order,
    )

    if (videos.length === 0) {
      return `Nenhum vídeo encontrado para o canal ${input.channelId}.`
    }

    const channelName = videos[0]?.snippet?.channelTitle ?? input.channelId

    const formatted = videos.map((v, i) => {
      const title = v.snippet?.title ?? 'Sem título'
      const views = parseInt(v.statistics?.viewCount ?? '0', 10).toLocaleString('pt-BR')
      const likes = parseInt(v.statistics?.likeCount ?? '0', 10).toLocaleString('pt-BR')
      const comments = parseInt(v.statistics?.commentCount ?? '0', 10).toLocaleString('pt-BR')
      const date = v.snippet?.publishedAt?.split('T')[0] ?? ''
      const id = v.id ?? ''

      // Duração ISO 8601 → minutos:segundos
      const rawDuration = v.contentDetails?.duration ?? ''
      const duration = parseDuration(rawDuration)

      // Engagement rate (likes + comments) / views
      const rawViews = parseInt(v.statistics?.viewCount ?? '0', 10)
      const rawLikes = parseInt(v.statistics?.likeCount ?? '0', 10)
      const rawComments = parseInt(v.statistics?.commentCount ?? '0', 10)
      const engRate = rawViews > 0
        ? (((rawLikes + rawComments) / rawViews) * 100).toFixed(2)
        : '0.00'

      return [
        `${i + 1}. **${title}**`,
        `   Views: ${views} | Likes: ${likes} | Comentários: ${comments}`,
        `   Engajamento: ${engRate}% | Duração: ${duration} | Data: ${date}`,
        `   ID: \`${id}\` — https://youtube.com/watch?v=${id}`,
      ].join('\n')
    })

    const totalViews = videos
      .reduce((s, v) => s + parseInt(v.statistics?.viewCount ?? '0', 10), 0)
    const avgViews = Math.round(totalViews / videos.length)

    return [
      `## Vídeos do Canal Concorrente: ${channelName}`,
      `Ordenação: ${input.order} | ${videos.length} vídeos`,
      `Views médias (amostra): ${avgViews.toLocaleString('pt-BR')}`,
      '',
      ...formatted,
    ].join('\n')
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDuration(iso: string): string {
  if (!iso) return '?'
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return iso
  const h = parseInt(match[1] ?? '0', 10)
  const m = parseInt(match[2] ?? '0', 10)
  const s = parseInt(match[3] ?? '0', 10)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
