import { createHash } from 'node:crypto'

/**
 * SHA-256 hex digest de uma string. Usado para:
 * - Hash do OAuth token no cache (RS-1.2 — nunca armazenar plain)
 * - Construção da chave de cache (RS-1.3 — isolamento por token)
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex')
}
