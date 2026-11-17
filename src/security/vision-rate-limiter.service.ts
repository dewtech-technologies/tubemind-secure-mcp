/**
 * Rate limiter dedicado para chamadas Anthropic Vision API.
 *
 * Separado do rate limiter principal (YouTube) — Vision tem custo monetário
 * e characteristics próprias. Janela deslizante de 60s, max 20 imagens/min
 * por OAuth token (RS-2.8).
 *
 * In-memory (não persistente) — reset a cada restart do MCP process.
 */

export class VisionRateLimitError extends Error {
  readonly retryAfterMs: number
  constructor(retryAfterMs: number) {
    super(
      `Rate limit Vision atingido (max 20 imagens/min). Tente novamente em ${Math.ceil(retryAfterMs / 1000)}s.`,
    )
    this.name = 'VisionRateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}

const MAX_IMAGES_PER_MINUTE = 20
const WINDOW_MS = 60_000

interface TokenWindow {
  timestamps: number[]
}

const windows = new Map<string, TokenWindow>()

/**
 * Verifica e registra `n` chamadas Vision. Lança VisionRateLimitError se exceder.
 *
 * @param tokenHash hash do OAuth do usuário
 * @param imageCount número de imagens nesta chamada
 */
export function checkVisionRateLimit(tokenHash: string, imageCount: number = 1): void {
  const now = Date.now()
  const cutoff = now - WINDOW_MS

  let window = windows.get(tokenHash)
  if (!window) {
    window = { timestamps: [] }
    windows.set(tokenHash, window)
  }

  // Remove timestamps fora da janela
  window.timestamps = window.timestamps.filter((t) => t > cutoff)

  if (window.timestamps.length + imageCount > MAX_IMAGES_PER_MINUTE) {
    // Próximo slot livre: window oldest + WINDOW_MS
    const oldest = window.timestamps[0] ?? now
    const retryAfterMs = Math.max(0, oldest + WINDOW_MS - now)
    throw new VisionRateLimitError(retryAfterMs)
  }

  // Registra as `imageCount` chamadas
  for (let i = 0; i < imageCount; i++) {
    window.timestamps.push(now)
  }
}

/**
 * Para uso em testes — limpa estado global.
 */
export function resetVisionRateLimiterForTesting(): void {
  windows.clear()
}
