/**
 * Tools MCP da Camada 3 — NLP.
 *
 * - analyze_video_comments: sentiment + dores + ideias de próximos vídeos
 * - analyze_video_transcript: estrutura, hooks, CTAs (task-010)
 * - reverse_engineer_viral_video: combina Camadas 2+3 (task-011)
 */

import { z } from 'zod'
import { withAudit } from '../security/audit.service.js'
import { isAnthropicAvailable } from '../services/anthropic.service.js'
import { getYouTubeClient } from '../services/youtube.service.js'
import {
  analyzeComments,
  analyzeTranscript,
  reverseEngineerViralVideo,
} from '../services/nlp.service.js'
import { sha256 } from '../utils/hash.js'

// ─── Schemas ─────────────────────────────────────────────────────────────────

export const AnalyzeVideoCommentsSchema = z.object({
  videoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/, 'videoId deve ter 11 chars [a-zA-Z0-9_-]'),
  maxComments: z.number().int().min(20).max(500).default(100),
  fresh: z.boolean().default(false),
})

export const AnalyzeVideoTranscriptSchema = z.object({
  videoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/, 'videoId deve ter 11 chars [a-zA-Z0-9_-]'),
  preferredLanguages: z.array(z.string()).default(['pt', 'pt-BR', 'en', 'es']),
  fresh: z.boolean().default(false),
})

export const ReverseEngineerViralVideoSchema = z.object({
  videoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/),
  myNiche: z.string().min(2).max(120),
  regionCode: z.string().regex(/^[A-Z]{2}$/).default('BR'),
  includeThumbnail: z.boolean().default(true),
  fresh: z.boolean().default(false),
})

// ─── Definitions ─────────────────────────────────────────────────────────────

export const analyzeVideoCommentsDefinition = {
  name: 'analyze_video_comments',
  description:
    'Analisa comentários de um vídeo YouTube extraindo: sentiment, top 10 dores, top 10 perguntas, pedidos de tema, 5 ideias de próximos vídeos e comentários âncora. PII filtrada e proteção contra prompt injection. Requer ANTHROPIC_API_KEY.',
  inputSchema: {
    type: 'object',
    properties: {
      videoId: { type: 'string', description: 'YouTube video ID (11 chars)' },
      maxComments: { type: 'number', description: 'Comentários a analisar (20-500)', default: 100 },
      fresh: { type: 'boolean', default: false },
    },
    required: ['videoId'],
  },
} as const

export const reverseEngineerViralVideoDefinition = {
  name: 'reverse_engineer_viral_video',
  description:
    'Engenharia reversa COMPLETA de um vídeo viral: combina análise de comentários (Camada 3), transcrição (Camada 3) e thumbnail (Camada 2) em um relatório unificado sobre POR QUE viralizou + como replicar no SEU nicho + templates de roteiro e thumbnail inspiradas. Custo: ~$0.04-0.08. Requer ANTHROPIC_API_KEY.',
  inputSchema: {
    type: 'object',
    properties: {
      videoId: { type: 'string', description: 'YouTube video ID (11 chars) do vídeo viral' },
      myNiche: { type: 'string', description: 'Seu nicho YouTube — para adaptação' },
      regionCode: { type: 'string', default: 'BR' },
      includeThumbnail: {
        type: 'boolean',
        description: 'Incluir análise da thumbnail (mais caro)',
        default: true,
      },
      fresh: { type: 'boolean', default: false },
    },
    required: ['videoId', 'myNiche'],
  },
} as const

export const analyzeVideoTranscriptDefinition = {
  name: 'analyze_video_transcript',
  description:
    'Engenharia reversa via transcrição YouTube: extrai estrutura (hook, intro, seções, CTAs com timestamps), tipo de hook, técnicas de retenção e densidade de informação. Usa Claude Sonnet (custo ~$0.02). Requer ANTHROPIC_API_KEY.',
  inputSchema: {
    type: 'object',
    properties: {
      videoId: { type: 'string', description: 'YouTube video ID (11 chars)' },
      preferredLanguages: {
        type: 'array',
        items: { type: 'string' },
        description: 'Linguagens em ordem de preferência',
        default: ['pt', 'pt-BR', 'en', 'es'],
      },
      fresh: { type: 'boolean', default: false },
    },
    required: ['videoId'],
  },
} as const

// ─── Handlers ────────────────────────────────────────────────────────────────

export async function analyzeVideoComments(
  rawInput: unknown,
  accessToken: string,
): Promise<string> {
  return withAudit('ANALYZE_VIDEO_COMMENTS', 'analyze_video_comments', async () => {
    if (!isAnthropicAvailable()) {
      return '⚠️ Camada 3 (NLP) requer `ANTHROPIC_API_KEY` configurada no .env.'
    }

    const input = AnalyzeVideoCommentsSchema.parse(rawInput)
    const tokenHash = sha256(accessToken)
    const client = getYouTubeClient(accessToken)

    const result = await analyzeComments(
      client,
      { videoId: input.videoId, maxComments: input.maxComments, fresh: input.fresh },
      tokenHash,
      'analyze_video_comments',
    )

    return renderCommentsMarkdown(result)
  })
}

export async function reverseEngineerViralVideoHandler(
  rawInput: unknown,
  accessToken: string,
): Promise<string> {
  return withAudit('REVERSE_ENGINEER_VIRAL_VIDEO', 'reverse_engineer_viral_video', async () => {
    if (!isAnthropicAvailable()) {
      return '⚠️ Camada 3 requer `ANTHROPIC_API_KEY` configurada no .env.'
    }

    const input = ReverseEngineerViralVideoSchema.parse(rawInput)
    const tokenHash = sha256(accessToken)
    const client = getYouTubeClient(accessToken)

    const preFlightCost = input.includeThumbnail ? 0.08 : 0.04
    const preFlight = `> 💰 **Estimativa:** ~$${preFlightCost.toFixed(4)} para reverse engineering completo${input.includeThumbnail ? ' (com thumbnail)' : ' (sem thumbnail)'}\n\n`

    const result = await reverseEngineerViralVideo(
      client,
      {
        videoId: input.videoId,
        myNiche: input.myNiche,
        ...(input.regionCode !== undefined ? { regionCode: input.regionCode } : {}),
        includeThumbnail: input.includeThumbnail,
        fresh: input.fresh,
      },
      tokenHash,
      'reverse_engineer_viral_video',
    )

    const header = `# Engenharia Reversa — \`${result.videoId}\` para nicho "${result.myNiche}"
> Custo total: $${result.estimatedCostUsd.toFixed(4)} | Comentários: ${result.commentsAnalyzed} | Transcript: ${result.transcriptAvailable ? '✓' : '✗'} | Thumbnail: ${result.thumbnailIncluded ? '✓' : '✗'}

---

`

    return preFlight + header + result.markdown
  })
}

export async function analyzeVideoTranscript(
  rawInput: unknown,
  accessToken: string,
): Promise<string> {
  return withAudit('ANALYZE_VIDEO_TRANSCRIPT', 'analyze_video_transcript', async () => {
    if (!isAnthropicAvailable()) {
      return '⚠️ Camada 3 (NLP) requer `ANTHROPIC_API_KEY` configurada no .env.'
    }

    const input = AnalyzeVideoTranscriptSchema.parse(rawInput)
    const tokenHash = sha256(accessToken)
    const client = getYouTubeClient(accessToken)

    const result = await analyzeTranscript(
      client,
      {
        videoId: input.videoId,
        preferredLanguages: input.preferredLanguages,
        fresh: input.fresh,
      },
      tokenHash,
      'analyze_video_transcript',
    )

    return renderTranscriptMarkdown(result)
  })
}

function renderTranscriptMarkdown(
  r: import('../services/nlp.service.js').TranscriptAnalysisResult,
): string {
  const lines: string[] = []
  lines.push(`## Análise de Transcrição — vídeo \`${r.videoId}\``)

  if (!r.captionsAvailable) {
    lines.push('')
    lines.push('> ⚠️ Captions não disponíveis para este vídeo.')
    return lines.join('\n')
  }

  if (!r.analysis) {
    lines.push('')
    lines.push('> Caption presente mas vazia/inválida após parsing.')
    return lines.join('\n')
  }

  lines.push(`Idioma: \`${r.language}\` | Custo: $${r.estimatedCostUsd.toFixed(4)}`)
  lines.push('')

  const a = r.analysis

  lines.push(`### Hook (até ${a.hook.timestamp_end})`)
  lines.push(`- **Tipo:** ${a.hook.type}`)
  lines.push(`- **Resumo:** ${a.hook.summary}`)
  lines.push('')

  lines.push(`### Intro / Promessa (até ${a.intro.timestamp_end})`)
  lines.push(`> ${a.intro.promise}`)
  lines.push('')

  if (a.sections.length > 0) {
    lines.push('### Estrutura por seções')
    for (const s of a.sections) {
      lines.push(`- **${s.timestamp}** — _${s.title}_: ${s.summary}`)
    }
    lines.push('')
  }

  if (a.ctas.length > 0) {
    lines.push('### CTAs detectados')
    for (const cta of a.ctas) {
      lines.push(`- **${cta.timestamp}** [${cta.type}]: ${cta.context}`)
    }
    lines.push('')
  }

  if (a.retention_techniques.length > 0) {
    lines.push(`### Técnicas de retenção: ${a.retention_techniques.join(', ')}`)
  }
  if (a.spoken_keywords.length > 0) {
    lines.push('')
    lines.push(`### Palavras-gatilho faladas (top): ${a.spoken_keywords.slice(0, 15).join(', ')}`)
  }
  lines.push('')
  lines.push(`> Densidade: ${a.words_per_minute_avg} palavras/min`)

  return lines.join('\n')
}

// ─── Markdown renderer ──────────────────────────────────────────────────────

function renderCommentsMarkdown(
  r: import('../services/nlp.service.js').CommentsAnalysisResult,
): string {
  const lines: string[] = []
  lines.push(`## Análise de Comentários — vídeo \`${r.videoId}\``)

  if (r.commentsDisabled) {
    lines.push('')
    lines.push('> ⚠️ Comentários desabilitados para este vídeo.')
    return lines.join('\n')
  }

  if (r.commentsAnalyzed === 0 || !r.analysis) {
    lines.push('')
    lines.push('> Vídeo sem comentários encontrados.')
    return lines.join('\n')
  }

  lines.push(`${r.commentsAnalyzed} comentários analisados | Custo: $${r.estimatedCostUsd.toFixed(4)}`)
  lines.push('')

  const a = r.analysis

  // Sentiment
  lines.push('### Sentiment')
  lines.push(`| Polaridade | % | Confidence |`)
  lines.push(`|-----------|---|------------|`)
  lines.push(`| 🟢 Positivo | ${a.sentiment.positive_pct}% | ${a.sentiment.confidence} |`)
  lines.push(`| ⚪ Neutro | ${a.sentiment.neutral_pct}% | ${a.sentiment.confidence} |`)
  lines.push(`| 🔴 Negativo | ${a.sentiment.negative_pct}% | ${a.sentiment.confidence} |`)
  lines.push('')

  // Pains
  if (a.pains.length > 0) {
    lines.push('### 🔥 Top dores mencionadas')
    for (const [i, p] of a.pains.entries()) {
      lines.push(`${i + 1}. **"${p.text}"** (${p.frequency}x)`)
    }
    lines.push('')
  }

  // Questions
  if (a.questions.length > 0) {
    lines.push('### ❓ Perguntas frequentes')
    for (const [i, q] of a.questions.entries()) {
      lines.push(`${i + 1}. ${q}`)
    }
    lines.push('')
  }

  // Theme requests
  if (a.theme_requests.length > 0) {
    lines.push('### 💬 Pedidos de tema')
    for (const t of a.theme_requests) {
      lines.push(`- ${t.theme} (${t.mentions} menções)`)
    }
    lines.push('')
  }

  // Next video ideas
  if (a.next_video_ideas.length > 0) {
    lines.push('### 🎬 5 ideias de próximos vídeos')
    for (const [i, idea] of a.next_video_ideas.entries()) {
      lines.push(`${i + 1}. **"${idea.title}"**`)
      lines.push(`   → _${idea.justification}_`)
    }
    lines.push('')
  }

  // Anchor comments
  if (a.anchor_comments.length > 0) {
    lines.push('### ⭐ Comentários âncora (mais engajamento)')
    for (const c of a.anchor_comments) {
      lines.push(`- **${c.author}** (${c.likes} likes, ${c.replies} replies): "${c.excerpt}"`)
    }
  }

  return lines.join('\n')
}
