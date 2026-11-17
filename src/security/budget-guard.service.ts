/**
 * Budget Guard — cap diário de custo por categoria (Vision/NLP/Workflow).
 *
 * Lê o uso acumulado do dia em `quota_log` (USD) por categoria de endpoint
 * e bloqueia se a chamada proposta ultrapassaria o cap configurado.
 *
 * Caps configuráveis via env:
 * - VISION_DAILY_BUDGET_USD  (default 5.00)
 * - NLP_DAILY_BUDGET_USD     (default 10.00)
 * - WORKFLOW_DAILY_BUDGET_USD (default 20.00)
 */

import { getDb } from '../services/db.service.js'

export type BudgetCategory = 'vision' | 'nlp' | 'workflow'

export class BudgetExceededError extends Error {
  readonly category: BudgetCategory
  readonly currentSpent: number
  readonly proposedCost: number
  readonly cap: number

  constructor(category: BudgetCategory, currentSpent: number, proposedCost: number, cap: number) {
    super(
      `Budget cap ${category} atingido: $${currentSpent.toFixed(4)} gasto + $${proposedCost.toFixed(4)} proposto > $${cap.toFixed(2)} cap diário. Reset à meia-noite UTC.`,
    )
    this.name = 'BudgetExceededError'
    this.category = category
    this.currentSpent = currentSpent
    this.proposedCost = proposedCost
    this.cap = cap
  }
}

function getCapForCategory(category: BudgetCategory): number {
  const envKey =
    category === 'vision'
      ? 'VISION_DAILY_BUDGET_USD'
      : category === 'nlp'
        ? 'NLP_DAILY_BUDGET_USD'
        : 'WORKFLOW_DAILY_BUDGET_USD'
  const defaultValue = category === 'vision' ? 5 : category === 'nlp' ? 10 : 20
  const fromEnv = process.env[envKey]
  if (fromEnv) {
    const n = parseFloat(fromEnv)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return defaultValue
}

function getEndpointPrefixForCategory(_category: BudgetCategory): string {
  // Todos compartilham 'anthropic:' — distinção fina por subcategoria é opcional.
  // Para v0.2 simples: somamos uso Anthropic do dia contra os 3 caps separados
  // (cada caller decide qual cap usar). Refinar em task posterior se necessário.
  return 'anthropic:'
}

function getDayBucket(): string {
  return new Date().toISOString().split('T')[0] as string
}

/**
 * Soma quanto foi gasto HOJE em USD para o token informado.
 * Inclui apenas endpoints que casam com o prefix da categoria.
 */
export function getCurrentSpent(category: BudgetCategory, tokenHash: string): number {
  const db = getDb()
  if (!db) return 0

  const prefix = getEndpointPrefixForCategory(category) + '%'
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
       FROM quota_log
       WHERE day_bucket = ? AND token_hash = ? AND endpoint LIKE ?`,
    )
    .get(getDayBucket(), tokenHash, prefix) as { total: number }

  return row.total
}

/**
 * Valida se uma chamada proposta cabe no cap. Lança BudgetExceededError se não.
 *
 * @param category    'vision' | 'nlp' | 'workflow'
 * @param proposedUsd custo USD da chamada que será feita
 * @param tokenHash   hash do OAuth do usuário (isolamento)
 */
export function assertBudgetAvailable(
  category: BudgetCategory,
  proposedUsd: number,
  tokenHash: string,
): void {
  const cap = getCapForCategory(category)
  const current = getCurrentSpent(category, tokenHash)
  if (current + proposedUsd > cap) {
    throw new BudgetExceededError(category, current, proposedUsd, cap)
  }
}
