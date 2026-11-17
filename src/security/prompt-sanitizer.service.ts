/**
 * Sanitização de input para prompts LLM — defesa contra prompt injection.
 *
 * Estratégia:
 * 1. Wrapper XML estrito `<comment idx="N" id="..."><![CDATA[...]]></comment>`
 * 2. Escape de `<` e `>` no conteúdo (evita quebra do wrapper)
 * 3. Remoção de ANSI escape sequences (alguns LLMs reagem a elas)
 * 4. Truncamento a MAX_COMMENT_LENGTH chars (anti-DoS + custo)
 * 5. Helper `wrapText` para inputs de uma única string (script topic, niche)
 *
 * Aplicado em: NLP comments (RS-3.1), Vision niche (RS-2.5),
 * Pipeline topic/niche/audience (RS-4.2).
 */

const MAX_COMMENT_LENGTH = 500
const MAX_TEXT_LENGTH = 1000

const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g

export interface SanitizableComment {
  id: string
  text: string
}

/**
 * Encapsula uma lista de comentários em tags XML com escape + truncamento.
 * Output é seguro para injetar em prompts LLM como bloco de dados.
 */
export function wrapComments(comments: readonly SanitizableComment[]): string {
  return comments
    .map((c, i) => {
      const sanitized = sanitizeBody(c.text, MAX_COMMENT_LENGTH)
      const safeId = c.id.replace(/[^a-zA-Z0-9_-]/g, '')
      return `<comment idx="${i}" id="${safeId}">${sanitized}</comment>`
    })
    .join('\n')
}

/**
 * Sanitiza um campo de texto único (ex: niche, topic). Retorna escaped + truncated.
 * Use quando precisar interpolar input do usuário no userText do prompt.
 */
export function wrapText(name: string, value: string): string {
  const sanitized = sanitizeBody(value, MAX_TEXT_LENGTH)
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '')
  return `<${safeName}>${sanitized}</${safeName}>`
}

/**
 * Versão sem wrapper — apenas sanitiza o body. Use quando precisar de string
 * limpa para concatenar em prompt sem markup.
 */
export function sanitizeBody(text: string, maxLength: number = MAX_TEXT_LENGTH): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const noAnsi = escaped.replace(ANSI_REGEX, '')
  return noAnsi.length > maxLength ? noAnsi.slice(0, maxLength) + '...' : noAnsi
}
