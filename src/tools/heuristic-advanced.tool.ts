import {
  EstimateCtrPotentialSchema,
  SuggestHookAnglesSchema,
  FindTrendingKeywordsSchema,
  AnalyzeRetentionSignalsSchema,
  GenerateContentCalendarSchema,
} from '../schemas/input.schemas.js'
import {
  getYouTubeClient,
  searchVideos,
  getVideoById,
  getChannelStats,
} from '../services/youtube.service.js'
import { checkRateLimit } from '../security/rate-limiter.service.js'
import { withAudit } from '../security/audit.service.js'

// ─── Shared helpers ───────────────────────────────────────────────────────────

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

function parseDurationMinutes(iso: string): number {
  // ISO 8601 duration e.g. PT14M30S
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  const h = parseInt(match[1] ?? '0', 10)
  const m = parseInt(match[2] ?? '0', 10)
  const s = parseInt(match[3] ?? '0', 10)
  return h * 60 + m + s / 60
}

// ─── estimate_ctr_potential ───────────────────────────────────────────────────

export const estimateCtrPotentialDefinition = {
  name: 'estimate_ctr_potential',
  description:
    'Estima o CTR potencial de até 5 títulos candidatos usando heurísticas de copywriting. Pontua cada título de 0–100 e classifica como Alto, Médio ou Baixo potencial. Lista pontos positivos e melhorias por título.',
  inputSchema: {
    type: 'object',
    properties: {
      titles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Lista de 1 a 5 títulos candidatos para avaliar',
        minItems: 1,
        maxItems: 5,
      },
      niche: { type: 'string', description: 'Nicho do vídeo para análise contextual' },
      regionCode: { type: 'string', description: 'Região: BR, US, PT, ES, AR', default: 'BR' },
    },
    required: ['titles', 'niche'],
  },
} as const

const TRIGGER_WORDS = [
  'como', 'guia', 'segredo', 'erro', 'grátis', 'gratuito', 'definitivo',
  'completo', 'revelado', 'nunca', 'sempre',
]

function scoreCtrTitle(title: string, niche: string): {
  score: number
  positives: string[]
  improvements: string[]
  classification: string
} {
  let score = 0
  const positives: string[] = []
  const improvements: string[] = []

  const words = title.trim().split(/\s+/)
  const wordCount = words.length
  const lower = title.toLowerCase()

  // Word count
  if (wordCount >= 7 && wordCount <= 10) {
    score += 20
    positives.push(`Comprimento ideal (${wordCount} palavras)`)
  } else if (wordCount > 10 && wordCount <= 12) {
    score += 10
  }

  // Has number
  if (/\d+/.test(title)) {
    score += 15
    positives.push('Contém número (aumenta CTR)')
  } else {
    improvements.push('Considere adicionar um número (ex: "7 erros", "3 passos")')
  }

  // Trigger word
  const foundTrigger = TRIGGER_WORDS.find(w => lower.includes(w))
  if (foundTrigger) {
    score += 20
    positives.push(`Palavra-gatilho presente: "${foundTrigger}"`)
  } else {
    improvements.push('Adicione uma palavra-gatilho (como, guia, segredo, revelado...)')
  }

  // Year 2025/2026
  if (/\b(2025|2026)\b/.test(title)) {
    score += 10
    positives.push('Contém ano (urgência/atualidade)')
  }

  // First word is niche keyword
  const firstWord = (words[0] ?? '').toLowerCase()
  const nicheFirstWord = niche.split(/\s+/)[0]?.toLowerCase() ?? ''
  if (nicheFirstWord.length > 0 && firstWord.includes(nicheFirstWord)) {
    score += 20
    positives.push('Keyword do nicho na primeira posição')
  } else {
    improvements.push(`Considere iniciar com a keyword do nicho: "${nicheFirstWord}"`)
  }

  // Question
  if (/\?/.test(title)) {
    score += 10
    positives.push('Formato de pergunta (estimula curiosidade)')
  }

  // Penalties
  if (wordCount > 12) {
    score -= 15
    improvements.push(`Título longo (${wordCount} palavras) — reduza para até 12`)
  }
  if (title === title.toUpperCase() && wordCount > 2) {
    score -= 20
    improvements.push('Evite CAIXA ALTA completa — penaliza percepção de qualidade')
  }

  score = Math.max(0, Math.min(100, score))

  const classification = score >= 70
    ? '🟢 Alto'
    : score >= 40
      ? '🟡 Médio'
      : '🔴 Baixo'

  return { score, positives, improvements, classification }
}

export async function estimateCtrPotential(rawInput: unknown, _accessToken: string): Promise<string> {
  return withAudit('ESTIMATE_CTR_POTENTIAL', 'estimate_ctr_potential', async () => {
    checkRateLimit('estimate_ctr_potential')

    const input = EstimateCtrPotentialSchema.parse(rawInput)

    const results = input.titles.map((title, i) => {
      const { score, positives, improvements, classification } = scoreCtrTitle(title, input.niche)
      const posLines = positives.map(p => `   ✅ ${p}`).join('\n')
      const impLines = improvements.map(p => `   💡 ${p}`).join('\n')
      return [
        `### ${i + 1}. ${classification} (${score}/100) — _"${title}"_`,
        ...(posLines ? [posLines] : []),
        ...(impLines ? [impLines] : []),
      ].join('\n')
    })

    const sorted = [...input.titles]
      .map((t, i) => ({ t, score: scoreCtrTitle(t, input.niche).score, i }))
      .sort((a, b) => b.score - a.score)

    return [
      `## Estimativa de CTR Potencial — Nicho: "${input.niche}" (${input.regionCode})`,
      '',
      ...results,
      '',
      `### Ranking`,
      ...sorted.map((s, rank) => `${rank + 1}. _"${s.t}"_ — **${s.score}/100**`),
      '',
      '> ⚠️ Score estimado por heurísticas — não reflete dados internos do YouTube.',
    ].join('\n')
  })
}

// ─── suggest_hook_angles ──────────────────────────────────────────────────────

export const suggestHookAnglesDefinition = {
  name: 'suggest_hook_angles',
  description:
    'Gera 5 ângulos de gancho (hook) para a abertura de um vídeo. Usa padrões detectados nos vídeos mais populares do tópico para priorizar o gancho mais eficaz no nicho.',
  inputSchema: {
    type: 'object',
    properties: {
      videoTopic: { type: 'string', description: 'Tópico ou assunto do vídeo' },
      niche: { type: 'string', description: 'Nicho do canal' },
      targetAudience: { type: 'string', description: 'Público-alvo (opcional)' },
      regionCode: { type: 'string', description: 'Região: BR, US, PT, ES, AR', default: 'BR' },
    },
    required: ['videoTopic', 'niche'],
  },
} as const

export async function suggestHookAngles(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('SUGGEST_HOOK_ANGLES', 'suggest_hook_angles', async () => {
    checkRateLimit('suggest_hook_angles')

    const input = SuggestHookAnglesSchema.parse(rawInput)
    const client = getYouTubeClient(accessToken)

    const results = await searchVideos(client, input.videoTopic, 15, input.regionCode, 'viewCount')

    // Detect most common pattern
    const patternCount = new Map<string, number>()
    for (const r of results) {
      const title = r.snippet?.title ?? ''
      for (const p of detectPatterns(title)) {
        patternCount.set(p, (patternCount.get(p) ?? 0) + 1)
      }
    }

    const topPattern = [...patternCount.entries()]
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'como-fazer'

    const topic = input.videoTopic
    const audience = input.targetAudience ?? undefined

    // Define all 5 hook types
    const allHooks: Array<{ type: string; pattern: string; text: string }> = [
      {
        type: 'PROBLEMA IDENTIFICÁVEL',
        pattern: 'revelação-choque',
        text: `Se você já teve dificuldade com ${topic}, esse vídeo foi feito pra você. Eu já cometi esses erros e hoje vou mostrar exatamente como evitá-los. Nos próximos minutos você vai entender por que a maioria das pessoas falha em ${topic} — e o que fazer de diferente. Fique até o final porque a dica mais importante vem lá na reta final.`,
      },
      {
        type: 'ESTATÍSTICA/CHOQUE',
        pattern: 'número-lista',
        text: `A maioria dos ${audience ?? 'profissionais'} ignora ${topic} — e paga caro por isso. Estudos mostram que quem domina ${topic} tem resultados até 3x melhores do que quem improvisa. Hoje eu vou te mostrar os dados por trás disso e como você pode usar esse conhecimento ao seu favor. Bora lá?`,
      },
      {
        type: 'PROMESSA DIRETA',
        pattern: 'como-fazer',
        text: `Nos próximos minutos você vai aprender ${topic} do zero. Não importa se você nunca fez isso antes — esse método funciona para ${audience ?? 'qualquer pessoa'} que quer resultados rápidos. Eu já ensinei isso para centenas de pessoas e os resultados falam por si. Vamos começar.`,
      },
      {
        type: 'CURIOSIDADE/MISTÉRIO',
        pattern: 'pergunta',
        text: `Existe uma abordagem sobre ${topic} que pouquíssimos ${audience ?? 'criadores'} conhecem. Não está nos tutoriais comuns. Não é o que a maioria ensina. E quando você descobrir, vai entender por que seus resultados anteriores ficavam aquém do esperado. Continua assistindo — vale cada segundo.`,
      },
      {
        type: 'HISTÓRIA',
        pattern: 'outro',
        text: `Há alguns meses, um ${audience ?? 'profissional'} me procurou com um problema sério de ${topic}. Ele já tinha tentado de tudo — cursos, tutoriais, fóruns — e nada funcionava. Em 30 minutos de conversa encontramos a causa raiz. Hoje vou compartilhar com você exatamente o que descobrimos.`,
      },
    ]

    // Sort: dominant niche pattern first
    const sorted = [...allHooks].sort((a, b) => {
      if (a.pattern === topPattern) return -1
      if (b.pattern === topPattern) return 1
      return 0
    })

    const lines: string[] = [
      `## 5 Ângulos de Gancho — "${input.videoTopic}"`,
      `Nicho: ${input.niche} | Região: ${input.regionCode}`,
      `Padrão dominante no nicho: **${topPattern}** (em ${patternCount.get(topPattern) ?? 0} dos top 15 vídeos)`,
      '',
    ]

    for (const [i, hook] of sorted.entries()) {
      const badge = i === 0 ? ' ⭐ (padrão dominante no nicho)' : ''
      lines.push(`### ${i + 1}. ${hook.type}${badge}`)
      lines.push(`> ${hook.text}`)
      lines.push('')
    }

    return lines.join('\n')
  })
}

// ─── find_trending_keywords ───────────────────────────────────────────────────

export const findTrendingKeywordsDefinition = {
  name: 'find_trending_keywords',
  description:
    'Detecta keywords emergentes no nicho analisando padrões de vídeos recentes, views e tamanho dos canais. Classifica cada keyword como Emergente, Crescendo ou Estável.',
  inputSchema: {
    type: 'object',
    properties: {
      niche: { type: 'string', description: 'Nicho a pesquisar' },
      regionCode: { type: 'string', description: 'Região: BR, US, PT, ES, AR', default: 'BR' },
      maxKeywords: { type: 'number', description: 'Quantidade máxima de keywords (5-15)', default: 10 },
    },
    required: ['niche'],
  },
} as const

export async function findTrendingKeywords(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('FIND_TRENDING_KEYWORDS', 'find_trending_keywords', async () => {
    checkRateLimit('find_trending_keywords')

    const input = FindTrendingKeywordsSchema.parse(rawInput)
    const client = getYouTubeClient(accessToken)

    const n = input.niche
    const variations = [
      `${n} ia`,
      `${n} automação`,
      `${n} 2026`,
      `como ${n}`,
      `${n} tutorial`,
      `${n} para iniciantes`,
      `${n} avançado`,
      `${n} ferramentas`,
      `aprender ${n}`,
      `${n} passo a passo`,
      `${n} gratuito`,
      `melhor ${n}`,
    ]

    const now = Date.now()
    const RECENT_DAYS = 180

    interface KeywordScore {
      keyword: string
      score: number
      label: string
      videoCount: number
      recentPct: number
    }

    const scores: KeywordScore[] = []

    // Process sequentially to avoid quota burst
    for (const kw of variations) {
      const results = await searchVideos(client, kw, 5, input.regionCode, 'relevance')
      const videoIds = results.map(r => r.id?.videoId).filter((id): id is string => !!id)
      if (videoIds.length === 0) continue

      // Fetch video details in parallel (within single keyword)
      const videos = (await Promise.all(videoIds.map(id => getVideoById(client, id)))).filter(Boolean)
      if (videos.length === 0) continue

      const recentVideos = videos.filter(v => {
        const pub = new Date(v?.snippet?.publishedAt ?? 0).getTime()
        return (now - pub) / 86_400_000 < RECENT_DAYS
      })
      const oldVideos = videos.filter(v => {
        const pub = new Date(v?.snippet?.publishedAt ?? 0).getTime()
        return (now - pub) / 86_400_000 >= RECENT_DAYS
      })

      const recentPct = (recentVideos.length / videos.length) * 100
      const recentViewsAvg = recentVideos.length > 0
        ? recentVideos.reduce((s, v) => s + parseInt(v?.statistics?.viewCount ?? '0', 10), 0) / recentVideos.length
        : 0
      const oldViewsAvg = oldVideos.length > 0
        ? oldVideos.reduce((s, v) => s + parseInt(v?.statistics?.viewCount ?? '0', 10), 0) / oldVideos.length
        : 0

      // Channel subscriber check (max 5 channels per keyword)
      const channelIds = [...new Set(
        videos.map(v => v?.snippet?.channelId).filter((id): id is string => !!id),
      )].slice(0, 5)

      const subsArr = await Promise.all(channelIds.map(async cid => {
        const stats = await getChannelStats(client, cid)
        return parseInt(stats?.subscriberCount ?? '0', 10)
      }))
      const smallChannelPct = subsArr.length > 0
        ? (subsArr.filter(s => s < 100_000).length / subsArr.length) * 100
        : 0

      // Score calculation
      const recentScore = (recentPct / 100) * 35
      const momentumScore = recentViewsAvg > oldViewsAvg ? 30 : 0
      const smallChannelScore = (smallChannelPct / 100) * 25
      const lowCountBonus = videos.length < 3 ? 10 : 0

      const totalScore = Math.min(100, Math.round(recentScore + momentumScore + smallChannelScore + lowCountBonus))
      const label = totalScore >= 75 ? '🔥 Emergente' : totalScore >= 50 ? '📈 Crescendo' : '📊 Estável'

      scores.push({
        keyword: kw,
        score: totalScore,
        label,
        videoCount: videos.length,
        recentPct: Math.round(recentPct),
      })
    }

    const sorted = scores.sort((a, b) => b.score - a.score).slice(0, input.maxKeywords)

    if (sorted.length === 0) return `Nenhum dado encontrado para o nicho "${input.niche}".`

    const lines: string[] = [
      `## Keywords Emergentes — Nicho: "${input.niche}" (${input.regionCode})`,
      '',
      '| # | Keyword | Status | Score | Recentes % | Vídeos |',
      '|---|---------|--------|-------|-----------|--------|',
      ...sorted.map((s, i) =>
        `| ${i + 1} | \`${s.keyword}\` | ${s.label} | ${s.score}/100 | ${s.recentPct}% | ${s.videoCount} |`
      ),
      '',
      '> Recentes % = % de vídeos publicados nos últimos 180 dias no top 5 resultados.',
    ]

    return lines.join('\n')
  })
}

// ─── analyze_retention_signals ────────────────────────────────────────────────

export const analyzeRetentionSignalsDefinition = {
  name: 'analyze_retention_signals',
  description:
    'Analisa proxies de retenção (engagement rate, amplification, duração, capítulos) dos top vídeos do nicho. Identifica padrões estruturais dos vídeos com alta retenção e gera recomendações de roteiro.',
  inputSchema: {
    type: 'object',
    properties: {
      niche: { type: 'string', description: 'Nicho a analisar' },
      regionCode: { type: 'string', description: 'Região: BR, US, PT, ES, AR', default: 'BR' },
      videoCount: { type: 'number', description: 'Quantidade de vídeos a analisar (10-20)', default: 20 },
      minViews: { type: 'number', description: 'Views mínimas para incluir vídeo na análise', default: 10000 },
    },
    required: ['niche'],
  },
} as const

export async function analyzeRetentionSignals(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('ANALYZE_RETENTION_SIGNALS', 'analyze_retention_signals', async () => {
    checkRateLimit('analyze_retention_signals')

    const input = AnalyzeRetentionSignalsSchema.parse(rawInput)
    const client = getYouTubeClient(accessToken)

    const results = await searchVideos(client, input.niche, input.videoCount, input.regionCode, 'viewCount')
    const videoIds = results.map(r => r.id?.videoId).filter((id): id is string => !!id)
    if (videoIds.length === 0) return `Nenhum vídeo encontrado para "${input.niche}".`

    // Fetch all video details
    const videosRes = await client.videos.list({
      part: ['snippet', 'statistics', 'contentDetails'],
      id: videoIds,
    })
    const allVideos = videosRes.data.items ?? []

    // Batch fetch channel subscribers
    const uniqueChannelIds = [...new Set(
      allVideos.map(v => v.snippet?.channelId).filter((id): id is string => !!id),
    )]
    const subMap = new Map<string, number>()
    await Promise.all(uniqueChannelIds.map(async cid => {
      const stats = await getChannelStats(client, cid)
      subMap.set(cid, parseInt(stats?.subscriberCount ?? '0', 10))
    }))

    interface VideoAnalysis {
      title: string
      views: number
      engagementRate: number
      amplification: number
      durationMinutes: number
      hasChapters: boolean
      highRetention: boolean
    }

    const analyzed: VideoAnalysis[] = []
    for (const v of allVideos) {
      const views = parseInt(v.statistics?.viewCount ?? '0', 10)
      if (views < input.minViews) continue

      const likes = parseInt(v.statistics?.likeCount ?? '0', 10)
      const comments = parseInt(v.statistics?.commentCount ?? '0', 10)
      const engagementRate = views > 0 ? (likes + comments) / views * 100 : 0

      const chId = v.snippet?.channelId ?? ''
      const subs = subMap.get(chId) ?? 0
      const amplification = subs > 0 ? views / subs : 0

      const duration = v.contentDetails?.duration ?? ''
      const durationMinutes = parseDurationMinutes(duration)

      const description = v.snippet?.description ?? ''
      const hasChapters = /\d+:\d+/.test(description)

      const highRetention = engagementRate > 5 || amplification > 2

      analyzed.push({
        title: v.snippet?.title ?? '',
        views,
        engagementRate,
        amplification,
        durationMinutes,
        hasChapters,
        highRetention,
      })
    }

    if (analyzed.length === 0) {
      return `Nenhum vídeo encontrado com mais de ${input.minViews.toLocaleString('pt-BR')} views no nicho "${input.niche}".`
    }

    const highRetention = analyzed.filter(v => v.highRetention)
    const hasHR = highRetention.length > 0

    const avgDuration = hasHR
      ? highRetention.reduce((s, v) => s + v.durationMinutes, 0) / highRetention.length
      : 0
    const avgEngagement = hasHR
      ? highRetention.reduce((s, v) => s + v.engagementRate, 0) / highRetention.length
      : 0
    const avgAmplification = hasHR
      ? highRetention.reduce((s, v) => s + v.amplification, 0) / highRetention.length
      : 0
    const chaptersPct = hasHR
      ? Math.round((highRetention.filter(v => v.hasChapters).length / highRetention.length) * 100)
      : 0

    // Title pattern analysis on high-retention videos
    const patternCount = new Map<string, number>()
    for (const v of highRetention) {
      for (const p of detectPatterns(v.title)) {
        patternCount.set(p, (patternCount.get(p) ?? 0) + 1)
      }
    }
    const topPatterns = [...patternCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([p, c]) => `${p} (${c}x)`)

    const fmtPct = (n: number) => n.toFixed(2) + '%'

    const recommendations = [
      `- Duração ideal: **${Math.round(avgDuration)} min** (${Math.round(avgDuration - 2)}–${Math.round(avgDuration + 2)} min)`,
      `- ${chaptersPct >= 50 ? '✅ Use capítulos no vídeo' : '⚠️ Capítulos não são padrão no nicho — opcional'}`,
      `- Mire em engagement rate acima de **${fmtPct(avgEngagement)}**`,
      `- Padrões de título dominantes nos vídeos de alta retenção: **${topPatterns.join(', ') || 'variado'}**`,
    ]

    return [
      `## Sinais de Retenção — Nicho: "${input.niche}" (${input.regionCode})`,
      `Analisados: ${analyzed.length} vídeos (filtro: >${input.minViews.toLocaleString('pt-BR')} views)`,
      `Alta Retenção: ${highRetention.length} vídeos (${Math.round(highRetention.length / analyzed.length * 100)}%)`,
      '',
      '### Perfil dos vídeos de Alta Retenção',
      `| Métrica | Valor médio |`,
      `|---------|-------------|`,
      `| Duração | ${Math.round(avgDuration)} min |`,
      `| Engagement rate | ${fmtPct(avgEngagement)} |`,
      `| Views/inscrito | ${avgAmplification.toFixed(2)}x |`,
      `| Com capítulos | ${chaptersPct}% |`,
      '',
      '### Recomendações de estrutura de roteiro',
      ...recommendations,
      '',
      '> Alta Retenção = engagement rate > 5% OU views/inscrito > 2x.',
    ].join('\n')
  })
}

// ─── generate_content_calendar ────────────────────────────────────────────────

export const generateContentCalendarDefinition = {
  name: 'generate_content_calendar',
  description:
    'Gera um calendário de conteúdo de 14 a 30 dias para o nicho. Identifica gaps e keywords emergentes, sugere títulos usando padrões dos top vídeos e organiza por semana com dias e horários ideais.',
  inputSchema: {
    type: 'object',
    properties: {
      niche: { type: 'string', description: 'Nicho do canal' },
      periodDays: { type: 'number', description: 'Período em dias (14-30)', default: 30 },
      postsPerWeek: { type: 'number', description: 'Posts por semana (1-3)', default: 2 },
      includeShorts: { type: 'boolean', description: 'Incluir Shorts no calendário', default: true },
      regionCode: { type: 'string', description: 'Região: BR, US, PT, ES, AR', default: 'BR' },
    },
    required: ['niche'],
  },
} as const

type VideoType = 'Tutorial' | 'Lista' | 'Tutorial Avançado' | 'Comparativo'

function inferVideoType(topic: string): VideoType {
  const t = topic.toLowerCase()
  if (/como|tutorial/.test(t)) return 'Tutorial'
  if (/ferramentas|lista/.test(t)) return 'Lista'
  if (/avan[cç]ado/.test(t)) return 'Tutorial Avançado'
  if (/vs|ou|comparati/.test(t)) return 'Comparativo'
  return 'Tutorial'
}

function durationRange(type: VideoType): string {
  if (type === 'Tutorial' || type === 'Tutorial Avançado') return '14-18 min'
  if (type === 'Lista') return '10-14 min'
  if (type === 'Comparativo') return '12-16 min'
  return '14-18 min'
}

function nextThursday(from: Date): Date {
  const d = new Date(from)
  const day = d.getDay() // 0=Sun, 4=Thu
  const daysUntilThursday = (4 - day + 7) % 7 || 7
  d.setDate(d.getDate() + daysUntilThursday)
  d.setHours(19, 0, 0, 0)
  return d
}

function addDays(d: Date, n: number): Date {
  const nd = new Date(d)
  nd.setDate(nd.getDate() + n)
  return nd
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

export async function generateContentCalendar(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('GENERATE_CONTENT_CALENDAR', 'generate_content_calendar', async () => {
    checkRateLimit('generate_content_calendar')

    const input = GenerateContentCalendarSchema.parse(rawInput)
    const client = getYouTubeClient(accessToken)

    const n = input.niche
    const now = Date.now()
    const RECENT_DAYS = 180

    // ── Phase 1: Gaps ──────────────────────────────────────────────────────────
    const subtopics = [
      `como ${n}`,
      `${n} tutorial`,
      `${n} avançado`,
      `${n} ferramentas`,
      `${n} 2026`,
    ]

    interface TopicEntry {
      topic: string
      priority: number  // gap=3, opportunity=2, saturated=0
      avgViews: number
    }

    const topicEntries: TopicEntry[] = []

    for (const sub of subtopics) {
      const results = await searchVideos(client, sub, 5, input.regionCode, 'relevance')
      const videoIds = results.map(r => r.id?.videoId).filter((id): id is string => !!id)
      if (videoIds.length === 0) {
        topicEntries.push({ topic: sub, priority: 3, avgViews: 0 })
        continue
      }
      const videos = (await Promise.all(videoIds.map(id => getVideoById(client, id)))).filter(Boolean)
      const viewsList = videos.map(v => parseInt(v?.statistics?.viewCount ?? '0', 10))
      const avgViews = viewsList.length > 0
        ? viewsList.reduce((a, b) => a + b, 0) / viewsList.length
        : 0
      const dates = videos.map(v => new Date(v?.snippet?.publishedAt ?? 0).getTime()).filter(d => d > 0)
      const newestMs = dates.length > 0 ? Math.max(...dates) : 0
      const newestDaysAgo = newestMs > 0 ? Math.round((now - newestMs) / 86_400_000) : 999

      const videoCount = results.length
      let priority: number
      if ((videoCount <= 5 && avgViews >= 30_000 && newestDaysAgo >= 90) || (videoCount <= 3 && avgViews >= 10_000)) {
        priority = 3
      } else if (videoCount >= 15 && newestDaysAgo <= 30) {
        priority = 0
      } else if (videoCount >= 10 && avgViews >= 100_000) {
        priority = 0
      } else {
        priority = 2
      }
      topicEntries.push({ topic: sub, priority, avgViews })
    }

    // ── Phase 2: Trending keywords ─────────────────────────────────────────────
    const trendingVariations = [
      `${n} ia`,
      `${n} automação`,
      `como ${n}`,
      `${n} para iniciantes`,
      `${n} avançado`,
      `${n} ferramentas`,
      `${n} 2026`,
      `aprender ${n}`,
    ]

    for (const kw of trendingVariations) {
      // skip if already in subtopics (avoid duplicates)
      if (topicEntries.some(e => e.topic === kw)) continue

      const results = await searchVideos(client, kw, 5, input.regionCode, 'relevance')
      const videoIds = results.map(r => r.id?.videoId).filter((id): id is string => !!id)
      if (videoIds.length === 0) continue

      const videos = (await Promise.all(videoIds.map(id => getVideoById(client, id)))).filter(Boolean)
      const recentCount = videos.filter(v => {
        const pub = new Date(v?.snippet?.publishedAt ?? 0).getTime()
        return (now - pub) / 86_400_000 < RECENT_DAYS
      }).length
      const recentPct = videos.length > 0 ? recentCount / videos.length : 0
      const avgViews = videos.length > 0
        ? videos.reduce((s, v) => s + parseInt(v?.statistics?.viewCount ?? '0', 10), 0) / videos.length
        : 0

      const emergenceScore = recentPct * 50 + Math.min(50, (avgViews / 100_000) * 50)
      if (emergenceScore >= 40) {
        topicEntries.push({ topic: kw, priority: 2, avgViews })
      }
    }

    // ── Phase 3: Top titles for pattern ───────────────────────────────────────
    const topResults = await searchVideos(client, n, 10, input.regionCode, 'viewCount')
    const topTitles = topResults.map(r => r.snippet?.title ?? '').filter(Boolean)

    const patternCount = new Map<string, number>()
    for (const t of topTitles) {
      for (const p of detectPatterns(t)) {
        patternCount.set(p, (patternCount.get(p) ?? 0) + 1)
      }
    }
    const topPattern = [...patternCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'como-fazer'

    // ── Phase 4: Assemble calendar ─────────────────────────────────────────────
    const weeksNeeded = Math.ceil(input.periodDays / 7)
    const totalVideos = input.postsPerWeek * weeksNeeded

    const selectedTopics = topicEntries
      .filter(e => e.priority > 0)
      .sort((a, b) => b.priority - a.priority || b.avgViews - a.avgViews)
      .slice(0, totalVideos)

    // Ensure we have enough topics (repeat if needed)
    while (selectedTopics.length < totalVideos && topicEntries.length > 0) {
      const extra = topicEntries[selectedTopics.length % topicEntries.length]
      if (extra) selectedTopics.push(extra)
    }

    function suggestTitle(topic: string): string {
      const type = inferVideoType(topic)
      if (topPattern === 'número-lista') return `5 ${topic.charAt(0).toUpperCase() + topic.slice(1)} que Você Precisa Conhecer`
      if (topPattern === 'como-fazer') return `Como ${topic.charAt(0).toUpperCase() + topic.slice(1)} do Zero (Guia Completo)`
      if (topPattern === 'pergunta') return `Você Sabe Realmente o Que é ${topic.charAt(0).toUpperCase() + topic.slice(1)}?`
      if (topPattern === 'guia-completo') return `Guia Definitivo: ${topic.charAt(0).toUpperCase() + topic.slice(1)} em 2026`
      if (topPattern === 'urgência-ano') return `${topic.charAt(0).toUpperCase() + topic.slice(1)} em 2026 — O Que Mudou`
      if (type === 'Lista') return `Top 7 Ferramentas de ${topic.charAt(0).toUpperCase() + topic.slice(1)}`
      return `Como ${topic.charAt(0).toUpperCase() + topic.slice(1)} — Tutorial Completo`
    }

    // Build week schedule
    const startDate = nextThursday(new Date())
    const lines: string[] = [
      `## 📅 Calendário de Conteúdo — "${input.niche}"`,
      `Período: ${input.periodDays} dias | ${input.postsPerWeek}x/semana${input.includeShorts ? ' + Shorts' : ''}`,
      `Padrão dominante: **${topPattern}**`,
      '',
    ]

    let topicIndex = 0

    for (let week = 0; week < weeksNeeded; week++) {
      const weekStart = addDays(startDate, week * 7)
      lines.push(`### Semana ${week + 1}`)

      // Main videos schedule
      const mainSlots: Array<{ daysOffset: number; time: string; label: string }> = []

      if (input.postsPerWeek >= 1) {
        mainSlots.push({ daysOffset: 0, time: '19h', label: '🎬 Vídeo Principal' }) // Thursday
      }
      if (input.postsPerWeek >= 2) {
        mainSlots.push({ daysOffset: -2, time: '19h', label: '🎬 Vídeo' }) // Tuesday (Thu-2)
      }
      if (input.postsPerWeek >= 3) {
        mainSlots.push({ daysOffset: 1, time: '19h', label: '🎬 Vídeo' }) // Friday (Thu+1)
      }

      for (const slot of mainSlots) {
        if (topicIndex >= selectedTopics.length) break
        const entry = selectedTopics[topicIndex++]
        if (!entry) break
        const vDate = addDays(weekStart, slot.daysOffset)
        const vType = inferVideoType(entry.topic)
        const title = suggestTitle(entry.topic)
        const duration = durationRange(vType)
        lines.push(
          `- **${formatDate(vDate)} ${slot.time}** — ${slot.label}: _"${title}"_`,
          `  Tipo: ${vType} | Duração: ${duration} | Prioridade: ${'⭐'.repeat(entry.priority)}`,
        )
      }

      // Short (Saturday 10h)
      if (input.includeShorts) {
        const thursTopic = selectedTopics[topicIndex - input.postsPerWeek]
        const shortTitle = thursTopic
          ? `${thursTopic.topic.charAt(0).toUpperCase() + thursTopic.topic.slice(1)} em 60s`
          : `${n} — Short`
        const satDate = addDays(weekStart, 2) // Sat = Thu+2
        lines.push(
          `- **${formatDate(satDate)} 10h** — 📱 Short: _"${shortTitle}"_`,
          `  Tipo: Short | Duração: 45-60s | Complemento do vídeo de quinta`,
        )
      }

      lines.push('')
    }

    lines.push('> Datas calculadas a partir da próxima quinta-feira. Ajuste conforme seu fluxo de produção.')

    return lines.join('\n')
  })
}
