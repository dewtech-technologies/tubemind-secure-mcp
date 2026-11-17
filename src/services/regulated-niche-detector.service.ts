/**
 * Detector de nichos regulados (RS-4.6).
 *
 * Identifica conteúdo de domínios que exigem disclaimer legal/profissional:
 * financeiro, médico, jurídico. Detecção por keywords (heurística, não NLP).
 */

export type RegulatedNiche = 'financeiro' | 'medico' | 'juridico' | null

const REGULATED_KEYWORDS: Record<Exclude<RegulatedNiche, null>, readonly string[]> = {
  financeiro: [
    'investimento',
    'investir',
    'ação',
    'ações',
    'bolsa',
    'b3',
    'cripto',
    'criptomoeda',
    'bitcoin',
    'ethereum',
    'trading',
    'forex',
    'opções',
    'day trade',
    'renda fixa',
    'tesouro',
    'imposto de renda',
  ],
  medico: [
    'saúde',
    'remédio',
    'medicamento',
    'tratamento',
    'diagnóstico',
    'sintoma',
    'doença',
    'cura',
    'terapia',
    'médico',
    'consulta',
    'farmácia',
    'antibiótico',
    'vacina',
    'hospital',
  ],
  juridico: [
    'jurídico',
    'lei',
    'processo',
    'advogado',
    'tribunal',
    'ação judicial',
    'contrato',
    'direitos',
    'trabalhista',
    'previdenciário',
    'consumidor',
    'criminal',
    'tributário',
  ],
}

export const DISCLAIMERS: Record<Exclude<RegulatedNiche, null>, string> = {
  financeiro:
    '⚠️ **Aviso:** Este conteúdo é educativo e NÃO constitui recomendação de investimento. Investimentos envolvem riscos. Consulte um profissional certificado pela CVM antes de tomar decisões.',
  medico:
    '⚠️ **Aviso:** Este conteúdo é informativo e NÃO substitui consulta médica. Procure um profissional de saúde qualificado para qualquer condição ou tratamento.',
  juridico:
    '⚠️ **Aviso:** Este conteúdo é informativo e NÃO constitui aconselhamento jurídico. Consulte um advogado para seu caso específico.',
}

/**
 * Detecta nicho regulado por keyword matching em texto (case-insensitive).
 * Retorna o PRIMEIRO match encontrado (prioridade financeiro > medico > juridico).
 */
export function detectRegulatedNiche(text: string): RegulatedNiche {
  const lower = text.toLowerCase()
  for (const [niche, keywords] of Object.entries(REGULATED_KEYWORDS) as Array<
    [Exclude<RegulatedNiche, null>, readonly string[]]
  >) {
    if (keywords.some((kw) => lower.includes(kw))) return niche
  }
  return null
}
