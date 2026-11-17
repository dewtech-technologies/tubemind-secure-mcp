/**
 * Vision Service — orquestra análise de thumbnails YouTube via Claude Vision.
 *
 * Responsabilidades:
 * - Coordenar fetch de N thumbnails (com SSRF + EXIF strip já garantidos)
 * - Aplicar guards (budget, rate limit) antes de chamar Anthropic
 * - Chamar callVision do anthropic.service
 * - Parsear + validar JSON output via Zod (output.schemas)
 * - Cachear resultados (TTL 7d via withCache)
 */

import { withCache } from './cache.service.js'
import { fetchThumbnail, resolveThumbnailUrl } from './thumbnail-fetcher.service.js'
import { callVision } from './anthropic.service.js'
import { assertBudgetAvailable } from './../security/budget-guard.service.js'
import { checkVisionRateLimit } from './../security/vision-rate-limiter.service.js'
import {
  VISION_THUMBNAIL_SYSTEM_PROMPT,
  visionThumbnailUserText,
} from '../prompts/vision-thumbnail.prompt.js'
import {
  VisionThumbnailOutputSchema,
  type VisionThumbnailItemSchema,
} from '../schemas/output.schemas.js'
import { estimateVisionCost } from '../config/vision-pricing.js'
import type { z } from 'zod'

export type VisionThumbnailItem = z.infer<typeof VisionThumbnailItemSchema>

export interface VisionAnalysisInput {
  videoIds: readonly string[]
  niche: string
  fresh?: boolean
}

export interface VisionAnalysisResult {
  niche: string
  estimatedCostUsd: number
  thumbnailsRequested: number
  thumbnailsAnalyzed: number
  items: VisionThumbnailItem[]
  skippedReasons: Array<{ videoId: string; reason: string }>
}

/**
 * Analisa thumbnails de uma lista de vídeos. Falha gracioso em thumbs individuais
 * (vídeo deletado, sem maxres) — continua com as outras.
 */
export async function analyzeThumbnails(
  input: VisionAnalysisInput,
  tokenHash: string,
  toolName: string,
): Promise<VisionAnalysisResult> {
  return withCache(
    toolName,
    { videoIds: [...input.videoIds].sort(), niche: input.niche },
    tokenHash,
    async () => doAnalyze(input, tokenHash, toolName),
    { fresh: input.fresh ?? false },
  )
}

async function doAnalyze(
  input: VisionAnalysisInput,
  tokenHash: string,
  toolName: string,
): Promise<VisionAnalysisResult> {
  // Pre-flight: budget + rate limit antes de qualquer rede
  const estimatedCost = estimateVisionCost(input.videoIds.length)
  assertBudgetAvailable('vision', estimatedCost, tokenHash)
  checkVisionRateLimit(tokenHash, input.videoIds.length)

  // Resolve + fetch thumbnails em paralelo (com limite de 5 simultâneos)
  const skippedReasons: Array<{ videoId: string; reason: string }> = []
  const fetched: Array<{ videoId: string; buffer: Buffer; mediaType: 'image/jpeg' }> = []

  const concurrencyLimit = 5
  const batches: string[][] = []
  for (let i = 0; i < input.videoIds.length; i += concurrencyLimit) {
    batches.push([...input.videoIds.slice(i, i + concurrencyLimit)])
  }

  for (const batch of batches) {
    const results = await Promise.all(
      batch.map(async (videoId) => {
        try {
          const url = await resolveThumbnailUrl(videoId)
          if (!url) return { videoId, error: 'thumbnail-not-found' }
          const thumb = await fetchThumbnail(url)
          return { videoId, thumb }
        } catch (err) {
          return { videoId, error: err instanceof Error ? err.message : 'unknown' }
        }
      }),
    )
    for (const r of results) {
      if ('thumb' in r) {
        fetched.push({ videoId: r.videoId, buffer: r.thumb.buffer, mediaType: 'image/jpeg' })
      } else {
        skippedReasons.push({ videoId: r.videoId, reason: r.error })
      }
    }
  }

  if (fetched.length === 0) {
    return {
      niche: input.niche,
      estimatedCostUsd: 0,
      thumbnailsRequested: input.videoIds.length,
      thumbnailsAnalyzed: 0,
      items: [],
      skippedReasons,
    }
  }

  // Chama Claude Vision
  const visionResponse = await callVision(
    {
      systemPrompt: VISION_THUMBNAIL_SYSTEM_PROMPT,
      userText: visionThumbnailUserText(input.niche),
      images: fetched.map((f) => ({
        mediaType: f.mediaType,
        base64: f.buffer.toString('base64'),
      })),
    },
    tokenHash,
    toolName,
  )

  // Parse + validate output
  const parsed = parseAndValidate(visionResponse.text)

  return {
    niche: input.niche,
    estimatedCostUsd: visionResponse.estimatedCostUsd,
    thumbnailsRequested: input.videoIds.length,
    thumbnailsAnalyzed: parsed.thumbnails.length,
    items: parsed.thumbnails,
    skippedReasons,
  }
}

/**
 * Score de uma única thumbnail contra baseline do nicho.
 * Comparativo simples: análise individual + análise do nicho (cache) → diff.
 */
export interface ScoreThumbnailInput {
  thumbnail: { buffer: Buffer; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' }
  niche: string
  baselineItems: VisionThumbnailItem[]
}

export interface ScoreThumbnailResult {
  estimatedCostUsd: number
  yourScore: number
  alignmentPct: number
  improvements: string[]
  yourAnalysis: VisionThumbnailItem
}

export async function scoreThumbnail(
  input: ScoreThumbnailInput,
  tokenHash: string,
  toolName: string,
): Promise<ScoreThumbnailResult> {
  const estimatedCost = estimateVisionCost(1)
  assertBudgetAvailable('vision', estimatedCost, tokenHash)
  checkVisionRateLimit(tokenHash, 1)

  const visionResponse = await callVision(
    {
      systemPrompt: VISION_THUMBNAIL_SYSTEM_PROMPT,
      userText: visionThumbnailUserText(input.niche),
      images: [
        {
          mediaType: input.thumbnail.mediaType,
          base64: input.thumbnail.buffer.toString('base64'),
        },
      ],
    },
    tokenHash,
    toolName,
  )

  const parsed = parseAndValidate(visionResponse.text)
  const yourAnalysis = parsed.thumbnails[0]
  if (!yourAnalysis) throw new Error('Vision retornou análise vazia')

  // Calcula alinhamento com baseline
  const { alignmentPct, improvements } = computeAlignment(yourAnalysis, input.baselineItems)

  return {
    estimatedCostUsd: visionResponse.estimatedCostUsd,
    yourScore: yourAnalysis.clickability_score,
    alignmentPct,
    improvements,
    yourAnalysis,
  }
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function parseAndValidate(text: string): { thumbnails: VisionThumbnailItem[] } {
  // Tenta extrair bloco JSON (LLM pode prefixar com prosa apesar do prompt)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Vision output sem JSON detectável')

  let raw: unknown
  try {
    raw = JSON.parse(jsonMatch[0])
  } catch {
    throw new Error('Vision output JSON inválido')
  }

  const result = VisionThumbnailOutputSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`Vision output não passa no schema: ${result.error.message}`)
  }
  return result.data
}

function computeAlignment(
  yours: VisionThumbnailItem,
  baseline: VisionThumbnailItem[],
): { alignmentPct: number; improvements: string[] } {
  if (baseline.length === 0) {
    return { alignmentPct: 0, improvements: ['Sem baseline do nicho para comparar'] }
  }

  // Padrão dominante do nicho (moda)
  const patternCount = new Map<string, number>()
  for (const b of baseline) {
    patternCount.set(b.dominant_pattern, (patternCount.get(b.dominant_pattern) ?? 0) + 1)
  }
  const dominantPattern = [...patternCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]

  // Face presente em > 50% do nicho?
  const facePct = (baseline.filter((b) => b.face_analysis.present).length / baseline.length) * 100

  // Word count médio
  const avgWords =
    baseline.reduce((s, b) => s + b.text_overlay.word_count, 0) / baseline.length

  const improvements: string[] = []
  let matches = 0
  let total = 0

  total++
  if (yours.dominant_pattern === dominantPattern) matches++
  else improvements.push(`Padrão dominante do nicho é "${dominantPattern}" — sua thumb usa "${yours.dominant_pattern}"`)

  total++
  if (yours.face_analysis.present === facePct >= 50) matches++
  else if (facePct >= 50 && !yours.face_analysis.present)
    improvements.push(`${Math.round(facePct)}% do nicho usa face na thumb — considere adicionar`)
  else if (facePct < 50 && yours.face_analysis.present)
    improvements.push(`Nicho NÃO costuma usar face (${Math.round(facePct)}%) — pode estar fora do padrão`)

  total++
  const wordDiff = Math.abs(yours.text_overlay.word_count - avgWords)
  if (wordDiff <= 2) matches++
  else improvements.push(`Texto: nicho usa em média ${Math.round(avgWords)} palavras, sua thumb tem ${yours.text_overlay.word_count}`)

  total++
  if (yours.mobile_readability_score >= 70) matches++
  else improvements.push(`Legibilidade mobile baixa (${yours.mobile_readability_score}/100) — aumentar contraste`)

  return {
    alignmentPct: Math.round((matches / total) * 100),
    improvements: improvements.slice(0, 3),
  }
}
