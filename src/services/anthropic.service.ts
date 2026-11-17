/**
 * Wrapper para `@anthropic-ai/sdk`.
 *
 * Responsabilidades:
 * - Lazy init do cliente (não falha startup se ANTHROPIC_API_KEY ausente)
 * - Tracking de custo monetário em quota_log via recordQuota
 * - Audit log de cada chamada (tag VISION_API_CALL ou NLP_LLM_CALL)
 *
 * NÃO faz: prompt engineering, validação de output. Isso é com os callers
 * (vision.service, nlp.service, pipeline.service).
 */

import Anthropic from '@anthropic-ai/sdk'
import { auditLog } from '../security/audit.service.js'
import { recordQuota } from './quota.service.js'
import { ANTHROPIC_COSTS } from '../config/vision-pricing.js'

let client: Anthropic | null = null

export class AnthropicNotConfiguredError extends Error {
  constructor() {
    super(
      'ANTHROPIC_API_KEY não configurada. Camadas 2/3/4 do Tubemind requerem esta env. Veja .env.example.',
    )
    this.name = 'AnthropicNotConfiguredError'
  }
}

export function isAnthropicAvailable(): boolean {
  return !!process.env['ANTHROPIC_API_KEY']
}

export function getAnthropicClient(): Anthropic {
  if (!isAnthropicAvailable()) {
    throw new AnthropicNotConfiguredError()
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']! })
  }
  return client
}

/**
 * Para uso em testes — força reset do client singleton.
 */
export function resetAnthropicClientForTesting(): void {
  client = null
}

// ─── Vision call (multimodal) ─────────────────────────────────────────────────

export interface VisionMessage {
  systemPrompt: string
  userText: string
  images: Array<{ mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }>
}

export interface VisionResult {
  text: string
  estimatedCostUsd: number
}

/**
 * Chama Claude Vision (Haiku 4.5) com 1+ imagens base64.
 *
 * Pré-condições já validadas pelo caller:
 * - budget-guard.assertBudgetAvailable('vision', estimatedCost, tokenHash)
 * - vision-rate-limiter.checkVisionRateLimit(tokenHash, images.length)
 *
 * Side effects desta função:
 * - quota_log: recordQuota('anthropic:vision', tokenHash, toolName, { costUsd })
 * - audit log: VISION_API_CALL
 */
export async function callVision(
  msg: VisionMessage,
  tokenHash: string,
  toolName: string,
): Promise<VisionResult> {
  const start = Date.now()
  const anthropic = getAnthropicClient()
  const estimatedCostUsd = ANTHROPIC_COSTS.vision_per_image_usd * msg.images.length

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4000,
      system: msg.systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            ...msg.images.map((img) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: img.mediaType,
                data: img.base64,
              },
            })),
            { type: 'text' as const, text: msg.userText },
          ],
        },
      ],
    })

    // Extrai texto do primeiro bloco type=text
    const textBlock = response.content.find((b) => b.type === 'text')
    const text = textBlock && 'text' in textBlock ? textBlock.text : ''

    recordQuota('anthropic:vision', tokenHash, toolName, { costUsd: estimatedCostUsd })
    void auditLog({
      action: 'VISION_API_CALL',
      toolName,
      success: true,
      durationMs: Date.now() - start,
    })

    return { text, estimatedCostUsd }
  } catch (err) {
    void auditLog({
      action: 'VISION_API_CALL',
      toolName,
      success: false,
      durationMs: Date.now() - start,
      errorCode: err instanceof Error ? err.constructor.name : 'UnknownError',
    })
    throw err
  }
}

// ─── Text call (Haiku/Sonnet) ─────────────────────────────────────────────────

export type ClaudeTextModel = 'claude-haiku-4-5' | 'claude-sonnet-4-6'

export interface TextResult {
  text: string
  estimatedCostUsd: number
}

export async function callText(
  model: ClaudeTextModel,
  systemPrompt: string,
  userText: string,
  tokenHash: string,
  toolName: string,
  maxTokens: number = 4000,
): Promise<TextResult> {
  const start = Date.now()
  const anthropic = getAnthropicClient()
  const estimatedCostUsd =
    model === 'claude-sonnet-4-6'
      ? ANTHROPIC_COSTS.sonnet_per_call_usd
      : ANTHROPIC_COSTS.haiku_per_call_usd
  const endpoint = model === 'claude-sonnet-4-6' ? 'anthropic:sonnet' : 'anthropic:haiku'

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
    })

    const textBlock = response.content.find((b) => b.type === 'text')
    const text = textBlock && 'text' in textBlock ? textBlock.text : ''

    recordQuota(endpoint, tokenHash, toolName, { costUsd: estimatedCostUsd })
    void auditLog({
      action: 'NLP_LLM_CALL',
      toolName,
      success: true,
      durationMs: Date.now() - start,
    })

    return { text, estimatedCostUsd }
  } catch (err) {
    void auditLog({
      action: 'NLP_LLM_CALL',
      toolName,
      success: false,
      durationMs: Date.now() - start,
      errorCode: err instanceof Error ? err.constructor.name : 'UnknownError',
    })
    throw err
  }
}
