/**
 * PII Filter — remoção/redação de dados pessoais antes de enviar para LLM.
 *
 * Aplicado em: análise de comentários (RS-3.5) — comentários podem ter
 * emails, telefones e CPFs que NÃO devem chegar à Anthropic.
 *
 * Estratégia: regex agressivo + substituição por placeholder. Falsos positivos
 * são aceitáveis (privacidade > precisão). Falsos NEGATIVOS são o problema
 * sério a evitar.
 */

// ─── Regex (BR-aware) ─────────────────────────────────────────────────────────

// Email — RFC-lite (cobre 99% dos casos reais)
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g

// Telefone BR — formatos comuns: (11) 98765-4321 | 11 98765-4321 | +5511987654321 | 11987654321
// Detecta tanto fixos (8 dígitos) quanto móveis (9 dígitos).
const PHONE_BR_REGEX = /(?:\+?55[\s-]?)?(?:\(?\d{2}\)?[\s-]?)?9?\d{4}[\s-]?\d{4}\b/g

// CPF — XXX.XXX.XXX-XX (com pontuação)
const CPF_REGEX = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g

// CNPJ — XX.XXX.XXX/XXXX-XX
const CNPJ_REGEX = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g

// CEP — XXXXX-XXX
const CEP_REGEX = /\b\d{5}-\d{3}\b/g

/**
 * Redige PII em uma string. Substitui matches por placeholders rotulados.
 * Idempotente: aplicar 2x produz mesmo output.
 */
export function redactPII(text: string): string {
  return text
    .replace(EMAIL_REGEX, '[EMAIL_REMOVIDO]')
    .replace(CPF_REGEX, '[CPF_REMOVIDO]')
    .replace(CNPJ_REGEX, '[CNPJ_REMOVIDO]')
    .replace(CEP_REGEX, '[CEP_REMOVIDO]')
    // Telefone POR ÚLTIMO — regex menos específico, pode conflitar
    .replace(PHONE_BR_REGEX, '[TELEFONE_REMOVIDO]')
}

/**
 * Verifica se uma string contém qualquer PII conhecida. Útil para asserts em testes.
 */
export function containsPII(text: string): boolean {
  return (
    EMAIL_REGEX.test(text) ||
    CPF_REGEX.test(text) ||
    CNPJ_REGEX.test(text) ||
    CEP_REGEX.test(text) ||
    PHONE_BR_REGEX.test(text)
  )
}
