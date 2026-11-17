# task-003: Cache Service (get/set/bypass/LRU evict)

## Objective
Ao final desta task, `cache.service.ts` expõe API completa (get/set/bypass/evictLRU/stats); cache hit 2ª chamada < 100ms; LRU libera bytes corretos em teste de stress; isolation por OAuth token verificado.

## Description
Implementa a camada core de cache do Tubemind v0.2. Reduz consumo da YouTube API e custo Anthropic dramaticamente quando combinado com batch (task-004). Chave SHA-256 com `tool + paramsJSON + token_hash + tubemind_version`. TTL configurável por tool. LRU eviction quando DB > 100MB. Fallback gracioso se SQLite indisponível (não pode quebrar tools — RNF-1.3).

## Dependencies
- `task-002` (precisa do schema + migrations runner)

## Complexity
HIGH

## Files to create / modify
- CRIAR `src/services/cache.service.ts` — API pública: cacheGet, cacheSet, cacheBypass, cacheEvictLRU, cacheStats, withCache (wrapper)
- CRIAR `src/config/cache.config.ts` — map `<toolName, ttlSeconds>` com defaults sensatos
- CRIAR `src/services/db.service.ts` — singleton de conexão `better-sqlite3` (lazy init, fallback graceful)
- MODIFICAR `src/security/ssrf-guard.service.ts` — adicionar `*.ytimg.com` e `*.googleusercontent.com` à whitelist (preparação Camada 2)
- CRIAR `src/utils/hash.ts` — helper `sha256(string): string`
- CRIAR `tests/unit/cache.service.test.ts` — 15+ casos
- CRIAR `tests/integration/cache-hit-miss.test.ts` — fluxo end-to-end

## Implementation steps
1. **db.service.ts singleton:**
   ```typescript
   let db: Database | null = null;
   export function getDb(): Database | null {
     if (db) return db;
     try {
       db = new Database(getDbPath(), { fileMustExist: false });
       runMigrations(db);
       return db;
     } catch (e) {
       auditLog('CACHE_INIT_FAILED', { error: e.message });
       return null; // fallback graceful
     }
   }
   ```
2. **cache.config.ts:**
   ```typescript
   export const CACHE_TTL: Record<string, number> = {
     'search_trending_topics': 3600,           // 1h
     'get_keyword_stats': 21600,                // 6h
     'estimate_keyword_difficulty': 86400,      // 24h
     'analyze_title_patterns': 86400,
     'detect_content_gaps': 43200,              // 12h
     'find_trending_keywords': 86400,
     'analyze_retention_signals': 86400,
     'generate_content_calendar': 43200,
     'get_channel_analytics': 3600,
     'analyze_thumbnail_visuals': 604800,       // 7d (Camada 2)
     'analyze_video_comments': 86400,           // 24h (Camada 3)
     'analyze_video_transcript': 604800,        // 7d
   };
   ```
3. **withCache wrapper:**
   ```typescript
   export async function withCache<T>(
     toolName: string,
     params: object,
     tokenHash: string,
     fetcher: () => Promise<T>,
     options: { fresh?: boolean } = {}
   ): Promise<T> {
     const key = computeKey(toolName, params, tokenHash);
     if (!options.fresh) {
       const hit = await cacheGet<T>(key);
       if (hit !== null) { auditLog('CACHE_HIT', { tool: toolName }); return hit; }
     }
     auditLog('CACHE_MISS', { tool: toolName });
     const result = await fetcher();
     await cacheSet(key, result, { tool: toolName, tokenHash, ttlSeconds: CACHE_TTL[toolName] ?? 3600 });
     return result;
   }
   ```
4. **cacheEvictLRU:** quando size > 100MB, DELETE FROM cache_entries ORDER BY last_accessed ASC LIMIT N até liberar 20%
5. **Toggle global:** se `process.env.TUBEMIND_CACHE_ENABLED === 'false'`, todos os métodos viram no-ops

## Validation Gates (Ralph Loop)
- [ ] `pnpm build` — 0 erros
- [ ] `pnpm test tests/unit/cache.service.test.ts` — 100%
- [ ] `pnpm test tests/integration/cache-hit-miss.test.ts` — 100%
- [ ] Cache hit 2ª chamada < 100ms (medido com `performance.now()`)
- [ ] LRU evict libera ≥ 20% quando size > 100MB (teste de stress com 1000 entries fake)
- [ ] Token isolation: 2 tokenHashes diferentes não compartilham cache (teste explícito)
- [ ] Fallback gracioso: se DB indisponível, cacheGet retorna null, cacheSet é no-op, NENHUMA exceção

## Tests
```bash
pnpm test tests/unit/cache.service.test.ts tests/integration/cache-hit-miss.test.ts
# Casos cobertos:
# - should_return_null_when_key_does_not_exist
# - should_return_cached_value_when_within_ttl
# - should_return_null_when_ttl_expired
# - should_increment_access_count_on_hit
# - should_update_last_accessed_on_hit
# - should_isolate_cache_per_token_hash
# - should_bypass_cache_when_fresh_true
# - should_evict_lru_when_size_exceeds_100mb
# - should_no_op_when_cache_disabled_via_env
# - should_handle_db_unavailable_gracefully
# - should_invalidate_cache_on_version_change
```

## Security considerations
- ✅ **RS-1.1:** Todas as queries usam prepared statements via `better-sqlite3` (.prepare().run())
- ✅ **RS-1.2:** Token hash SHA-256 (jamais armazena token plain)
- ✅ **RS-1.3:** Query SEMPRE inclui `WHERE token_hash = ?` (verificado em testes)
- ✅ **RS-1.6:** Audit log de CACHE_HIT, CACHE_MISS, CACHE_EVICT, CACHE_BYPASS

## Anti-stub contract
- ❌ Nenhuma função pública pode retornar `null` como única statement (exceto fallback explícito documentado)
- ❌ Nenhum `// TODO` ou `throw new Error('not implemented')`
- ✅ `cacheGet/Set/Evict` DEVEM tocar a DB real em testes (mock só de fetcher externo, nunca da DB)

## Next task
- `task-004` (Batch Optimization)
- `task-005` (Quota Tracker) — paralelo
- `task-006` (Vision Service) — paralelo
- `task-008` (Sanitizer + PII) — paralelo
