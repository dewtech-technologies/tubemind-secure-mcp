/**
 * Tools MCP da Camada 2 — Vision.
 *
 * - analyze_thumbnail_visuals: análise agregada do nicho (busca top N vídeos)
 * - score_my_thumbnail: avaliação de uma thumb candidata (URL ou base64)
 */

import { z } from 'zod'
import { withAudit } from '../security/audit.service.js'
import { isAnthropicAvailable } from '../services/anthropic.service.js'
import { getYouTubeClient, searchVideos } from '../services/youtube.service.js'
import { fetchThumbnail } from '../services/thumbnail-fetcher.service.js'
import { analyzeThumbnails, scoreThumbnail } from '../services/vision.service.js'
import { recordQuota } from '../services/quota.service.js'
import { sha256 } from '../utils/hash.js'
import { estimateVisionCost } from '../config/vision-pricing.js'

// ─── Schemas Zod ─────────────────────────────────────────────────────────────

export const AnalyzeThumbnailVisualsSchema = z.object({
  niche: z.string().min(2).max(120),
  regionCode: z.string().regex(/^[A-Z]{2}$/).default('BR'),
  maxThumbs: z.number().int().min(3).max(20).default(15),
  fresh: z.boolean().default(false),
})

export const ScoreMyThumbnailSchema = z.object({
  thumbnailInput: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('url'), value: z.string().url() }),
    z.object({ kind: z.literal('base64'), value: z.string().min(100) }),
  ]),
  niche: z.string().min(2).max(120),
  regionCode: z.string().regex(/^[A-Z]{2}$/).default('BR'),
})

// ─── Tool definitions ────────────────────────────────────────────────────────

export const analyzeThumbnailVisualsDefinition = {
  name: 'analyze_thumbnail_visuals',
  description:
    'Analisa visualmente as thumbnails dos top N vídeos do nicho via Claude Vision: cores dominantes, presença de face, texto, padrão visual, score de clicabilidade. Retorna análise individual + agregada do nicho + recomendação concreta. Requer ANTHROPIC_API_KEY.',
  inputSchema: {
    type: 'object',
    properties: {
      niche: { type: 'string', description: 'Nicho/tema YouTube a analisar' },
      regionCode: { type: 'string', description: 'Região (BR, US, PT, ES, AR)', default: 'BR' },
      maxThumbs: {
        type: 'number',
        description: 'Quantidade de thumbnails a analisar (3-20)',
        default: 15,
      },
      fresh: { type: 'boolean', description: 'Ignorar cache e re-analisar', default: false },
    },
    required: ['niche'],
  },
} as const

export const scoreMyThumbnailDefinition = {
  name: 'score_my_thumbnail',
  description:
    'Avalia uma thumbnail candidata (URL pública YouTube ou base64) comparando com o padrão do nicho. Retorna score 0-100, alinhamento %, e top 3 ajustes. Requer ANTHROPIC_API_KEY.',
  inputSchema: {
    type: 'object',
    properties: {
      thumbnailInput: {
        type: 'object',
        description:
          'Ou { kind: "url", value: "https://i.ytimg.com/..." } ou { kind: "base64", value: "<base64>" }',
      },
      niche: { type: 'string', description: 'Nicho do canal' },
      regionCode: { type: 'string', default: 'BR' },
    },
    required: ['thumbnailInput', 'niche'],
  },
} as const

// ─── Handlers ────────────────────────────────────────────────────────────────

export async function analyzeThumbnailVisuals(
  rawInput: unknown,
  accessToken: string,
): Promise<string> {
  return withAudit('ANALYZE_THUMBNAIL_VISUALS', 'analyze_thumbnail_visuals', async () => {
    if (!isAnthropicAvailable()) {
      return '⚠️ Camada 2 (Visão) requer `ANTHROPIC_API_KEY` configurada no .env. Veja .env.example.'
    }

    const input = AnalyzeThumbnailVisualsSchema.parse(rawInput)
    const tokenHash = sha256(accessToken)
    const client = getYouTubeClient(accessToken)

    recordQuota('youtube:search.list', tokenHash, 'analyze_thumbnail_visuals')
    const searchResults = await searchVideos(
      client,
      input.niche,
      input.maxThumbs,
      input.regionCode,
      'viewCount',
    )
    const videoIds = searchResults.map((r) => r.id?.videoId).filter((id): id is string => !!id)

    if (videoIds.length === 0) {
      return `Nenhum vídeo encontrado para "${input.niche}" em ${input.regionCode}.`
    }

    const estimateUsd = estimateVisionCost(videoIds.length)
    const preFlight = `> 💰 **Estimativa de custo:** $${estimateUsd.toFixed(4)} para ${videoIds.length} thumbs (Claude Vision Haiku)\n\n`

    const result = await analyzeThumbnails(
      { videoIds, niche: input.niche, fresh: input.fresh },
      tokenHash,
      'analyze_thumbnail_visuals',
    )

    return preFlight + renderAnalysisMarkdown(result)
  })
}

export async function scoreMyThumbnail(
  rawInput: unknown,
  accessToken: string,
): Promise<string> {
  return withAudit('SCORE_MY_THUMBNAIL', 'score_my_thumbnail', async () => {
    if (!isAnthropicAvailable()) {
      return '⚠️ Camada 2 (Visão) requer `ANTHROPIC_API_KEY` configurada no .env.'
    }

    const input = ScoreMyThumbnailSchema.parse(rawInput)
    const tokenHash = sha256(accessToken)
    const client = getYouTubeClient(accessToken)

    // 1. Resolve thumbnail input
    let buffer: Buffer
    let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg'

    if (input.thumbnailInput.kind === 'url') {
      const fetched = await fetchThumbnail(input.thumbnailInput.value)
      buffer = fetched.buffer
      mediaType = fetched.mediaType
    } else {
      buffer = Buffer.from(input.thumbnailInput.value, 'base64')
      if (buffer.length > 5 * 1024 * 1024) {
        throw new Error('Imagem base64 > 5MB')
      }
    }

    // 2. Buscar baseline do nicho (reusa cache de analyze_thumbnail_visuals)
    recordQuota('youtube:search.list', tokenHash, 'score_my_thumbnail')
    const searchResults = await searchVideos(client, input.niche, 5, input.regionCode, 'viewCount')
    const baselineIds = searchResults.map((r) => r.id?.videoId).filter((id): id is string => !!id)

    const baseline = await analyzeThumbnails(
      { videoIds: baselineIds, niche: input.niche },
      tokenHash,
      'analyze_thumbnail_visuals',
    )

    // 3. Score
    const result = await scoreThumbnail(
      { thumbnail: { buffer, mediaType }, niche: input.niche, baselineItems: baseline.items },
      tokenHash,
      'score_my_thumbnail',
    )

    return renderScoreMarkdown(result, input.niche)
  })
}

// ─── Markdown renderers ──────────────────────────────────────────────────────

function renderAnalysisMarkdown(r: import('../services/vision.service.js').VisionAnalysisResult): string {
  const lines: string[] = []
  lines.push(`## Análise Visual — Nicho: "${r.niche}"`)
  lines.push(
    `Analisadas: ${r.thumbnailsAnalyzed}/${r.thumbnailsRequested} thumbnails | Custo: $${r.estimatedCostUsd.toFixed(4)}`,
  )
  lines.push('')

  if (r.items.length === 0) {
    lines.push('> Nenhuma thumbnail pôde ser analisada.')
    if (r.skippedReasons.length > 0) {
      lines.push('')
      lines.push('**Skipped:**')
      for (const s of r.skippedReasons.slice(0, 5)) lines.push(`- \`${s.videoId}\`: ${s.reason}`)
    }
    return lines.join('\n')
  }

  // Padrão do nicho (agregado)
  const facePct = Math.round((r.items.filter((i) => i.face_analysis.present).length / r.items.length) * 100)
  const avgWords = Math.round(
    r.items.reduce((s, i) => s + i.text_overlay.word_count, 0) / r.items.length,
  )
  const avgReadability = Math.round(
    r.items.reduce((s, i) => s + i.mobile_readability_score, 0) / r.items.length,
  )
  const patternCount = new Map<string, number>()
  for (const i of r.items) {
    patternCount.set(i.dominant_pattern, (patternCount.get(i.dominant_pattern) ?? 0) + 1)
  }
  const topPattern = [...patternCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'outro'

  lines.push('### Padrão do Nicho')
  lines.push(`- 🎭 **Face presente:** ${facePct}% das thumbs`)
  lines.push(`- 📝 **Texto médio:** ${avgWords} palavras`)
  lines.push(`- 📱 **Legibilidade mobile média:** ${avgReadability}/100`)
  lines.push(`- 🖼️ **Padrão dominante:** ${topPattern}`)
  lines.push('')

  lines.push('### Top 5 thumbs analisadas')
  lines.push('| # | Padrão | Face | Texto | Mobile | Score |')
  lines.push('|---|--------|------|-------|--------|-------|')
  for (const [i, t] of r.items.slice(0, 5).entries()) {
    const face = t.face_analysis.present ? `✅ ${t.face_analysis.dominant_expression ?? 'sim'}` : '❌'
    lines.push(
      `| ${i + 1} | ${t.dominant_pattern} | ${face} | ${t.text_overlay.word_count}w | ${t.mobile_readability_score} | ${t.clickability_score} |`,
    )
  }
  lines.push('')

  lines.push('### 💡 Recomendação')
  lines.push(
    `Para o nicho **${r.niche}**, use **${topPattern}**${facePct >= 50 ? ' com face' : ''}, texto de ~${avgWords} palavras, e garanta legibilidade mobile ≥ ${Math.max(70, avgReadability)}.`,
  )

  if (r.skippedReasons.length > 0) {
    lines.push('')
    lines.push(`> ⚠️ ${r.skippedReasons.length} thumb(s) puladas: ` + r.skippedReasons.map((s) => s.videoId).join(', '))
  }

  return lines.join('\n')
}

function renderScoreMarkdown(
  r: import('../services/vision.service.js').ScoreThumbnailResult,
  niche: string,
): string {
  const lines: string[] = []
  const badge =
    r.yourScore >= 70 ? '🟢 Alto' : r.yourScore >= 40 ? '🟡 Médio' : '🔴 Baixo'

  lines.push(`## Score da sua thumbnail — Nicho: "${niche}"`)
  lines.push('')
  lines.push(`**Score: ${r.yourScore}/100 — ${badge}**`)
  lines.push(`**Alinhamento com nicho:** ${r.alignmentPct}%`)
  lines.push(`Custo da análise: $${r.estimatedCostUsd.toFixed(4)}`)
  lines.push('')

  lines.push('### Análise')
  lines.push(`- Padrão detectado: **${r.yourAnalysis.dominant_pattern}**`)
  const face = r.yourAnalysis.face_analysis
  lines.push(
    `- Face: ${face.present ? `presente (${face.dominant_expression ?? 'expressão não identificada'})` : 'ausente'}`,
  )
  lines.push(
    `- Texto: ${r.yourAnalysis.text_overlay.word_count} palavras${r.yourAnalysis.text_overlay.content_preview ? ` ("${r.yourAnalysis.text_overlay.content_preview}")` : ''}`,
  )
  lines.push(`- Legibilidade mobile: ${r.yourAnalysis.mobile_readability_score}/100`)
  lines.push(`- Justificativa do score: _${r.yourAnalysis.clickability_justification}_`)
  lines.push('')

  if (r.improvements.length > 0) {
    lines.push('### 💡 Top ajustes')
    for (const [i, imp] of r.improvements.entries()) {
      lines.push(`${i + 1}. ${imp}`)
    }
  }

  return lines.join('\n')
}
