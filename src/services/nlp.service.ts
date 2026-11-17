/**
 * NLP Service — orquestra análise de comentários e transcrições via Claude.
 *
 * Responsabilidades:
 * - Fetch de comentários via YouTube API
 * - PII filter + sanitização XML
 * - Chamada Claude (Haiku para comments, Sonnet para transcripts)
 * - Validação Zod do output (defesa contra leakage)
 * - Cache (24h comments, 7d transcripts)
 */

import { z } from 'zod'
import type { youtube_v3 } from 'googleapis'
import { withCache } from './cache.service.js'
import { callText } from './anthropic.service.js'
import { assertBudgetAvailable } from '../security/budget-guard.service.js'
import { wrapComments } from '../security/prompt-sanitizer.service.js'
import { redactPII } from '../security/pii-filter.service.js'
import {
  NLPCommentsOutputSchema,
  hasLeakageMarkers,
} from '../schemas/output.schemas.js'
import { recordQuota } from './quota.service.js'
import { ANTHROPIC_COSTS } from '../config/vision-pricing.js'
import {
  NLP_COMMENTS_SYSTEM_PROMPT,
  nlpCommentsUserText,
} from '../prompts/nlp-comments.prompt.js'

export type NLPCommentsOutput = z.infer<typeof NLPCommentsOutputSchema>

export interface CommentsInput {
  videoId: string
  maxComments: number
  fresh?: boolean
}

export interface CommentsAnalysisResult {
  videoId: string
  commentsAnalyzed: number
  commentsDisabled: boolean
  estimatedCostUsd: number
  analysis: NLPCommentsOutput | null
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

export interface FetchedComment {
  id: string
  textOriginal: string
  likes: number
  replies: number
  author: string
}

export async function fetchComments(
  client: youtube_v3.Youtube,
  videoId: string,
  maxComments: number,
  tokenHash: string,
): Promise<FetchedComment[] | 'disabled'> {
  const collected: FetchedComment[] = []
  let pageToken: string | undefined

  while (collected.length < maxComments) {
    try {
      const fetchOptions: youtube_v3.Params$Resource$Commentthreads$List = {
        part: ['snippet'],
        videoId,
        maxResults: Math.min(100, maxComments - collected.length),
        textFormat: 'plainText',
        order: 'relevance',
      }
      if (pageToken !== undefined) fetchOptions.pageToken = pageToken
      const res = await client.commentThreads.list(fetchOptions)
      recordQuota('youtube:commentThreads.list', tokenHash, 'analyze_video_comments')

      const items = res.data.items ?? []
      for (const item of items) {
        const snip = item.snippet?.topLevelComment?.snippet
        if (!snip) continue
        collected.push({
          id: item.id ?? '',
          textOriginal: snip.textDisplay ?? '',
          likes: snip.likeCount ?? 0,
          replies: item.snippet?.totalReplyCount ?? 0,
          author: snip.authorDisplayName ?? 'anônimo',
        })
      }

      if (!res.data.nextPageToken) break
      pageToken = res.data.nextPageToken
    } catch (err) {
      // commentsDisabled é 403 com mensagem específica
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('commentsDisabled') || msg.includes('disabled comments')) {
        return 'disabled'
      }
      throw err
    }
  }

  return collected.slice(0, maxComments)
}

// ─── Analyze ──────────────────────────────────────────────────────────────────

export async function analyzeComments(
  client: youtube_v3.Youtube,
  input: CommentsInput,
  tokenHash: string,
  toolName: string,
): Promise<CommentsAnalysisResult> {
  return withCache(
    toolName,
    { videoId: input.videoId, maxComments: input.maxComments },
    tokenHash,
    async () => doAnalyzeComments(client, input, tokenHash, toolName),
    { fresh: input.fresh ?? false },
  )
}

async function doAnalyzeComments(
  client: youtube_v3.Youtube,
  input: CommentsInput,
  tokenHash: string,
  toolName: string,
): Promise<CommentsAnalysisResult> {
  // Fetch
  const comments = await fetchComments(client, input.videoId, input.maxComments, tokenHash)

  if (comments === 'disabled') {
    return {
      videoId: input.videoId,
      commentsAnalyzed: 0,
      commentsDisabled: true,
      estimatedCostUsd: 0,
      analysis: null,
    }
  }

  if (comments.length === 0) {
    return {
      videoId: input.videoId,
      commentsAnalyzed: 0,
      commentsDisabled: false,
      estimatedCostUsd: 0,
      analysis: null,
    }
  }

  // Budget guard
  assertBudgetAvailable('nlp', ANTHROPIC_COSTS.haiku_per_call_usd, tokenHash)

  // PII filter + sanitização
  const filtered = comments.map((c) => ({
    id: c.id,
    text: redactPII(c.textOriginal),
    likes: c.likes,
    replies: c.replies,
    author: redactPII(c.author),
  }))

  const wrappedXml = wrapComments(filtered.map((f) => ({ id: f.id, text: f.text })))

  // Call Claude Haiku
  const llmResponse = await callText(
    'claude-haiku-4-5',
    NLP_COMMENTS_SYSTEM_PROMPT,
    nlpCommentsUserText(wrappedXml),
    tokenHash,
    toolName,
    3000,
  )

  // Validate
  const analysis = parseAndValidate(llmResponse.text)

  return {
    videoId: input.videoId,
    commentsAnalyzed: comments.length,
    commentsDisabled: false,
    estimatedCostUsd: llmResponse.estimatedCostUsd,
    analysis,
  }
}

// ─── Transcript Analysis (task-010) ──────────────────────────────────────────

import {
  NLPTranscriptOutputSchema,
} from '../schemas/output.schemas.js'
import { listCaptions, downloadCaption } from './youtube.service.js'
import { parseSRT, cuesToAnnotatedText } from '../utils/srt-parser.js'
import { sanitizeBody } from '../security/prompt-sanitizer.service.js'
import {
  NLP_TRANSCRIPT_SYSTEM_PROMPT,
  nlpTranscriptUserText,
} from '../prompts/nlp-transcript.prompt.js'

export type NLPTranscriptOutput = z.infer<typeof NLPTranscriptOutputSchema>

export interface TranscriptInput {
  videoId: string
  preferredLanguages: readonly string[]
  fresh?: boolean
}

export interface TranscriptAnalysisResult {
  videoId: string
  language: string | null
  captionsAvailable: boolean
  estimatedCostUsd: number
  analysis: NLPTranscriptOutput | null
}

const MAX_TRANSCRIPT_CHARS = 30_000

export async function analyzeTranscript(
  client: youtube_v3.Youtube,
  input: TranscriptInput,
  tokenHash: string,
  toolName: string,
): Promise<TranscriptAnalysisResult> {
  return withCache(
    toolName,
    { videoId: input.videoId, langs: [...input.preferredLanguages].sort() },
    tokenHash,
    async () => doAnalyzeTranscript(client, input, tokenHash, toolName),
    { fresh: input.fresh ?? false },
  )
}

async function doAnalyzeTranscript(
  client: youtube_v3.Youtube,
  input: TranscriptInput,
  tokenHash: string,
  toolName: string,
): Promise<TranscriptAnalysisResult> {
  const captions = await listCaptions(client, input.videoId, tokenHash, toolName)
  if (captions.length === 0) {
    return { videoId: input.videoId, language: null, captionsAvailable: false, estimatedCostUsd: 0, analysis: null }
  }

  let selected: youtube_v3.Schema$Caption | null = null
  for (const lang of input.preferredLanguages) {
    selected = captions.find((c) => c.snippet?.language?.toLowerCase() === lang.toLowerCase()) ?? null
    if (selected) break
  }
  if (!selected) selected = captions[0] ?? null
  if (!selected?.id) {
    return { videoId: input.videoId, language: null, captionsAvailable: false, estimatedCostUsd: 0, analysis: null }
  }

  const srtRaw = await downloadCaption(client, selected.id, tokenHash, toolName)
  const cues = parseSRT(srtRaw)
  if (cues.length === 0) {
    return { videoId: input.videoId, language: selected.snippet?.language ?? 'unknown', captionsAvailable: true, estimatedCostUsd: 0, analysis: null }
  }

  const annotated = cuesToAnnotatedText(cues)
  const truncated = annotated.length > MAX_TRANSCRIPT_CHARS
    ? annotated.slice(0, MAX_TRANSCRIPT_CHARS) + '\n[... TRUNCADO ...]'
    : annotated
  const safe = sanitizeBody(truncated, MAX_TRANSCRIPT_CHARS + 100)

  const lastCue = cues[cues.length - 1]
  const durationMinutes = Math.ceil((lastCue?.endMs ?? 0) / 60_000)

  assertBudgetAvailable('nlp', ANTHROPIC_COSTS.sonnet_per_call_usd, tokenHash)

  const llmResponse = await callText(
    'claude-sonnet-4-6',
    NLP_TRANSCRIPT_SYSTEM_PROMPT,
    nlpTranscriptUserText(safe, durationMinutes),
    tokenHash,
    toolName,
    4000,
  )

  const analysis = parseAndValidateTranscript(llmResponse.text)

  return {
    videoId: input.videoId,
    language: selected.snippet?.language ?? 'unknown',
    captionsAvailable: true,
    estimatedCostUsd: llmResponse.estimatedCostUsd,
    analysis,
  }
}

function parseAndValidateTranscript(text: string): NLPTranscriptOutput {
  if (hasLeakageMarkers(text)) throw new Error('NLP transcript output contém markers de leakage')
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('NLP transcript output sem JSON detectável')
  let raw: unknown
  try {
    raw = JSON.parse(jsonMatch[0])
  } catch {
    throw new Error('NLP transcript output JSON inválido')
  }
  const result = NLPTranscriptOutputSchema.safeParse(raw)
  if (!result.success) throw new Error(`NLP transcript output não passa no schema: ${result.error.message}`)
  return result.data
}

// ─── Reverse Engineering Viral Video (task-011) ─────────────────────────────

import {
  REVERSE_ENGINEER_SYSTEM_PROMPT,
  reverseEngineerUserText,
} from '../prompts/nlp-reverse-engineer.prompt.js'
import type { VisionAnalysisResult } from './vision.service.js'
import { analyzeThumbnails } from './vision.service.js'

export interface ReverseEngineerInput {
  videoId: string
  myNiche: string
  regionCode?: string
  includeThumbnail?: boolean
  fresh?: boolean
}

export interface ReverseEngineerResult {
  videoId: string
  myNiche: string
  estimatedCostUsd: number
  markdown: string
  commentsAnalyzed: number
  transcriptAvailable: boolean
  thumbnailIncluded: boolean
}

export async function reverseEngineerViralVideo(
  client: youtube_v3.Youtube,
  input: ReverseEngineerInput,
  tokenHash: string,
  toolName: string,
): Promise<ReverseEngineerResult> {
  return withCache(
    toolName,
    {
      videoId: input.videoId,
      myNiche: input.myNiche,
      includeThumbnail: input.includeThumbnail ?? true,
    },
    tokenHash,
    async () => doReverseEngineer(client, input, tokenHash, toolName),
    { fresh: input.fresh ?? false },
  )
}

async function doReverseEngineer(
  client: youtube_v3.Youtube,
  input: ReverseEngineerInput,
  tokenHash: string,
  toolName: string,
): Promise<ReverseEngineerResult> {
  const includeThumb = input.includeThumbnail ?? true

  // Lança 3 análises em paralelo (cada uma já tem seu próprio cache)
  const [commentsR, transcriptR, thumbR] = await Promise.all([
    analyzeComments(
      client,
      { videoId: input.videoId, maxComments: 100 },
      tokenHash,
      'analyze_video_comments',
    ),
    analyzeTranscript(
      client,
      { videoId: input.videoId, preferredLanguages: ['pt', 'pt-BR', 'en', 'es'] },
      tokenHash,
      'analyze_video_transcript',
    ),
    includeThumb
      ? analyzeThumbnails(
          { videoIds: [input.videoId], niche: input.myNiche },
          tokenHash,
          'analyze_thumbnail_visuals',
        )
      : Promise.resolve(null as VisionAnalysisResult | null),
  ])

  const totalCost = commentsR.estimatedCostUsd + transcriptR.estimatedCostUsd + (thumbR?.estimatedCostUsd ?? 0)
  assertBudgetAvailable('nlp', ANTHROPIC_COSTS.sonnet_per_call_usd, tokenHash)

  const commentsJson = commentsR.analysis ? JSON.stringify(commentsR.analysis, null, 2) : '(sem comentários disponíveis)'
  const transcriptJson = transcriptR.analysis
    ? JSON.stringify(transcriptR.analysis, null, 2)
    : '(transcrição indisponível)'
  const thumbJson = thumbR && thumbR.items.length > 0 ? JSON.stringify(thumbR.items[0], null, 2) : '(thumbnail não analisada)'

  const llmResponse = await callText(
    'claude-sonnet-4-6',
    REVERSE_ENGINEER_SYSTEM_PROMPT,
    reverseEngineerUserText(commentsJson, transcriptJson, thumbJson, input.myNiche),
    tokenHash,
    toolName,
    4000,
  )

  return {
    videoId: input.videoId,
    myNiche: input.myNiche,
    estimatedCostUsd: totalCost + llmResponse.estimatedCostUsd,
    markdown: llmResponse.text,
    commentsAnalyzed: commentsR.commentsAnalyzed,
    transcriptAvailable: transcriptR.captionsAvailable && transcriptR.analysis !== null,
    thumbnailIncluded: includeThumb && thumbR !== null && thumbR.items.length > 0,
  }
}

function parseAndValidate(text: string): NLPCommentsOutput {
  if (hasLeakageMarkers(text)) {
    throw new Error('NLP output contém markers de leakage — possível prompt injection bem-sucedida')
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('NLP output sem JSON detectável')

  let raw: unknown
  try {
    raw = JSON.parse(jsonMatch[0])
  } catch {
    throw new Error('NLP output JSON inválido')
  }

  const result = NLPCommentsOutputSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`NLP output não passa no schema: ${result.error.message}`)
  }
  return result.data
}
