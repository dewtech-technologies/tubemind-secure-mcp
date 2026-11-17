import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  analyzeThumbnailVisuals,
  scoreMyThumbnail,
  AnalyzeThumbnailVisualsSchema,
  ScoreMyThumbnailSchema,
} from '../../src/tools/vision.tool.js'
import { resetDbForTesting } from '../../src/services/db.service.js'

describe('vision.tool — task-007', () => {
  let tmpDir: string
  let saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tubemind-vision-test-'))
    saved = {
      cachePath: process.env['TUBEMIND_CACHE_PATH'],
      cacheEnabled: process.env['TUBEMIND_CACHE_ENABLED'],
      anthropicKey: process.env['ANTHROPIC_API_KEY'],
    }
    process.env['TUBEMIND_CACHE_PATH'] = join(tmpDir, 'cache.db')
    process.env['TUBEMIND_CACHE_ENABLED'] = 'true'
    resetDbForTesting()
  })

  afterEach(() => {
    resetDbForTesting()
    for (const k of Object.keys(saved) as Array<keyof typeof saved>) {
      const envKey =
        k === 'cachePath'
          ? 'TUBEMIND_CACHE_PATH'
          : k === 'cacheEnabled'
            ? 'TUBEMIND_CACHE_ENABLED'
            : 'ANTHROPIC_API_KEY'
      if (saved[k] !== undefined) process.env[envKey] = saved[k]
      else delete process.env[envKey]
    }
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('schema validation', () => {
    it('AnalyzeThumbnailVisualsSchema_should_apply_defaults', () => {
      const parsed = AnalyzeThumbnailVisualsSchema.parse({ niche: 'automação ia' })
      expect(parsed.regionCode).toBe('BR')
      expect(parsed.maxThumbs).toBe(15)
      expect(parsed.fresh).toBe(false)
    })

    it('AnalyzeThumbnailVisualsSchema_should_reject_maxThumbs_above_20', () => {
      expect(() =>
        AnalyzeThumbnailVisualsSchema.parse({ niche: 'x', maxThumbs: 50 }),
      ).toThrow()
    })

    it('AnalyzeThumbnailVisualsSchema_should_reject_short_niche', () => {
      expect(() => AnalyzeThumbnailVisualsSchema.parse({ niche: 'a' })).toThrow()
    })

    it('ScoreMyThumbnailSchema_should_accept_url_variant', () => {
      const parsed = ScoreMyThumbnailSchema.parse({
        thumbnailInput: { kind: 'url', value: 'https://i.ytimg.com/vi/abc/maxresdefault.jpg' },
        niche: 'tutorial',
      })
      expect(parsed.thumbnailInput.kind).toBe('url')
    })

    it('ScoreMyThumbnailSchema_should_accept_base64_variant', () => {
      const longBase64 = 'A'.repeat(150)
      const parsed = ScoreMyThumbnailSchema.parse({
        thumbnailInput: { kind: 'base64', value: longBase64 },
        niche: 'tutorial',
      })
      expect(parsed.thumbnailInput.kind).toBe('base64')
    })
  })

  describe('fallback gracioso sem ANTHROPIC_API_KEY (RF-2.16)', () => {
    it('analyze_thumbnail_visuals_should_return_friendly_message_when_key_missing', async () => {
      delete process.env['ANTHROPIC_API_KEY']
      const result = await analyzeThumbnailVisuals({ niche: 'teste' }, 'fake-token')
      expect(result).toContain('ANTHROPIC_API_KEY')
      expect(result).toContain('Camada 2')
    })

    it('score_my_thumbnail_should_return_friendly_message_when_key_missing', async () => {
      delete process.env['ANTHROPIC_API_KEY']
      const result = await scoreMyThumbnail(
        {
          thumbnailInput: { kind: 'url', value: 'https://i.ytimg.com/vi/abc/default.jpg' },
          niche: 'teste',
        },
        'fake-token',
      )
      expect(result).toContain('ANTHROPIC_API_KEY')
    })
  })
})
