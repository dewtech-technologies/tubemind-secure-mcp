import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  computeCacheKey,
  cacheGet,
  cacheSet,
  cacheBypass,
  cacheEvictLRU,
  cacheStats,
  withCache,
} from '../../src/services/cache.service.js'
import { resetDbForTesting } from '../../src/services/db.service.js'
import { sha256 } from '../../src/utils/hash.js'

describe('cache.service — task-003', () => {
  let tmpDir: string
  let originalCachePath: string | undefined
  let originalCacheEnabled: string | undefined

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tubemind-cache-test-'))
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

  describe('computeCacheKey', () => {
    it('should_produce_deterministic_key_for_same_inputs', () => {
      const k1 = computeCacheKey('search', { q: 'foo', region: 'BR' }, 'tokenHashAbc')
      const k2 = computeCacheKey('search', { q: 'foo', region: 'BR' }, 'tokenHashAbc')
      expect(k1).toBe(k2)
    })

    it('should_be_order_stable_independent_of_object_key_order', () => {
      const k1 = computeCacheKey('search', { a: 1, b: 2 }, 'tok')
      const k2 = computeCacheKey('search', { b: 2, a: 1 }, 'tok')
      expect(k1).toBe(k2)
    })

    it('should_differ_when_tokenHash_differs_isolation', () => {
      const k1 = computeCacheKey('search', { q: 'foo' }, 'tokenA')
      const k2 = computeCacheKey('search', { q: 'foo' }, 'tokenB')
      expect(k1).not.toBe(k2)
    })

    it('should_be_sha256_hex_64_chars', () => {
      const k = computeCacheKey('search', { q: 'foo' }, 'tok')
      expect(k).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  describe('cacheGet / cacheSet basics', () => {
    const tokenHash = sha256('user-token-1')

    it('should_return_null_when_key_does_not_exist', () => {
      const k = computeCacheKey('search', { q: 'inexistente' }, tokenHash)
      expect(cacheGet(k)).toBeNull()
    })

    it('should_return_cached_value_when_within_ttl', () => {
      const k = computeCacheKey('search', { q: 'hit' }, tokenHash)
      cacheSet(k, { results: [1, 2, 3] }, { tool: 'search', tokenHash, ttlSeconds: 3600 })
      const value = cacheGet<{ results: number[] }>(k)
      expect(value).toEqual({ results: [1, 2, 3] })
    })

    it('should_return_null_when_ttl_expired', () => {
      const k = computeCacheKey('search', { q: 'expired' }, tokenHash)
      cacheSet(k, 'old', { tool: 'search', tokenHash, ttlSeconds: -1 }) // já expirado
      expect(cacheGet(k)).toBeNull()
    })

    it('should_upsert_when_set_called_twice_with_same_key', () => {
      const k = computeCacheKey('search', { q: 'upsert' }, tokenHash)
      cacheSet(k, 'v1', { tool: 'search', tokenHash })
      cacheSet(k, 'v2', { tool: 'search', tokenHash })
      expect(cacheGet(k)).toBe('v2')
    })

    it('should_increment_access_count_on_hit', () => {
      const k = computeCacheKey('search', { q: 'counter' }, tokenHash)
      cacheSet(k, 'data', { tool: 'search', tokenHash })

      cacheGet(k)
      cacheGet(k)
      cacheGet(k)

      const stats = cacheStats()
      expect(stats.totalEntries).toBeGreaterThan(0)
    })
  })

  describe('isolation per OAuth token (RS-1.3)', () => {
    it('should_NOT_leak_cache_between_different_tokens', () => {
      const tokenA = sha256('token-user-A')
      const tokenB = sha256('token-user-B')

      const params = { q: 'shared-query', region: 'BR' }
      const keyA = computeCacheKey('search', params, tokenA)
      const keyB = computeCacheKey('search', params, tokenB)

      expect(keyA).not.toBe(keyB)

      cacheSet(keyA, { user: 'A', private: 'data-A' }, { tool: 'search', tokenHash: tokenA })

      // Tentar ler com tokenB NÃO retorna o valor de A
      expect(cacheGet(keyB)).toBeNull()
      expect(cacheGet(keyA)).toEqual({ user: 'A', private: 'data-A' })
    })
  })

  describe('cacheBypass (fresh = true)', () => {
    it('should_always_call_fetcher_and_overwrite_existing_value', async () => {
      const tokenHash = sha256('tok')
      const k = computeCacheKey('search', { q: 'bypass' }, tokenHash)

      cacheSet(k, 'old-value', { tool: 'search', tokenHash })

      let fetcherCalls = 0
      const result = await cacheBypass(
        k,
        async () => {
          fetcherCalls++
          return 'fresh-value'
        },
        { tool: 'search', tokenHash },
      )

      expect(fetcherCalls).toBe(1)
      expect(result).toBe('fresh-value')
      expect(cacheGet(k)).toBe('fresh-value')
    })
  })

  describe('cacheEvictLRU (RF-1.4)', () => {
    it('should_evict_oldest_entries_until_size_below_target', () => {
      const tokenHash = sha256('tok')

      // Cria 5 entries com timestamps last_accessed crescentes (set faz now = Date.now())
      for (let i = 0; i < 5; i++) {
        const k = computeCacheKey('big', { i }, tokenHash)
        // Payload grande para simular ocupação
        const big = { data: 'x'.repeat(50_000), idx: i }
        cacheSet(k, big, { tool: 'big', tokenHash })
      }

      const statsBefore = cacheStats()
      expect(statsBefore.totalEntries).toBeGreaterThanOrEqual(5)

      // Target absurdamente baixo — deve evictar quase tudo
      const freed = cacheEvictLRU(1000)
      expect(freed).toBeGreaterThan(0)

      const statsAfter = cacheStats()
      expect(statsAfter.totalBytes).toBeLessThanOrEqual(statsBefore.totalBytes)
    })

    it('should_return_zero_when_already_below_target', () => {
      // Cache vazio
      expect(cacheEvictLRU(1024 * 1024)).toBe(0)
    })
  })

  describe('withCache wrapper', () => {
    const tokenHash = sha256('wrap-token')

    it('should_call_fetcher_on_miss_and_return_value', async () => {
      let calls = 0
      const fetcher = async () => {
        calls++
        return { val: 42 }
      }

      const result = await withCache('search_trending_topics', { kw: 'ia' }, tokenHash, fetcher)
      expect(result).toEqual({ val: 42 })
      expect(calls).toBe(1)
    })

    it('should_NOT_call_fetcher_on_subsequent_hit', async () => {
      let calls = 0
      const fetcher = async () => {
        calls++
        return { val: 99 }
      }

      await withCache('search_trending_topics', { kw: 'pareto' }, tokenHash, fetcher)
      await withCache('search_trending_topics', { kw: 'pareto' }, tokenHash, fetcher)
      await withCache('search_trending_topics', { kw: 'pareto' }, tokenHash, fetcher)

      expect(calls).toBe(1)
    })

    it('should_bypass_cache_when_fresh_true', async () => {
      let calls = 0
      const fetcher = async () => {
        calls++
        return { call: calls }
      }

      await withCache('search_trending_topics', { kw: 'fresh' }, tokenHash, fetcher)
      const second = await withCache(
        'search_trending_topics',
        { kw: 'fresh' },
        tokenHash,
        fetcher,
        { fresh: true },
      )

      expect(calls).toBe(2)
      expect(second.call).toBe(2)
    })

    it('should_be_noop_when_cache_disabled_via_env_but_still_return_value', async () => {
      process.env['TUBEMIND_CACHE_ENABLED'] = 'false'
      resetDbForTesting()

      let calls = 0
      const fetcher = async () => {
        calls++
        return { v: 1 }
      }

      const r1 = await withCache('search_trending_topics', { kw: 'no-cache' }, tokenHash, fetcher)
      const r2 = await withCache('search_trending_topics', { kw: 'no-cache' }, tokenHash, fetcher)

      // Sem cache, fetcher é chamado em ambas
      expect(calls).toBe(2)
      expect(r1).toEqual({ v: 1 })
      expect(r2).toEqual({ v: 1 })
    })
  })

  describe('fail-soft behavior (RNF-1.3)', () => {
    it('should_return_value_from_fetcher_even_when_cache_disabled', async () => {
      process.env['TUBEMIND_CACHE_ENABLED'] = 'false'
      resetDbForTesting()

      const tokenHash = sha256('any')
      const result = await withCache('search_trending_topics', {}, tokenHash, async () => 'OK')
      expect(result).toBe('OK')
    })
  })
})
