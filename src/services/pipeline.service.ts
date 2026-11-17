/**
 * Pipeline Service — Camada 4 do Tubemind v0.2.
 *
 * Gera roteiros, descrições, previsões e workflows orquestrados.
 * Reutiliza serviços das Camadas 1-3 para dados reais do nicho.
 */

import type { z } from 'zod'
import { callText } from './anthropic.service.js'
import { withCache } from './cache.service.js'
import { assertBudgetAvailable } from '../security/budget-guard.service.js'
import { ANTHROPIC_COSTS } from '../config/vision-pricing.js'
import {
  ScriptOutputSchema,
  DescriptionOutputSchema,
  hasLeakageMarkers,
} from '../schemas/output.schemas.js'
import {
  PIPELINE_SCRIPT_SYSTEM_PROMPT,
  pipelineScriptUserText,
} from '../prompts/pipeline-script.prompt.js'
import {
  PIPELINE_DESCRIPTION_SYSTEM_PROMPT,
  pipelineDescriptionUserText,
} from '../prompts/pipeline-description.prompt.js'
import { detectRegulatedNiche, DISCLAIMERS } from './regulated-niche-detector.service.js'

export type ScriptOutput = z.infer<typeof ScriptOutputSchema>
export type DescriptionOutput = z.infer<typeof DescriptionOutputSchema>

// ─── Script Generator (task-012) ─────────────────────────────────────────────

export interface ScriptInput {
  topic: string
  niche: string
  durationMinutes: 5 | 10 | 15 | 20
  tone: 'educativo' | 'descontraido' | 'provocativo' | 'tecnico'
  audience?: string
  retentionContext: string // já preparado pelo caller (output cacheado das tools v0.1)
  titlePatternsContext: string
}

export interface ScriptResult {
  estimatedCostUsd: number
  script: ScriptOutput
  qualityWarnings: string[]
}

export async function generateScript(
  input: ScriptInput,
  tokenHash: string,
  toolName: string,
): Promise<ScriptResult> {
  assertBudgetAvailable('workflow', ANTHROPIC_COSTS.sonnet_per_call_usd, tokenHash)

  const audience = input.audience ?? 'criadores YouTube'
  const llmResponse = await callText(
    'claude-sonnet-4-6',
    PIPELINE_SCRIPT_SYSTEM_PROMPT,
    pipelineScriptUserText(
      input.topic,
      input.niche,
      input.durationMinutes,
      input.tone,
      audience,
      input.retentionContext,
      input.titlePatternsContext,
    ),
    tokenHash,
    toolName,
    4500,
  )

  const script = parseScript(llmResponse.text)
  const warnings = validateScriptQuality(script, input.niche)

  return {
    estimatedCostUsd: llmResponse.estimatedCostUsd,
    script,
    qualityWarnings: warnings,
  }
}

function parseScript(text: string): ScriptOutput {
  if (hasLeakageMarkers(text)) throw new Error('Script output contém markers de leakage')
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Script output sem JSON detectável')
  let raw: unknown
  try {
    raw = JSON.parse(jsonMatch[0])
  } catch {
    throw new Error('Script output JSON inválido')
  }
  const result = ScriptOutputSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`Script output não passa no schema: ${result.error.message}`)
  }
  return result.data
}

function validateScriptQuality(script: ScriptOutput, niche: string): string[] {
  const warnings: string[] = []
  const fullText = JSON.stringify(script).toLowerCase()
  const nicheKeywords = niche
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3)

  const matches = nicheKeywords.filter((kw) => fullText.includes(kw)).length
  if (matches < Math.min(2, nicheKeywords.length)) {
    warnings.push(
      `Roteiro genérico: referencia apenas ${matches} keyword(s) do nicho. Considere regenerar com fresh=true.`,
    )
  }

  const recommendedHooks = script.hooks.filter((h) => h.recommended).length
  if (recommendedHooks !== 1) {
    warnings.push(
      `Esperado exatamente 1 hook recomendado; encontrados ${recommendedHooks}. LLM pode ter divergido do schema.`,
    )
  }

  return warnings
}

// ─── Description Optimizer (task-013) ────────────────────────────────────────

export interface DescriptionInput {
  title: string
  tags: readonly string[]
  transcript?: string
  timestamps?: ReadonlyArray<{ time: string; label: string }>
  fresh?: boolean
}

export interface DescriptionResult {
  estimatedCostUsd: number
  description: DescriptionOutput
  regulatedNiche: ReturnType<typeof detectRegulatedNiche>
  disclaimer: string | null
  keywordDensityPct: Record<string, number>
}

export async function optimizeDescription(
  input: DescriptionInput,
  tokenHash: string,
  toolName: string,
): Promise<DescriptionResult> {
  return withCache(
    toolName,
    {
      title: input.title,
      tags: [...input.tags].sort(),
      hasTranscript: !!input.transcript,
    },
    tokenHash,
    async () => doOptimizeDescription(input, tokenHash, toolName),
    { fresh: input.fresh ?? false },
  )
}

async function doOptimizeDescription(
  input: DescriptionInput,
  tokenHash: string,
  toolName: string,
): Promise<DescriptionResult> {
  assertBudgetAvailable('workflow', ANTHROPIC_COSTS.haiku_per_call_usd, tokenHash)

  const llmResponse = await callText(
    'claude-haiku-4-5',
    PIPELINE_DESCRIPTION_SYSTEM_PROMPT,
    pipelineDescriptionUserText(input.title, input.tags, input.transcript),
    tokenHash,
    toolName,
    3000,
  )

  const parsed = parseDescription(llmResponse.text)

  // Detector de nicho regulado (RS-4.6)
  const combinedText = `${input.title} ${input.tags.join(' ')} ${parsed.description}`
  const regulatedNiche = detectRegulatedNiche(combinedText)
  const disclaimer = regulatedNiche !== null ? DISCLAIMERS[regulatedNiche] : null

  // Densidade keyword (validação anti-stuffing)
  const keywordDensityPct = computeKeywordDensity(parsed.description, input.title)

  return {
    estimatedCostUsd: llmResponse.estimatedCostUsd,
    description: parsed,
    regulatedNiche,
    disclaimer,
    keywordDensityPct,
  }
}

function parseDescription(text: string): DescriptionOutput {
  if (hasLeakageMarkers(text)) throw new Error('Description output contém markers de leakage')
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Description output sem JSON detectável')
  let raw: unknown
  try {
    raw = JSON.parse(jsonMatch[0])
  } catch {
    throw new Error('Description output JSON inválido')
  }
  const result = DescriptionOutputSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`Description output não passa no schema: ${result.error.message}`)
  }
  return result.data
}

// ─── Predictor (task-014) ────────────────────────────────────────────────────

export interface PredictionInput {
  title: string
  thumbnailScore?: number // 0-100, opcional (vem da Camada 2)
  niche: string
  channelId: string
  ctrPotentialScore: number // 0-100, vem de estimate_ctr_potential
  retentionScoreNiche: number // 0-100, vem de analyze_retention_signals
  timingScore?: number // 0-100, vem de score_best_publish_window (opcional)
  nicheDifficultyScore: number // 0-100 (invertido — high = easier)
  channelAvgViews90d?: number // baseline para previsão de views
}

export interface PredictionResult {
  viralScore: number
  breakdown: {
    ctr: number
    thumbnail: number
    retention: number
    timing: number
    nicheDifficulty: number
  }
  recommendation: '🟢 PRODUZIR' | '🟡 AJUSTAR' | '🔴 ABANDONAR'
  views7d: { min: number; max: number }
  views30d: { min: number; max: number }
  views90d: { min: number; max: number }
  topAdjustments: string[]
  disclaimer: string
}

/**
 * Fórmula viral score:
 *   ctr * 0.30 + thumb * 0.25 + retention * 0.25 + timing * 0.10 + niche_diff * 0.10
 *
 * Anti-tampering (RS-4.10): nenhum field do output é input — tudo derivado.
 * Disclaimer obrigatório (RS-4.4).
 */
export function predictPerformance(input: PredictionInput): PredictionResult {
  // Defaults seguros para fields opcionais
  const thumb = input.thumbnailScore ?? 50
  const timing = input.timingScore ?? 50

  const viralScore = Math.round(
    input.ctrPotentialScore * 0.30 +
      thumb * 0.25 +
      input.retentionScoreNiche * 0.25 +
      timing * 0.10 +
      input.nicheDifficultyScore * 0.10,
  )

  // Views previstas (fórmula heurística — DOCUMENTADA + DISCLAIMER OBRIGATÓRIO)
  const baseline = input.channelAvgViews90d ?? 1000
  const factor = Math.pow(viralScore / 50, 1.5)
  const baseProjection = baseline * factor

  const views7d = { min: Math.round(baseProjection * 0.3), max: Math.round(baseProjection * 0.7) }
  const views30d = { min: Math.round(baseProjection * 0.7), max: Math.round(baseProjection * 1.5) }
  const views90d = { min: Math.round(baseProjection * 1.0), max: Math.round(baseProjection * 2.5) }

  const recommendation: PredictionResult['recommendation'] =
    viralScore >= 70 ? '🟢 PRODUZIR' : viralScore >= 40 ? '🟡 AJUSTAR' : '🔴 ABANDONAR'

  const topAdjustments = computeTopAdjustments({
    ctr: input.ctrPotentialScore,
    thumbnail: thumb,
    retention: input.retentionScoreNiche,
    timing,
    nicheDifficulty: input.nicheDifficultyScore,
  })

  return {
    viralScore,
    breakdown: {
      ctr: input.ctrPotentialScore,
      thumbnail: thumb,
      retention: input.retentionScoreNiche,
      timing,
      nicheDifficulty: input.nicheDifficultyScore,
    },
    recommendation,
    views7d,
    views30d,
    views90d,
    topAdjustments,
    disclaimer:
      '⚠️ Estimativa baseada em heurísticas combinadas (CTR + thumbnail + retention + timing + dificuldade do nicho). Não é predição ML treinada com seu canal — use como ORIENTAÇÃO, não como verdade absoluta. Margens de previsão são amplas (fator 3x entre min e max em 90d).',
  }
}

function computeTopAdjustments(b: PredictionResult['breakdown']): string[] {
  const dimensions: Array<{ name: string; score: number; advice: string }> = [
    { name: 'ctr', score: b.ctr, advice: 'Revise o TÍTULO — use número, palavra-gatilho ou pergunta' },
    { name: 'thumbnail', score: b.thumbnail, advice: 'Melhore a THUMBNAIL — rode score_my_thumbnail e siga as 3 sugestões' },
    { name: 'retention', score: b.retention, advice: 'Estude estrutura de RETENÇÃO do nicho (analyze_retention_signals)' },
    { name: 'timing', score: b.timing, advice: 'Reagende: rode score_best_publish_window para o melhor dia/hora' },
    { name: 'nicheDifficulty', score: b.nicheDifficulty, advice: 'Nicho saturado — busque sub-nicho via detect_content_gaps' },
  ]
  return dimensions
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map((d) => `**${d.name}** (${d.score}/100): ${d.advice}`)
}

// ─── Workflows (task-015) ────────────────────────────────────────────────────

export type WorkflowName =
  | 'launch_new_channel'
  | 'revive_dead_channel'
  | 'weekly_planning'
  | 'competitor_takedown'

export interface WorkflowDef {
  readonly name: WorkflowName
  readonly description: string
  readonly estimatedCostUsd: number
  readonly estimatedMinutes: number
  readonly steps: ReadonlyArray<{ id: string; label: string; tool: string }>
}

export const WORKFLOW_REGISTRY: Readonly<Record<WorkflowName, WorkflowDef>> = Object.freeze({
  launch_new_channel: {
    name: 'launch_new_channel',
    description: 'Análise de mercado + content calendar 30d + 5 roteiros + análise visual do nicho',
    estimatedCostUsd: 0.50,
    estimatedMinutes: 10,
    steps: [
      { id: 'trending', label: 'Buscar trending topics', tool: 'search_trending_topics' },
      { id: 'gaps', label: 'Detectar content gaps', tool: 'detect_content_gaps' },
      { id: 'patterns', label: 'Analisar title patterns', tool: 'analyze_title_patterns' },
      { id: 'thumbs', label: 'Análise visual do nicho', tool: 'analyze_thumbnail_visuals' },
      { id: 'calendar', label: 'Gerar calendário 30d', tool: 'generate_content_calendar' },
    ],
  },
  revive_dead_channel: {
    name: 'revive_dead_channel',
    description: 'Diagnóstico + plano de recuperação 30d',
    estimatedCostUsd: 0.20,
    estimatedMinutes: 5,
    steps: [
      { id: 'analytics', label: 'Análise do canal', tool: 'get_channel_analytics' },
      { id: 'patterns', label: 'Patterns que funcionam', tool: 'analyze_title_patterns' },
      { id: 'gaps', label: 'Oportunidades não exploradas', tool: 'detect_content_gaps' },
      { id: 'calendar', label: 'Plano 30d', tool: 'generate_content_calendar' },
    ],
  },
  weekly_planning: {
    name: 'weekly_planning',
    description: 'Trending + gaps + calendário 7d',
    estimatedCostUsd: 0.05,
    estimatedMinutes: 3,
    steps: [
      { id: 'trending', label: 'Trending keywords', tool: 'find_trending_keywords' },
      { id: 'gaps', label: 'Content gaps', tool: 'detect_content_gaps' },
      { id: 'calendar', label: 'Calendário 7d', tool: 'generate_content_calendar' },
    ],
  },
  competitor_takedown: {
    name: 'competitor_takedown',
    description: 'Análise profunda do concorrente + estratégia de diferenciação',
    estimatedCostUsd: 0.30,
    estimatedMinutes: 6,
    steps: [
      { id: 'comp_videos', label: 'Top vídeos do concorrente', tool: 'get_competitor_videos' },
      { id: 'benchmark', label: 'Benchmark vs concorrente', tool: 'benchmark_channel' },
      { id: 'patterns', label: 'Patterns do concorrente', tool: 'analyze_title_patterns' },
      { id: 'gaps', label: 'Onde concorrente NÃO está', tool: 'detect_content_gaps' },
    ],
  },
})

export interface WorkflowStepResult {
  id: string
  label: string
  tool: string
  durationMs: number
  success: boolean
  output: string
  error?: string
}

export interface WorkflowResult {
  workflow: WorkflowName
  totalDurationMs: number
  stepsCompleted: number
  stepsTotal: number
  steps: WorkflowStepResult[]
}

function computeKeywordDensity(description: string, title: string): Record<string, number> {
  const words = description.toLowerCase().split(/\s+/).filter((w) => w.length >= 3)
  const total = words.length
  if (total === 0) return {}

  const titleKeywords = title
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4)

  const density: Record<string, number> = {}
  for (const kw of titleKeywords) {
    const count = words.filter((w) => w === kw).length
    density[kw] = total > 0 ? (count / total) * 100 : 0
  }
  return density
}
