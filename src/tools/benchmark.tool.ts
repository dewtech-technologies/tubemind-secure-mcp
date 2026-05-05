import { BenchmarkChannelSchema } from '../schemas/input.schemas.js'
import { getYouTubeClient, getOwnChannelId } from '../services/youtube.service.js'
import { checkRateLimit } from '../security/rate-limiter.service.js'
import { withAudit } from '../security/audit.service.js'

export const benchmarkChannelDefinition = {
  name: 'benchmark_channel',
  description:
    'Compara seu canal autenticado com 1 a 3 canais concorrentes. Retorna tabela comparativa com inscritos, views totais, views médias por vídeo, engagement rate e views/inscritos. Mostra onde você está à frente e onde está atrás.',
  inputSchema: {
    type: 'object',
    properties: {
      competitorChannelIds: {
        type: 'array',
        items: { type: 'string', description: 'Channel ID do concorrente (formato: UCxxxxxxxxxxxxxxxxxxxxxxxx)' },
        description: 'Lista de 1 a 3 Channel IDs de concorrentes',
        minItems: 1,
        maxItems: 3,
      },
    },
    required: ['competitorChannelIds'],
  },
} as const

interface ChannelMetrics {
  name: string
  channelId: string
  subscribers: number
  totalViews: number
  avgViewsTop10: number
  avgEngagementRate: number
  viewsPerSub: number
}

export async function benchmarkChannel(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('BENCHMARK_CHANNEL', 'benchmark_channel', async () => {
    checkRateLimit('benchmark_channel')

    const input = BenchmarkChannelSchema.parse(rawInput)
    const client = getYouTubeClient(accessToken)

    // Fetch own channel (usa YOUTUBE_CHANNEL_ID se configurado para suportar Brand Accounts)
    const ownChannelId = await getOwnChannelId(client)
    const myChannelRes = await client.channels.list({
      part: ['snippet', 'statistics'],
      id: [ownChannelId],
    })
    const myChannelItem = myChannelRes.data.items?.[0]
    if (!myChannelItem) return 'Canal autenticado não encontrado.'

    // Fetch competitor channels
    const compRes = await client.channels.list({
      part: ['snippet', 'statistics'],
      id: input.competitorChannelIds,
    })
    const compItems = compRes.data.items ?? []

    const allChannelItems = [myChannelItem, ...compItems]

    async function getChannelTopVideosMetrics(channelId: string): Promise<{ avgViews: number; avgEngagement: number }> {
      const searchRes = await client.search.list({
        part: ['id'],
        channelId,
        maxResults: 10,
        order: 'viewCount',
        type: ['video'],
      })
      const videoIds = (searchRes.data.items ?? [])
        .map(i => i.id?.videoId)
        .filter((id): id is string => !!id)

      if (videoIds.length === 0) return { avgViews: 0, avgEngagement: 0 }

      const videosRes = await client.videos.list({
        part: ['statistics'],
        id: videoIds,
      })
      const videos = videosRes.data.items ?? []
      if (videos.length === 0) return { avgViews: 0, avgEngagement: 0 }

      let totalViews = 0
      let totalEngagement = 0
      let engagementCount = 0

      for (const v of videos) {
        const views = parseInt(v.statistics?.viewCount ?? '0', 10)
        const likes = parseInt(v.statistics?.likeCount ?? '0', 10)
        const comments = parseInt(v.statistics?.commentCount ?? '0', 10)
        totalViews += views
        if (views > 0) {
          totalEngagement += (likes + comments) / views * 100
          engagementCount++
        }
      }

      return {
        avgViews: Math.round(totalViews / videos.length),
        avgEngagement: engagementCount > 0 ? totalEngagement / engagementCount : 0,
      }
    }

    const channelMetrics: ChannelMetrics[] = []

    for (const ch of allChannelItems) {
      const chId = ch.id ?? ''
      const name = ch.snippet?.title ?? chId
      const subscribers = parseInt(ch.statistics?.subscriberCount ?? '0', 10)
      const totalViews = parseInt(ch.statistics?.viewCount ?? '0', 10)
      const { avgViews, avgEngagement } = await getChannelTopVideosMetrics(chId)
      const viewsPerSub = subscribers > 0 ? totalViews / subscribers : 0

      channelMetrics.push({
        name,
        channelId: chId,
        subscribers,
        totalViews,
        avgViewsTop10: avgViews,
        avgEngagementRate: avgEngagement,
        viewsPerSub,
      })
    }

    const myMetrics = channelMetrics[0]
    if (!myMetrics) return 'Erro ao obter métricas do canal autenticado.'
    const competitors = channelMetrics.slice(1)

    const fmt = (n: number) => Math.round(n).toLocaleString('pt-BR')
    const fmtPct = (n: number) => n.toFixed(2) + '%'
    const fmtRatio = (n: number) => n.toFixed(2) + 'x'

    // Table header
    const colHeaders = ['Métrica', myMetrics.name, ...competitors.map(c => c.name)]
    const sep = colHeaders.map(() => '---')

    const rows = [
      ['Inscritos', fmt(myMetrics.subscribers), ...competitors.map(c => fmt(c.subscribers))],
      ['Views totais', fmt(myMetrics.totalViews), ...competitors.map(c => fmt(c.totalViews))],
      ['Views médias (top 10)', fmt(myMetrics.avgViewsTop10), ...competitors.map(c => fmt(c.avgViewsTop10))],
      ['Engagement médio', fmtPct(myMetrics.avgEngagementRate), ...competitors.map(c => fmtPct(c.avgEngagementRate))],
      ['Views/inscrito', fmtRatio(myMetrics.viewsPerSub), ...competitors.map(c => fmtRatio(c.viewsPerSub))],
    ]

    const tableLines = [
      colHeaders.join(' | '),
      sep.join(' | '),
      ...rows.map(r => r.join(' | ')),
    ]

    // Where I'm ahead / behind
    const ahead: string[] = []
    const behind: string[] = []

    const metricKeys: Array<{ label: string; key: keyof ChannelMetrics }> = [
      { label: 'Inscritos', key: 'subscribers' },
      { label: 'Views médias (top 10)', key: 'avgViewsTop10' },
      { label: 'Engagement rate', key: 'avgEngagementRate' },
      { label: 'Views/inscrito', key: 'viewsPerSub' },
    ]

    for (const { label, key } of metricKeys) {
      const myVal = myMetrics[key] as number
      const bestComp = Math.max(...competitors.map(c => c[key] as number))
      const worstComp = Math.min(...competitors.map(c => c[key] as number))
      if (myVal >= bestComp) {
        ahead.push(`✅ **${label}**: você lidera (${fmt(myVal)} vs melhor concorrente ${fmt(bestComp)})`)
      } else if (myVal <= worstComp) {
        behind.push(`⚠️ **${label}**: você está atrás de todos (${fmt(myVal)} vs menor concorrente ${fmt(worstComp)})`)
      } else {
        behind.push(`📊 **${label}**: intermediário (${fmt(myVal)})`)
      }
    }

    return [
      `## Benchmark de Canal — ${myMetrics.name}`,
      '',
      '### Tabela Comparativa',
      ...tableLines,
      '',
      '### Onde você está à frente',
      ...(ahead.length > 0 ? ahead : ['Nenhuma métrica lidera no momento.']),
      '',
      '### Onde você está atrás',
      ...(behind.length > 0 ? behind : ['Você lidera em todas as métricas!']),
      '',
      '> ⚠️ Views médias baseadas nos 10 vídeos mais vistos de cada canal.',
    ].join('\n')
  })
}
