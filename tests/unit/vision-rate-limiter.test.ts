import { describe, it, expect, beforeEach } from 'vitest'
import {
  checkVisionRateLimit,
  VisionRateLimitError,
  resetVisionRateLimiterForTesting,
} from '../../src/security/vision-rate-limiter.service.js'
import { sha256 } from '../../src/utils/hash.js'

describe('vision-rate-limiter — task-006 (RS-2.8)', () => {
  const tokenHash = sha256('rl-test')

  beforeEach(() => {
    resetVisionRateLimiterForTesting()
  })

  it('should_allow_up_to_20_images_in_one_minute', () => {
    for (let i = 0; i < 20; i++) {
      expect(() => checkVisionRateLimit(tokenHash, 1)).not.toThrow()
    }
  })

  it('should_throw_on_21st_image_within_minute', () => {
    for (let i = 0; i < 20; i++) checkVisionRateLimit(tokenHash, 1)
    expect(() => checkVisionRateLimit(tokenHash, 1)).toThrow(VisionRateLimitError)
  })

  it('should_count_bulk_calls_correctly', () => {
    // 1 call de 15 imagens + 1 call de 5 imagens = 20 (no limite)
    expect(() => checkVisionRateLimit(tokenHash, 15)).not.toThrow()
    expect(() => checkVisionRateLimit(tokenHash, 5)).not.toThrow()
    // Próxima imagem ultrapassa
    expect(() => checkVisionRateLimit(tokenHash, 1)).toThrow(VisionRateLimitError)
  })

  it('should_isolate_rate_limit_per_token', () => {
    const tokenA = sha256('A')
    const tokenB = sha256('B')
    for (let i = 0; i < 20; i++) checkVisionRateLimit(tokenA, 1)
    // Token B começa do zero
    expect(() => checkVisionRateLimit(tokenB, 20)).not.toThrow()
  })

  it('should_include_retryAfterMs_in_error', () => {
    for (let i = 0; i < 20; i++) checkVisionRateLimit(tokenHash, 1)
    try {
      checkVisionRateLimit(tokenHash, 1)
      throw new Error('Expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VisionRateLimitError)
      const e = err as VisionRateLimitError
      expect(e.retryAfterMs).toBeGreaterThan(0)
      expect(e.retryAfterMs).toBeLessThanOrEqual(60_000)
    }
  })
})
