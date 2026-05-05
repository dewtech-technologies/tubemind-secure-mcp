import {
  EstimateKeywordDifficultySchema,
  AnalyzeTitlePatternsSchema,
  DetectContentGapsSchema,
} from '../schemas/input.schemas.js'
import {
  getYouTubeClient,
  searchVideos,
  getVideoById,
  getChannelStats,
} from '../services/youtube.service.js'
import { checkRateLimit } from '../security/rate-limiter.service.js'
import { withAudit } from '../security/audit.service.js'

// ─── estimate_keyword_difficulty ─────────────────────────────────────────────

export const estimateKeywordDifficultyDefinition = {
  name: 'estimate_keyword_difficulty',
  description:
    'Calcula um score de dificuldade (0–100) para ranquear um vídeo em uma keyword no YouTube. Analisa views/dia, tamanho dos canais concorrentes e idade dos vídeos ranqueados. Substitui o "Competition Score" do VidIQ sem dados proprietários.',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: 'Keyword a analisar' },
      regionCode: { type: 'string', description: 'Região: BR, US, PT, ES, AR', default: 'BR' },
      maxVideos: { type: 'number', description: 'Top N vídeos a analisar (5-15)', default: 10 },
    },
    required: ['keyword'],
  },
} as const

export async function estimateKeywordDifficulty(
  rawInput: unknown,
  accessToken: string,
): Promise<string> {
  return withAudit('ESTIMATE_KEYWORD_DIFFICULTY', 'estimate_keyword_difficulty', async () => {
    checkRateLimit('estimate_keyword_difficulty')

    const input = EstimateKeywordDifficultySchema.parse(rawInput)
    const client = getYouTubeClient(accessToken)

    const searchResults = await searchVideos(client, input.keyword, input.maxVideos, input.regionCode, 'relevance')
    const videoIds = searchResults.map(r => r.id?.videoId).filter((id): id is string => !!id)

    if (videoIds.length === 0) {
      return `Nenhum vídeo encontrado para "${input.keyword}".`
    }

    const videos = (await Promise.all(videoIds.map(id => getVideoById(client, id)))).filter(Boolean)

    // Coleta stats dos canais únicos
    const channelIds = [...new Set(videos.map(v => v?.snippet?.channelId).filter((id): id is string => !!id))]
    const channelSubsMap = new Map<string, number>()
    await Promise.all(
      channelIds.map(async id => {
        const stats = await getChannelStats(client, id)
        const subs = parseInt(stats?.subscriberCount ?? '0', 10)
        channelSubsMap.set(id, subs)
      }),
    )

    const now = Date.now()
    const metrics = videos.map(v => {
      const views = parseInt(v?.statistics?.viewCount ?? '0', 10)
      const publishedMs = new Date(v?.snippet?.publishedAt ?? now).getTime()
      const ageInDays = Math.max(1, (now - publishedMs) / 86_400_000)
      const viewsPerDay = views / ageInDays
      const channelId = v?.snippet?.channelId ?? ''
      const subs = channelSubsMap.get(channelId) ?? 0
      return { views, viewsPerDay, ageInDays, subs }
    })

    const avgViewsPerDay = metrics.reduce((a, b) => a + b.viewsPerDay, 0) / metrics.length
    const largePct = (metrics.filter(m => m.subs > 100_000).length / metrics.length) * 100
    const avgAgeMonths = metrics.reduce((a, b) => a + b.ageInDays / 30, 0) / metrics.length

    // Coeficiente de variação das views/dia (proxy de imprevisibilidade)
    const mean = avgViewsPerDay
    const stdDev = Math.sqrt(metrics.reduce((a, b) => a + Math.pow(b.viewsPerDay - mean, 2), 0) / metrics.length)
    const cv = mean > 0 ? stdDev / mean : 0

    // Normaliza cada fator para 0–100
    const viewsScore = Math.min(100, (avgViewsPerDay / 50_000) * 100)    // 50k/dia = 100
    const channelScore = largePct                                           // já é 0–100
    const ageScore = Math.min(100, (avgAgeMonths / 36) * 100)              // 36 meses = 100
    const varianceScore = Math.min(100, cv * 50)                           // CV 2.0 = 100

    const score = Math.min(100, Math.round(
      viewsScore * 0.40 + channelScore * 0.35 + ageScore * 0.15 + varianceScore * 0.10,
    ))

    const difficulty = score <= 30 ? '🟢 Baixa' : score <= 60 ? '🟡 Média' : score <= 80 ? '🔴 Alta' : '🔴 Muito Alta'
    const action = score <= 30
      ? '✅ Boa oportunidade — entre agora'
      : score <= 60
        ? '⚡ Possível com conteúdo de qualidade e bom thumbnail'
        : '⚠️ Recomendado apenas com canal já estabelecido (>10k inscritos)'

    const varianceLabel = cv < 0.5 ? 'baixa (keyword estável)' : cv < 1.5 ? 'moderada' : 'alta (keyword imprevisível)'

    return [
      `## Dificuldade da Keyword: "${input.keyword}" (${input.regionCode})`,
      '',
      `**Score: ${score}/100 — ${difficulty}**`,
      '',
      '### Fatores analisados',
      `- Views/dia médio (top ${metrics.length}): ${Math.round(avgViewsPerDay).toLocaleString('pt-BR')}`,
      `- Canais grandes (>100k inscritos): ${Math.round(largePct)}% dos top vídeos`,
      `- Idade média dos ranqueados: ${Math.round(avgAgeMonths)} meses`,
      `- Variância de views: ${varianceLabel}`,
      '',
      `**Recomendação:** ${action}`,
      '',
      '### Pesos do score',
      '| Fator | Peso | Valor bruto |',
      '|---|---|---|',
      `| Views/dia médio | 40% | ${Math.round(viewsScore)}/100 |`,
      `| % canais grandes | 35% | ${Math.round(channelScore)}/100 |`,
      `| Idade média | 15% | ${Math.round(ageScore)}/100 |`,
      `| Variância | 10% | ${Math.round(varianceScore)}/100 |`,
      '',
      '> ⚠️ Score estimado por heurística — não reflete dados internos do YouTube.',
    ].join('\n')
  })
}

// ─── analyze_title_patterns ───────────────────────────────────────────────────

export const analyzeTitlePatternsDefinition = {
  name: 'analyze_title_patterns',
  description:
    'Analisa os padrões estruturais dos títulos dos vídeos mais bem-sucedidos em um nicho. Identifica fórmulas recorrentes (número, pergunta, como-fazer, contraste, urgência) e retorna os templates que dominam o nicho.',
  inputSchema: {
    type: 'object',
    properties: {
      niche: { type: 'string', description: 'Nicho ou tema a analisar. Ex: "automação com ia"' },
      regionCode: { type: 'string', description: 'Região: BR, US, PT, ES, AR', default: 'BR' },
      videoCount: { type: 'number', description: 'Vídeos a analisar (10-50)', default: 30 },
    },
    required: ['niche'],
  },
} as const

interface TitleFeatures {
  title: string
  views: number
  patterns: string[]
  wordCount: number
  hasEmoji: boolean
  hasYear: boolean
}

function detectPatterns(title: string): string[] {
  const t = title.toLowerCase()
  const patterns: string[] = []

  if (/^\d+[\s\-:]/.test(title)) patterns.push('número-lista')
  if (/\?/.test(title)) patterns.push('pergunta')
  if (/^como\s|^how\s|^aprenda\s|^domine\s/i.test(title)) patterns.push('como-fazer')
  if (/\bvs\.?\b|\bversus\b|\bou\s.*melhor\b/i.test(title)) patterns.push('versus-comparação')
  if (/\b(2025|2026|2027)\b/.test(title)) patterns.push('urgência-ano')
  if (/\b(nunca|sempre|tudo|nada|todo mundo|ninguém|revelado|segredo|verdade)\b/i.test(t)) patterns.push('revelação-choque')
  if (/\b(guia|completo|definitivo|ultimate|tutorial)\b/i.test(t)) patterns.push('guia-completo')
  if (/\b(sem|grátis|gratuito|free|zero)\b/i.test(t)) patterns.push('sem-custo')
  if (/\b(em\s\d+\s(dias?|horas?|minutos?)|rápido|rápida)\b/i.test(t)) patterns.push('resultado-rápido')
  if (patterns.length === 0) patterns.push('outro')

  return patterns
}

export async function analyzeTitlePatterns(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('ANALYZE_TITLE_PATTERNS', 'analyze_title_patterns', async () => {
    checkRateLimit('analyze_title_patterns')

    const input = AnalyzeTitlePatternsSchema.parse(rawInput)
    const client = getYouTubeClient(accessToken)

    const results = await searchVideos(client, input.niche, input.videoCount, input.regionCode, 'viewCount')
    const videoIds = results.map(r => r.id?.videoId).filter((id): id is string => !!id)

    const videoDetails = (await Promise.all(videoIds.slice(0, 30).map(id => getVideoById(client, id)))).filter(Boolean)

    if (videoDetails.length === 0) return `Nenhum vídeo encontrado para "${input.niche}".`

    const analyzed: TitleFeatures[] = videoDetails.map(v => ({
      title: v?.snippet?.title ?? '',
      views: parseInt(v?.statistics?.viewCount ?? '0', 10),
      patterns: detectPatterns(v?.snippet?.title ?? ''),
      wordCount: (v?.snippet?.title ?? '').split(/\s+/).length,
      hasEmoji: /\p{Emoji_Presentation}/u.test(v?.snippet?.title ?? ''),
      hasYear: /\b(2025|2026|2027)\b/.test(v?.snippet?.title ?? ''),
    }))

    // Agrega por padrão
    const patternCount = new Map<string, { count: number; totalViews: number; examples: string[] }>()
    for (const item of analyzed) {
      for (const pat of item.patterns) {
        const entry = patternCount.get(pat) ?? { count: 0, totalViews: 0, examples: [] }
        entry.count++
        entry.totalViews += item.views
        if (entry.examples.length < 2) entry.examples.push(item.title)
        patternCount.set(pat, entry)
      }
    }

    const sorted = [...patternCount.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)

    const total = videoDetails.length
    const medals = ['🥇', '🥈', '🥉', '4.', '5.', '6.']

    const patternLines = sorted.map(([pat, data], i) => {
      const pct = Math.round((data.count / total) * 100)
      const avgViews = Math.round(data.totalViews / data.count).toLocaleString('pt-BR')
      const examples = data.examples.map(e => `   → _"${e}"_`).join('\n')
      return `${medals[i]} **${pat}** — ${pct}% dos vídeos | Views médias: ${avgViews}\n${examples}`
    })

    // Comprimento médio de título
    const avgWords = Math.round(analyzed.reduce((s, v) => s + v.wordCount, 0) / analyzed.length)
    const emojiPct = Math.round((analyzed.filter(v => v.hasEmoji).length / total) * 100)
    const yearPct = Math.round((analyzed.filter(v => v.hasYear).length / total) * 100)

    return [
      `## Padrões de Títulos — "${input.niche}" (${input.regionCode})`,
      `Analisados ${total} vídeos`,
      '',
      '### Top padrões por frequência',
      ...patternLines,
      '',
      '### Insights',
      `- Comprimento médio: **${avgWords} palavras**`,
      `- Títulos com emoji: **${emojiPct}%**`,
      `- Títulos com ano (2025/2026): **${yearPct}%**`,
      '',
      '> 💡 Use os padrões #1 e #2 como base. Combine com a keyword na posição 1–3 do título.',
    ].join('\n')
  })
}

// ─── detect_content_gaps ─────────────────────────────────────────────────────

export const detectContentGapsDefinition = {
  name: 'detect_content_gaps',
  description:
    'Identifica subtópicos do nicho que estão sendo buscados mas pouco explorados pelos criadores. Classifica cada subtópico como Gap Real (entre agora), Oportunidade ou Saturado. Equivalente ao "Content Gaps" do VidIQ.',
  inputSchema: {
    type: 'object',
    properties: {
      niche: { type: 'string', description: 'Nicho principal a analisar. Ex: "inteligência artificial para empresas"' },
      regionCode: { type: 'string', description: 'Região: BR, US, PT, ES, AR', default: 'BR' },
      yourChannelId: { type: 'string', description: 'Channel ID do seu canal (opcional) para verificar o que você já cobriu' },
    },
    required: ['niche'],
  },
} as const

interface SubtopicAnalysis {
  subtopic: string
  videoCount: number
  avgViews: number
  newestDaysAgo: number
  classification: 'gap' | 'opportunity' | 'saturated'
}

function generateSubtopics(niche: string): string[] {
  return [
    `como ${niche}`,
    `${niche} tutorial`,
    `${niche} para iniciantes`,
    `${niche} avançado`,
    `${niche} passo a passo`,
    `${niche} 2026`,
    `${niche} ferramentas`,
    `aprender ${niche}`,
  ]
}

function classifySubtopic(data: Omit<SubtopicAnalysis, 'classification'>): SubtopicAnalysis['classification'] {
  const { videoCount, avgViews, newestDaysAgo } = data

  // Gap real: poucos vídeos + views altas + conteúdo desatualizado
  if (videoCount <= 5 && avgViews >= 30_000 && newestDaysAgo >= 90) return 'gap'
  if (videoCount <= 3 && avgViews >= 10_000) return 'gap'

  // Saturado: muitos vídeos recentes com boas views
  if (videoCount >= 15 && newestDaysAgo <= 30) return 'saturated'
  if (videoCount >= 10 && avgViews >= 100_000) return 'saturated'

  return 'opportunity'
}

export async function detectContentGaps(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('DETECT_CONTENT_GAPS', 'detect_content_gaps', async () => {
    checkRateLimit('detect_content_gaps')

    const input = DetectContentGapsSchema.parse(rawInput)
    const client = getYouTubeClient(accessToken)

    const subtopics = generateSubtopics(input.niche)
    const now = Date.now()

    const analyses: SubtopicAnalysis[] = []

    for (const subtopic of subtopics) {
      const results = await searchVideos(client, subtopic, 10, input.regionCode, 'relevance')
      const videoIds = results.map(r => r.id?.videoId).filter((id): id is string => !!id).slice(0, 5)

      if (videoIds.length === 0) {
        analyses.push({ subtopic, videoCount: 0, avgViews: 0, newestDaysAgo: 999, classification: 'gap' })
        continue
      }

      const videos = (await Promise.all(videoIds.map(id => getVideoById(client, id)))).filter(Boolean)

      const viewsList = videos.map(v => parseInt(v?.statistics?.viewCount ?? '0', 10))
      const avgViews = viewsList.length > 0
        ? Math.round(viewsList.reduce((a, b) => a + b, 0) / viewsList.length)
        : 0

      const dates = videos
        .map(v => new Date(v?.snippet?.publishedAt ?? 0).getTime())
        .filter(d => d > 0)
      const newestMs = dates.length > 0 ? Math.max(...dates) : 0
      const newestDaysAgo = newestMs > 0 ? Math.round((now - newestMs) / 86_400_000) : 999

      const data = { subtopic, videoCount: results.length, avgViews, newestDaysAgo }
      analyses.push({ ...data, classification: classifySubtopic(data) })
    }

    const gaps = analyses.filter(a => a.classification === 'gap')
    const opportunities = analyses.filter(a => a.classification === 'opportunity')
    const saturated = analyses.filter(a => a.classification === 'saturated')

    function formatSubtopic(a: SubtopicAnalysis, i: number): string {
      const recency = a.newestDaysAgo === 999
        ? 'sem vídeos recentes'
        : a.newestDaysAgo <= 7 ? `vídeo há ${a.newestDaysAgo}d`
        : a.newestDaysAgo <= 30 ? `vídeo há ${a.newestDaysAgo}d`
        : `vídeo há ${Math.round(a.newestDaysAgo / 30)} meses`

      return `${i + 1}. \`${a.subtopic}\`\n   ${a.videoCount} vídeos | Views médias: ${a.avgViews.toLocaleString('pt-BR')} | Mais recente: ${recency}`
    }

    const lines: string[] = [
      `## Gaps de Conteúdo — "${input.niche}" (${input.regionCode})`,
      '',
    ]

    if (gaps.length > 0) {
      lines.push('### 🟢 Gaps Reais — entre agora')
      lines.push(...gaps.map((a, i) => formatSubtopic(a, i)))
      lines.push('')
    }

    if (opportunities.length > 0) {
      lines.push('### 🟡 Oportunidades')
      lines.push(...opportunities.map((a, i) => formatSubtopic(a, i)))
      lines.push('')
    }

    if (saturated.length > 0) {
      lines.push('### 🔴 Saturados — evite ou entre com ângulo muito diferente')
      lines.push(...saturated.map((a, i) => formatSubtopic(a, i)))
      lines.push('')
    }

    const best = gaps[0] ?? opportunities[0]
    if (best) {
      lines.push(`> 💡 **Recomendação:** comece com \`${best.subtopic}\` — ${best.classification === 'gap' ? 'maior demanda reprimida detectada' : 'melhor equilíbrio entre demanda e concorrência'}.`)
    }

    return lines.join('\n')
  })
}
