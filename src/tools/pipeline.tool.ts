/**
 * Tools MCP da Camada 4 — Pipeline.
 *
 * - generate_full_script (task-012)
 * - optimize_video_description (task-013)
 * - predict_video_performance (task-014)
 * - run_workflow (task-015)
 */

import { z } from 'zod'
import { withAudit } from '../security/audit.service.js'
import { isAnthropicAvailable } from '../services/anthropic.service.js'
import { getYouTubeClient } from '../services/youtube.service.js'
import {
  generateScript,
  optimizeDescription,
  predictPerformance,
  WORKFLOW_REGISTRY,
  type WorkflowName,
  type WorkflowStepResult,
  type WorkflowResult,
} from '../services/pipeline.service.js'
import {
  analyzeTitlePatterns,
  detectContentGaps,
} from '../tools/heuristic.tool.js'
import {
  analyzeRetentionSignals,
  estimateCtrPotential,
  findTrendingKeywords,
  generateContentCalendar,
} from '../tools/heuristic-advanced.tool.js'
import {
  searchTrendingTopics,
} from '../tools/search.tool.js'
import { getChannelAnalytics } from '../tools/analytics.tool.js'
import { benchmarkChannel } from '../tools/benchmark.tool.js'
import { getCompetitorVideos } from '../tools/competitor.tool.js'
import { analyzeThumbnailVisuals } from '../tools/vision.tool.js'
import { sha256 } from '../utils/hash.js'
import { assertBudgetAvailable } from '../security/budget-guard.service.js'
import { auditLog } from '../security/audit.service.js'

// ─── Schemas ─────────────────────────────────────────────────────────────────

export const GenerateFullScriptSchema = z.object({
  topic: z.string().min(3).max(200),
  niche: z.string().min(2).max(120),
  durationMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]),
  tone: z.enum(['educativo', 'descontraido', 'provocativo', 'tecnico']),
  audience: z.string().min(2).max(200).optional(),
})

export const OptimizeVideoDescriptionSchema = z.object({
  title: z.string().min(5).max(100),
  tags: z.array(z.string()).min(1).max(30),
  transcript: z.string().max(50000).optional(),
  fresh: z.boolean().default(false),
})

/**
 * Anti-tampering (RS-4.10): .strict() rejeita fields extras, especialmente
 * tentativas de injetar `viralScore`, `recommendation` no input.
 */
export const RunWorkflowSchema = z.object({
  workflow: z.enum(['launch_new_channel', 'revive_dead_channel', 'weekly_planning', 'competitor_takedown']),
  niche: z.string().min(2).max(120),
  regionCode: z.string().regex(/^[A-Z]{2}$/).default('BR'),
  channelId: z.string().regex(/^UC[a-zA-Z0-9_-]{22}$/).optional(),
  competitorChannelId: z.string().regex(/^UC[a-zA-Z0-9_-]{22}$/).optional(),
})

export const PredictVideoPerformanceSchema = z
  .object({
    title: z.string().min(5).max(100),
    niche: z.string().min(2).max(120),
    channelId: z.string().regex(/^UC[a-zA-Z0-9_-]{22}$/, 'channelId deve começar com UC + 22 chars'),
    thumbnailScore: z.number().min(0).max(100).optional(),
    timingScore: z.number().min(0).max(100).optional(),
    channelAvgViews90d: z.number().min(0).optional(),
  })
  .strict()

// ─── Definitions ─────────────────────────────────────────────────────────────

export const generateFullScriptDefinition = {
  name: 'generate_full_script',
  description:
    'Gera roteiro completo para vídeo YouTube usando dados REAIS do nicho (retention + title patterns). Output: 3 hooks (1 recomendado), intro/promessa, 3-5 seções com timestamps + b-rolls, 2 CTAs, fechamento. Custo ~$0.025 (Sonnet). Requer ANTHROPIC_API_KEY.',
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string' },
      niche: { type: 'string' },
      durationMinutes: { type: 'number', enum: [5, 10, 15, 20] },
      tone: { type: 'string', enum: ['educativo', 'descontraido', 'provocativo', 'tecnico'] },
      audience: { type: 'string' },
    },
    required: ['topic', 'niche', 'durationMinutes', 'tone'],
  },
} as const

export const runWorkflowDefinition = {
  name: 'run_workflow',
  description:
    'Executa um workflow pré-construído orquestrando 3-5 tools em sequência: launch_new_channel ($0.50), revive_dead_channel ($0.20), weekly_planning ($0.05), competitor_takedown ($0.30). Pre-flight de custo + tempo. Cada step persistido em audit log. Falha graceful em steps individuais (continua os outros).',
  inputSchema: {
    type: 'object',
    properties: {
      workflow: {
        type: 'string',
        enum: ['launch_new_channel', 'revive_dead_channel', 'weekly_planning', 'competitor_takedown'],
      },
      niche: { type: 'string' },
      regionCode: { type: 'string', default: 'BR' },
      channelId: { type: 'string', description: 'UC... (requerido por revive_dead_channel)' },
      competitorChannelId: {
        type: 'string',
        description: 'UC... (requerido por competitor_takedown)',
      },
    },
    required: ['workflow', 'niche'],
  },
} as const

export const predictVideoPerformanceDefinition = {
  name: 'predict_video_performance',
  description:
    'Prediz performance HEURÍSTICA de um vídeo combinando CTR potential do título + thumbnail score (opcional) + retention pattern do nicho + janela de publicação + dificuldade do nicho. Retorna viral_score 0-100, recomendação 🟢/🟡/🔴 e previsão de views 7d/30d/90d. NÃO é ML — use como orientação.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      niche: { type: 'string' },
      channelId: { type: 'string', description: 'YouTube channel ID (UC...)' },
      thumbnailScore: {
        type: 'number',
        description: '0-100 do score_my_thumbnail (opcional)',
      },
      timingScore: { type: 'number', description: '0-100 do score_best_publish_window (opcional)' },
      channelAvgViews90d: {
        type: 'number',
        description: 'Baseline de views médias do canal (opcional)',
      },
    },
    required: ['title', 'niche', 'channelId'],
  },
} as const

export const optimizeVideoDescriptionDefinition = {
  name: 'optimize_video_description',
  description:
    'Gera descrição YouTube SEO-otimizada: 150-200 palavras, primeira frase com keyword, densidade ≤ 3%, capítulos (se transcript), 3-5 hashtags. Detecta nicho regulado (financeiro/médico/jurídico) e adiciona disclaimer apropriado. Custo ~$0.005 (Haiku). Requer ANTHROPIC_API_KEY.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      transcript: { type: 'string', description: 'Opcional — habilita capítulos automáticos' },
      fresh: { type: 'boolean', default: false },
    },
    required: ['title', 'tags'],
  },
} as const

// ─── Handlers ────────────────────────────────────────────────────────────────

export async function generateFullScript(
  rawInput: unknown,
  accessToken: string,
): Promise<string> {
  return withAudit('GENERATE_FULL_SCRIPT', 'generate_full_script', async () => {
    if (!isAnthropicAvailable()) {
      return '⚠️ Camada 4 requer `ANTHROPIC_API_KEY` configurada no .env.'
    }

    const input = GenerateFullScriptSchema.parse(rawInput)
    const tokenHash = sha256(accessToken)

    // Buscar contexto cached do nicho (heuristic tools v0.1)
    const [retentionMd, titlePatternsMd] = await Promise.all([
      analyzeRetentionSignals(
        { niche: input.niche, regionCode: 'BR', videoCount: 20, minViews: 10000 },
        accessToken,
      ).catch((e) => `(retention indisponível: ${e instanceof Error ? e.message : 'erro'})`),
      analyzeTitlePatterns(
        { niche: input.niche, regionCode: 'BR', videoCount: 30 },
        accessToken,
      ).catch((e) => `(patterns indisponível: ${e instanceof Error ? e.message : 'erro'})`),
    ])

    const result = await generateScript(
      {
        topic: input.topic,
        niche: input.niche,
        durationMinutes: input.durationMinutes,
        tone: input.tone,
        ...(input.audience !== undefined ? { audience: input.audience } : {}),
        retentionContext: retentionMd,
        titlePatternsContext: titlePatternsMd,
      },
      tokenHash,
      'generate_full_script',
    )

    return renderScriptMarkdown(result, input)
  })
}

export async function runWorkflow(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('RUN_WORKFLOW', 'run_workflow', async () => {
    const input = RunWorkflowSchema.parse(rawInput)
    const def = WORKFLOW_REGISTRY[input.workflow as WorkflowName]
    const tokenHash = sha256(accessToken)

    assertBudgetAvailable('workflow', def.estimatedCostUsd, tokenHash)

    const startedAt = Date.now()
    const stepResults: WorkflowStepResult[] = []
    let completedCount = 0

    for (const step of def.steps) {
      const stepStart = Date.now()
      try {
        const output = await executeWorkflowStep(step.tool, input, accessToken)
        const duration = Date.now() - stepStart
        stepResults.push({
          id: step.id,
          label: step.label,
          tool: step.tool,
          durationMs: duration,
          success: true,
          output: output.slice(0, 4000), // limita output capturado por step
        })
        completedCount++
        void auditLog({
          action: 'WORKFLOW_STEP',
          toolName: input.workflow,
          success: true,
          durationMs: duration,
        })
      } catch (err) {
        const duration = Date.now() - stepStart
        const errMsg = err instanceof Error ? err.message : 'erro desconhecido'
        stepResults.push({
          id: step.id,
          label: step.label,
          tool: step.tool,
          durationMs: duration,
          success: false,
          output: '',
          error: errMsg,
        })
        void auditLog({
          action: 'WORKFLOW_STEP',
          toolName: input.workflow,
          success: false,
          durationMs: duration,
          errorCode: errMsg,
        })
        // Continua próximos steps (falha graceful)
      }
    }

    const result: WorkflowResult = {
      workflow: input.workflow as WorkflowName,
      totalDurationMs: Date.now() - startedAt,
      stepsCompleted: completedCount,
      stepsTotal: def.steps.length,
      steps: stepResults,
    }

    return renderWorkflowMarkdown(result, def, input)
  })
}

async function executeWorkflowStep(
  toolName: string,
  input: z.infer<typeof RunWorkflowSchema>,
  accessToken: string,
): Promise<string> {
  switch (toolName) {
    case 'search_trending_topics':
      return searchTrendingTopics({ query: input.niche, regionCode: input.regionCode }, accessToken)
    case 'detect_content_gaps':
      return detectContentGaps({ niche: input.niche, regionCode: input.regionCode }, accessToken)
    case 'analyze_title_patterns':
      return analyzeTitlePatterns({ niche: input.niche, regionCode: input.regionCode }, accessToken)
    case 'analyze_thumbnail_visuals':
      return analyzeThumbnailVisuals({ niche: input.niche, regionCode: input.regionCode }, accessToken)
    case 'generate_content_calendar':
      return generateContentCalendar({ niche: input.niche, regionCode: input.regionCode }, accessToken)
    case 'find_trending_keywords':
      return findTrendingKeywords({ niche: input.niche, regionCode: input.regionCode }, accessToken)
    case 'get_channel_analytics': {
      if (!input.channelId) throw new Error('channelId requerido para get_channel_analytics')
      const endDate = new Date().toISOString().split('T')[0]
      const startDate = new Date(Date.now() - 90 * 86_400_000).toISOString().split('T')[0]
      return getChannelAnalytics({ channelId: input.channelId, startDate, endDate }, accessToken)
    }
    case 'benchmark_channel':
      if (!input.channelId) throw new Error('channelId requerido para benchmark_channel')
      return benchmarkChannel({ yourChannelId: input.channelId, niche: input.niche }, accessToken)
    case 'get_competitor_videos':
      if (!input.competitorChannelId)
        throw new Error('competitorChannelId requerido para competitor_takedown')
      return getCompetitorVideos({ channelId: input.competitorChannelId }, accessToken)
    default:
      throw new Error(`Tool desconhecida no workflow: ${toolName}`)
  }
}

function renderWorkflowMarkdown(
  r: WorkflowResult,
  def: import('../services/pipeline.service.js').WorkflowDef,
  input: z.infer<typeof RunWorkflowSchema>,
): string {
  const lines: string[] = []
  lines.push(`# Workflow: ${r.workflow}`)
  lines.push(`> ${def.description}`)
  lines.push(
    `> Steps: ${r.stepsCompleted}/${r.stepsTotal} concluídos | Duração: ${(r.totalDurationMs / 1000).toFixed(1)}s | Nicho: ${input.niche}`,
  )
  lines.push('')

  for (const [i, s] of r.steps.entries()) {
    const icon = s.success ? '✅' : '❌'
    lines.push(`## ${i + 1}. ${icon} ${s.label} (\`${s.tool}\`)`)
    lines.push(`> Duração: ${(s.durationMs / 1000).toFixed(1)}s`)
    lines.push('')
    if (s.success) {
      lines.push('<details><summary>Ver output completo</summary>')
      lines.push('')
      lines.push(s.output)
      lines.push('')
      lines.push('</details>')
    } else {
      lines.push(`> ⚠️ Falha: ${s.error}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

export async function predictVideoPerformanceHandler(
  rawInput: unknown,
  accessToken: string,
): Promise<string> {
  return withAudit('PREDICT_VIDEO_PERFORMANCE', 'predict_video_performance', async () => {
    const input = PredictVideoPerformanceSchema.parse(rawInput)

    // 1. CTR potential (v0.1)
    const ctrResult = await estimateCtrPotential(
      { titles: [input.title], niche: input.niche, regionCode: 'BR' },
      accessToken,
    )
    const ctrScore = extractScoreFromCtrMarkdown(ctrResult) ?? 50

    // 2. Retention do nicho (v0.1)
    const retentionResult = await analyzeRetentionSignals(
      { niche: input.niche, regionCode: 'BR', videoCount: 20, minViews: 10000 },
      accessToken,
    )
    const retentionScore = extractRetentionScore(retentionResult) ?? 50

    // 3. Niche difficulty (invertido)
    // Simplificação: inverter título patterns disponibilidade
    const nicheDifficultyScore = 50 // placeholder neutro — refinar em iteração futura

    // 4. Prediz
    const prediction = predictPerformance({
      title: input.title,
      niche: input.niche,
      channelId: input.channelId,
      ctrPotentialScore: ctrScore,
      retentionScoreNiche: retentionScore,
      nicheDifficultyScore,
      ...(input.thumbnailScore !== undefined ? { thumbnailScore: input.thumbnailScore } : {}),
      ...(input.timingScore !== undefined ? { timingScore: input.timingScore } : {}),
      ...(input.channelAvgViews90d !== undefined
        ? { channelAvgViews90d: input.channelAvgViews90d }
        : {}),
    })

    return renderPredictionMarkdown(prediction, input.title)
  })
}

/**
 * Extrai score 0-100 do markdown do estimate_ctr_potential. Heurística simples.
 */
function extractScoreFromCtrMarkdown(md: string): number | null {
  const match = md.match(/(\d+)\/100/)
  return match ? parseInt(match[1]!, 10) : null
}

function extractRetentionScore(md: string): number | null {
  // analyze_retention_signals retorna engagement rate como "X.XX%"; usamos como proxy
  const match = md.match(/Engagement rate.*?([\d.]+)%/i)
  if (!match) return null
  const pct = parseFloat(match[1]!)
  // Mapeia 0-10% para 0-100
  return Math.min(100, Math.round(pct * 10))
}

function renderPredictionMarkdown(
  p: import('../services/pipeline.service.js').PredictionResult,
  title: string,
): string {
  const lines: string[] = []
  lines.push(`# Predição de Performance — "${title}"`)
  lines.push('')
  lines.push(`## ${p.recommendation} — Score Viral: ${p.viralScore}/100`)
  lines.push('')
  lines.push('### Breakdown')
  lines.push(`| Dimensão | Score | Peso |`)
  lines.push(`|----------|-------|------|`)
  lines.push(`| CTR (título) | ${p.breakdown.ctr}/100 | 30% |`)
  lines.push(`| Thumbnail | ${p.breakdown.thumbnail}/100 | 25% |`)
  lines.push(`| Retention (nicho) | ${p.breakdown.retention}/100 | 25% |`)
  lines.push(`| Timing | ${p.breakdown.timing}/100 | 10% |`)
  lines.push(`| Dificuldade nicho | ${p.breakdown.nicheDifficulty}/100 | 10% |`)
  lines.push('')

  lines.push('### Views previstas (faixa)')
  lines.push(`| Janela | Min | Max |`)
  lines.push(`|--------|-----|-----|`)
  lines.push(
    `| 7 dias | ${p.views7d.min.toLocaleString('pt-BR')} | ${p.views7d.max.toLocaleString('pt-BR')} |`,
  )
  lines.push(
    `| 30 dias | ${p.views30d.min.toLocaleString('pt-BR')} | ${p.views30d.max.toLocaleString('pt-BR')} |`,
  )
  lines.push(
    `| 90 dias | ${p.views90d.min.toLocaleString('pt-BR')} | ${p.views90d.max.toLocaleString('pt-BR')} |`,
  )
  lines.push('')

  lines.push('### Top 5 ajustes priorizados')
  for (const [i, a] of p.topAdjustments.entries()) {
    lines.push(`${i + 1}. ${a}`)
  }
  lines.push('')
  lines.push(p.disclaimer)

  return lines.join('\n')
}

export async function optimizeVideoDescription(
  rawInput: unknown,
  accessToken: string,
): Promise<string> {
  return withAudit('OPTIMIZE_VIDEO_DESCRIPTION', 'optimize_video_description', async () => {
    if (!isAnthropicAvailable()) {
      return '⚠️ Camada 4 requer `ANTHROPIC_API_KEY` configurada no .env.'
    }

    const input = OptimizeVideoDescriptionSchema.parse(rawInput)
    const tokenHash = sha256(accessToken)

    const result = await optimizeDescription(
      {
        title: input.title,
        tags: input.tags,
        ...(input.transcript !== undefined ? { transcript: input.transcript } : {}),
        fresh: input.fresh,
      },
      tokenHash,
      'optimize_video_description',
    )

    return renderDescriptionMarkdown(result, input.title)
  })
}

// ─── Renderers ───────────────────────────────────────────────────────────────

function renderScriptMarkdown(
  r: import('../services/pipeline.service.js').ScriptResult,
  input: z.infer<typeof GenerateFullScriptSchema>,
): string {
  const lines: string[] = []
  lines.push(`# Roteiro — "${input.topic}" (${input.durationMinutes} min, ${input.tone})`)
  lines.push(`> Custo: $${r.estimatedCostUsd.toFixed(4)} | Nicho: ${input.niche}`)
  if (r.qualityWarnings.length > 0) {
    for (const w of r.qualityWarnings) lines.push(`> ⚠️ ${w}`)
  }
  lines.push('')

  lines.push('## 🎬 Hooks (0-15s) — 3 opções')
  for (const [i, h] of r.script.hooks.entries()) {
    const star = h.recommended ? ' ⭐ **RECOMENDADO**' : ''
    lines.push(`### Opção ${i + 1} — _${h.type}_${star}`)
    lines.push(`> ${h.text}`)
    lines.push('')
  }

  lines.push('## 🎯 Intro / Promessa (15-45s)')
  lines.push(`> ${r.script.intro}`)
  lines.push('')

  lines.push('## 📚 Corpo')
  for (const s of r.script.sections) {
    lines.push(`### ${s.timestamp} — ${s.title}`)
    for (const p of s.points) lines.push(`- ${p}`)
    if (s.b_roll_suggestion) lines.push(`> 🎥 B-roll: _${s.b_roll_suggestion}_`)
    lines.push('')
  }

  lines.push('## 🔔 CTAs')
  lines.push(`- **CTA-1 (~25%)** @ \`${r.script.cta_1.timestamp}\`: ${r.script.cta_1.text}`)
  lines.push(`- **CTA-2 (~75%)** @ \`${r.script.cta_2.timestamp}\`: ${r.script.cta_2.text}`)
  lines.push('')

  lines.push('## 🔁 Fechamento + Call-back')
  lines.push(`> ${r.script.closing}`)
  lines.push('')

  lines.push('## 🚪 Próximo vídeo')
  lines.push(`> ${r.script.next_video_suggestion}`)

  return lines.join('\n')
}

function renderDescriptionMarkdown(
  r: import('../services/pipeline.service.js').DescriptionResult,
  title: string,
): string {
  const lines: string[] = []
  lines.push(`## Descrição otimizada para "${title}"`)
  lines.push(`> Custo: $${r.estimatedCostUsd.toFixed(4)}`)
  lines.push('')

  if (r.disclaimer) {
    lines.push(`### 🚨 Nicho regulado detectado: ${r.regulatedNiche}`)
    lines.push(r.disclaimer)
    lines.push('')
  }

  lines.push('### Descrição')
  lines.push('```')
  if (r.disclaimer) lines.push(r.disclaimer + '\n')
  lines.push(r.description.description)
  if (r.description.chapters && r.description.chapters.length > 0) {
    lines.push('')
    lines.push('🎬 CAPÍTULOS:')
    for (const c of r.description.chapters) lines.push(`${c.time} - ${c.title}`)
  }
  lines.push('')
  lines.push(r.description.hashtags.join(' '))
  lines.push('```')
  lines.push('')

  lines.push('### Métricas')
  lines.push(`- Word count: ${r.description.description.split(/\s+/).length}`)
  lines.push(`- Primeira frase tem keyword principal: ${r.description.first_sentence_has_main_keyword ? '✅' : '❌'}`)
  lines.push(`- Hashtags: ${r.description.hashtags.length}`)
  if (Object.keys(r.keywordDensityPct).length > 0) {
    lines.push('- Densidade de keywords:')
    for (const [kw, pct] of Object.entries(r.keywordDensityPct)) {
      const badge = pct > 3 ? '⚠️ alta' : '✅'
      lines.push(`  - \`${kw}\`: ${pct.toFixed(2)}% ${badge}`)
    }
  }

  if (r.description.utm_template) {
    lines.push('')
    lines.push(`### UTM Template`)
    lines.push(`\`${r.description.utm_template}\``)
  }

  return lines.join('\n')
}

