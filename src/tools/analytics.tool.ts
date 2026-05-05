import { GetChannelAnalyticsSchema, ScoreBestPublishWindowSchema } from '../schemas/input.schemas.js'
import { getAnalyticsClient, queryChannelAnalytics } from '../services/analytics.service.js'
import { getYouTubeClient, getOwnChannelId } from '../services/youtube.service.js'
import { checkRateLimit } from '../security/rate-limiter.service.js'
import { withAudit } from '../security/audit.service.js'

export const getChannelAnalyticsDefinition = {
  name: 'get_channel_analytics',
  description:
    'Retorna métricas reais do canal autenticado via YouTube Analytics API: views, likes, comentários, inscritos ganhos, minutos assistidos e duração média. Agrupa por dia no período informado.',
  inputSchema: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: 'Data inicial no formato YYYY-MM-DD' },
      endDate: { type: 'string', description: 'Data final no formato YYYY-MM-DD' },
      metrics: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['views', 'likes', 'comments', 'subscribersGained', 'estimatedMinutesWatched', 'averageViewDuration'],
        },
        description: 'Métricas desejadas (1–6). Default: views, likes, subscribersGained',
      },
    },
    required: ['startDate', 'endDate'],
  },
} as const

export async function getChannelAnalytics(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('GET_CHANNEL_ANALYTICS', 'get_channel_analytics', async () => {
    checkRateLimit('get_channel_analytics')

    const input = GetChannelAnalyticsSchema.parse(rawInput)
    const client = getAnalyticsClient(accessToken)

    const report = await queryChannelAnalytics(
      client,
      input.startDate,
      input.endDate,
      input.metrics,
    )

    if (!report) {
      return `Nenhum dado encontrado para o período ${input.startDate} → ${input.endDate}.`
    }

    const metricLabels: Record<string, string> = {
      views: 'Views',
      likes: 'Likes',
      comments: 'Comentários',
      subscribersGained: 'Inscritos ganhos',
      estimatedMinutesWatched: 'Minutos assistidos',
      averageViewDuration: 'Duração média (s)',
    }

    // Totais formatados
    const totalsLines = input.metrics.map(m => {
      const val = report.totals[m] ?? 0
      const label = metricLabels[m] ?? m
      const formatted = m === 'averageViewDuration'
        ? `${Math.round(val)}s (${Math.floor(val / 60)}min ${Math.round(val % 60)}s)`
        : val.toLocaleString('pt-BR')
      return `- **${label}:** ${formatted}`
    })

    // Tabela dos últimos 7 dias (ou todos se < 7)
    const recentRows = report.rows.slice(-7)
    const tableHeader = ['Data', ...input.metrics.map(m => metricLabels[m] ?? m)].join(' | ')
    const tableSep = Array(input.metrics.length + 1).fill('---').join(' | ')
    const tableRows = recentRows.map(row => {
      const cols = [row.day, ...input.metrics.map(m => {
        const v = row[m]
        return typeof v === 'number' ? v.toLocaleString('pt-BR') : String(v)
      })]
      return cols.join(' | ')
    })

    return [
      `## Analytics do Canal — ${input.startDate} → ${input.endDate}`,
      '',
      '### Totais do período',
      ...totalsLines,
      '',
      `### Últimos ${recentRows.length} dias`,
      tableHeader,
      tableSep,
      ...tableRows,
      '',
      `> Período completo: ${report.rows.length} dias de dados.`,
    ].join('\n')
  })
}

// ─── score_best_publish_window ────────────────────────────────────────────────

export const scoreBestPublishWindowDefinition = {
  name: 'score_best_publish_window',
  description:
    'Analisa os vídeos do canal autenticado e retorna o melhor dia e horário para publicar novos vídeos, baseado em views/dia dos vídeos já publicados. Agrupa por dia da semana + faixa horária e retorna top 3 melhores e 2 piores slots.',
  inputSchema: {
    type: 'object',
    properties: {
      videoCount: {
        type: 'number',
        description: 'Quantidade de vídeos recentes a analisar (10-50)',
        default: 30,
      },
    },
    required: [],
  },
} as const

const FAIXAS = [
  { label: 'Madrugada (00-06h)', start: 0, end: 6 },
  { label: 'Manhã cedo (06-09h)', start: 6, end: 9 },
  { label: 'Manhã (09-12h)', start: 9, end: 12 },
  { label: 'Almoço (12-14h)', start: 12, end: 14 },
  { label: 'Tarde (14-18h)', start: 14, end: 18 },
  { label: 'Noite (18-22h)', start: 18, end: 22 },
  { label: 'Noite tarde (22-00h)', start: 22, end: 24 },
]

const DIAS_PT = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

function getFaixaHoraria(hour: number): string {
  for (const f of FAIXAS) {
    if (hour >= f.start && hour < f.end) return f.label
  }
  return 'Noite tarde (22-00h)'
}

export async function scoreBestPublishWindow(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('SCORE_BEST_PUBLISH_WINDOW', 'score_best_publish_window', async () => {
    checkRateLimit('score_best_publish_window')

    const input = ScoreBestPublishWindowSchema.parse(rawInput)
    const client = getYouTubeClient(accessToken)

    // Get own channel id (usa YOUTUBE_CHANNEL_ID se configurado para suportar Brand Accounts)
    const channelId = await getOwnChannelId(client)

    // Get recent video ids
    const searchRes = await client.search.list({
      part: ['id'],
      channelId,
      maxResults: input.videoCount,
      order: 'date',
      type: ['video'],
    })
    const videoIds = (searchRes.data.items ?? [])
      .map(i => i.id?.videoId)
      .filter((id): id is string => !!id)

    if (videoIds.length === 0) return 'Nenhum vídeo encontrado no canal.'

    // Fetch video details
    const videosRes = await client.videos.list({
      part: ['snippet', 'statistics'],
      id: videoIds,
    })
    const videos = videosRes.data.items ?? []

    if (videos.length < 5) {
      return 'Dados insuficientes para análise: são necessários pelo menos 5 vídeos publicados no canal.'
    }

    const now = Date.now()
    const slotMap = new Map<string, { totalViewsPerDay: number; count: number }>()

    for (const v of videos) {
      const views = parseInt(v.statistics?.viewCount ?? '0', 10)
      const publishedAt = v.snippet?.publishedAt
      if (!publishedAt) continue

      const pub = new Date(publishedAt)
      // Adjust to SP (UTC-3)
      const spHour = ((pub.getUTCHours() - 3) + 24) % 24
      const spMs = pub.getTime() - (pub.getUTCHours() - spHour) * 3_600_000
      const spDate = new Date(spMs)
      const diaSemana = DIAS_PT[spDate.getUTCDay()] ?? 'Domingo'
      const faixa = getFaixaHoraria(spHour)
      const ageInDays = Math.max(1, (now - pub.getTime()) / 86_400_000)
      const viewsPerDay = views / ageInDays
      const key = `${diaSemana} — ${faixa}`
      const entry = slotMap.get(key) ?? { totalViewsPerDay: 0, count: 0 }
      entry.totalViewsPerDay += viewsPerDay
      entry.count++
      slotMap.set(key, entry)
    }

    // Build sorted slots
    const slots = [...slotMap.entries()]
      .map(([slot, data]) => ({
        slot,
        avgViewsPerDay: data.totalViewsPerDay / data.count,
        count: data.count,
      }))
      .sort((a, b) => b.avgViewsPerDay - a.avgViewsPerDay)

    const top3 = slots.slice(0, 3)
    const worst2 = slots.slice(-2).reverse()

    const fmt = (n: number) => Math.round(n).toLocaleString('pt-BR')
    const medals = ['🥇', '🥈', '🥉']

    const lines: string[] = [
      `## Melhor Janela de Publicação — Canal Autenticado`,
      `Baseado em ${videos.length} vídeos analisados`,
      '',
      '### Top 3 melhores slots',
      ...top3.map((s, i) =>
        `${medals[i]} **${s.slot}** — ${fmt(s.avgViewsPerDay)} views/dia médio (${s.count} vídeo${s.count !== 1 ? 's' : ''})`
      ),
      '',
      '### 2 piores slots (evite)',
      ...worst2.map((s, i) =>
        `${i + 1}. **${s.slot}** — ${fmt(s.avgViewsPerDay)} views/dia médio (${s.count} vídeo${s.count !== 1 ? 's' : ''})`
      ),
      '',
      `> ⚠️ Análise baseada em ${videos.length} vídeos do canal. Quanto mais vídeos, maior a precisão.`,
    ]

    return lines.join('\n')
  })
}
