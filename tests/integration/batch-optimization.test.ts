import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { getVideosByIdsBatched } from '../../src/services/youtube.service.js'
import { resetDbForTesting } from '../../src/services/db.service.js'
import { getUsage } from '../../src/services/quota.service.js'
import { sha256 } from '../../src/utils/hash.js'

describe('batch optimization — task-004', () => {
  let tmpDir: string
  let originalCachePath: string | undefined
  let originalCacheEnabled: string | undefined
  const tokenHash = sha256('batch-test-token')

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tubemind-batch-test-'))
    originalCachePath = process.env['TUBEMIND_CACHE_PATH']
    originalCacheEnabled = process.env['TUBEMIND_CACHE_ENABLED']
    process.env['TUBEMIND_CACHE_PATH'] = join(tmpDir, 'cache.db')
    process.env['TUBEMIND_CACHE_ENABLED'] = 'true'
    resetDbForTesting()
  })

  afterEach(() => {
    resetDbForTesting()
    if (originalCachePath !== undefined) process.env['TUBEMIND_CACHE_PATH'] = originalCachePath
    else delete process.env['TUBEMIND_CACHE_PATH']
    if (originalCacheEnabled !== undefined)
      process.env['TUBEMIND_CACHE_ENABLED'] = originalCacheEnabled
    else delete process.env['TUBEMIND_CACHE_ENABLED']
    rmSync(tmpDir, { recursive: true, force: true })
  })

  // Mock client.videos.list para contar chamadas
  function makeMockClient(returnVideos: Array<{ id: string }>) {
    const calls: Array<{ ids: string[] }> = []
    return {
      calls,
      videos: {
        list: vi.fn(async (params: { id: string[] }) => {
          calls.push({ ids: params.id })
          const items = returnVideos.filter((v) => params.id.includes(v.id))
          return { data: { items } }
        }),
      },
    }
  }

  describe('chunking (RF-1.7)', () => {
    it('should_batch_50_ids_in_single_api_call', async () => {
      const ids = Array.from({ length: 50 }, (_, i) =>
        `ab${String(i).padStart(7, '0')}xy`,
      )
      const mock = makeMockClient(ids.map((id) => ({ id })))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getVideosByIdsBatched(mock as any, ids, { tokenHash, toolName: 't1' })

      expect(mock.calls.length).toBe(1)
      expect(mock.calls[0]?.ids.length).toBe(50)
    })

    it('should_split_100_ids_into_2_batches', async () => {
      const ids = Array.from({ length: 100 }, (_, i) =>
        `ab${String(i).padStart(7, '0')}xy`,
      )
      const mock = makeMockClient(ids.map((id) => ({ id })))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getVideosByIdsBatched(mock as any, ids, { tokenHash, toolName: 't1' })

      expect(mock.calls.length).toBe(2)
      expect(mock.calls[0]?.ids.length).toBe(50)
      expect(mock.calls[1]?.ids.length).toBe(50)
    })

    it('should_filter_invalid_video_ids_via_regex_preventively', async () => {
      const ids = ['abc12345678', 'invalid-too-short', 'valid12345A', '!!!@@@']
      const mock = makeMockClient(ids.map((id) => ({ id })))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getVideosByIdsBatched(mock as any, ids, { tokenHash, toolName: 't1' })

      // Apenas IDs válidos (11 chars [a-zA-Z0-9_-]) chegam à API
      expect(mock.calls[0]?.ids).toEqual(['abc12345678', 'valid12345A'])
    })

    it('should_return_array_with_same_length_as_input_preserving_order', async () => {
      const ids = ['abcdefghi12', 'bbbbbbbbbbb', 'invalid', 'cccccccccc1']
      const mock = makeMockClient([
        { id: 'abcdefghi12' },
        { id: 'cccccccccc1' },
        // bbbbbbbbbbb não está no return (videoId não encontrado)
      ])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await getVideosByIdsBatched(mock as any, ids, {
        tokenHash,
        toolName: 't1',
        useCache: false,
      })

      expect(result).toHaveLength(4)
      expect(result[0]?.id).toBe('abcdefghi12')
      expect(result[1]).toBeNull() // não encontrado
      expect(result[2]).toBeNull() // inválido
      expect(result[3]?.id).toBe('cccccccccc1')
    })

    it('should_return_all_null_when_all_ids_invalid', async () => {
      const ids = ['too-short', '!!!@@@', '']
      const mock = makeMockClient([])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await getVideosByIdsBatched(mock as any, ids, { tokenHash, toolName: 't1' })

      expect(mock.calls.length).toBe(0)
      expect(result).toEqual([null, null, null])
    })
  })

  describe('quota tracking (RF-1.9)', () => {
    it('should_record_one_quota_unit_per_chunk_not_per_id', async () => {
      const ids = Array.from({ length: 100 }, (_, i) =>
        `ab${String(i).padStart(7, '0')}xy`,
      )
      const mock = makeMockClient(ids.map((id) => ({ id })))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getVideosByIdsBatched(mock as any, ids, {
        tokenHash,
        toolName: 'tool-batch',
        useCache: false,
      })

      const report = getUsage('today', tokenHash)
      // 2 chunks × 1 unit cada = 2 units (vs 100 units no padrão antigo)
      expect(report.totalYouTubeUnits).toBe(2)
    })

    it('should_NOT_record_quota_when_tokenHash_or_toolName_omitted', async () => {
      const ids = ['abcdefghi12']
      const mock = makeMockClient([{ id: 'abcdefghi12' }])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getVideosByIdsBatched(mock as any, ids)

      const report = getUsage('today', tokenHash)
      expect(report.totalYouTubeUnits).toBe(0)
    })
  })

  describe('cache integration (RF-1.1)', () => {
    it('should_use_cache_on_second_identical_call', async () => {
      const ids = ['abcdefghi12', 'jjjjjjjjjjj', 'kkkkkkkkkkk']
      const mock = makeMockClient(ids.map((id) => ({ id })))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getVideosByIdsBatched(mock as any, ids, { tokenHash, toolName: 't1' })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getVideosByIdsBatched(mock as any, ids, { tokenHash, toolName: 't1' })

      // 2ª chamada deve hit no cache (1 fetch total)
      expect(mock.calls.length).toBe(1)
    })

    it('should_use_same_cache_entry_regardless_of_id_order', async () => {
      const idsA = ['abcdefghi12', 'jjjjjjjjjjj', 'kkkkkkkkkkk']
      const idsB = ['kkkkkkkkkkk', 'abcdefghi12', 'jjjjjjjjjjj'] // ordem trocada
      const mock = makeMockClient(idsA.map((id) => ({ id })))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getVideosByIdsBatched(mock as any, idsA, { tokenHash, toolName: 't1' })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getVideosByIdsBatched(mock as any, idsB, { tokenHash, toolName: 't1' })

      // Cache hit — chave é ordem-estável
      expect(mock.calls.length).toBe(1)
    })

    it('should_bypass_cache_when_useCache_false', async () => {
      const ids = ['abcdefghi12']
      const mock = makeMockClient([{ id: 'abcdefghi12' }])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getVideosByIdsBatched(mock as any, ids, {
        tokenHash,
        toolName: 't1',
        useCache: false,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getVideosByIdsBatched(mock as any, ids, {
        tokenHash,
        toolName: 't1',
        useCache: false,
      })

      expect(mock.calls.length).toBe(2)
    })
  })
})
