/**
 * Tabela canonical de custos da Anthropic Claude API (USD).
 *
 * Valores baseados em pricing oficial (https://www.anthropic.com/pricing):
 * - Vision: ~$0.003 por imagem em Haiku 4.5 (~$0.01-0.05 dependendo do tamanho)
 * - Haiku text: $1/MTok input, $5/MTok output → ~$0.005 por chamada média
 * - Sonnet text: $3/MTok input, $15/MTok output → ~$0.02 por chamada média
 *
 * Estimativas conservadoras (over-estimate para budget guard ser preventivo).
 */

export const ANTHROPIC_COSTS = Object.freeze({
  vision_per_image_usd: 0.005,
  haiku_per_call_usd: 0.005, // estimativa média (5k tokens combined)
  sonnet_per_call_usd: 0.025, // estimativa média (10k tokens combined)
})

export function estimateVisionCost(imageCount: number): number {
  return ANTHROPIC_COSTS.vision_per_image_usd * imageCount
}
