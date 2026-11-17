# task-004: Batch optimization (getVideosByIdsBatched + refactor 6 tools)

## Objective
Ao final desta task, `getVideosByIdsBatched` substitui 6 ocorrências legadas; benchmark mostra ≥ 80% redução de quota em `analyze_title_patterns` (30 IDs: 30u → ≤ 2u); todos os testes v0.1 continuam verdes (backward compat).

## Description
Refatora as 6 tools v0.1 que fazem fan-out de IDs (`Promise.all(ids.map(getVideoById))` — gasta 1 quota unit por ID) para usar a nova função `getVideosByIdsBatched` que envia até 50 IDs em uma única chamada `videos.list` (1 quota unit por lote de 50). Reduz drasticamente o consumo de quota YouTube API sem mudar a assinatura MCP das tools (backward compat).

## Dependencies
- `task-003` (cache disponível — batch result também é cacheado)

## Complexity
MED

## Files to create / modify
- MODIFICAR `src/services/youtube.service.ts` — adicionar `getVideosByIdsBatched(client, ids, opts?)`
- MODIFICAR `src/tools/heuristic.tool.ts` — refactor de:
  - `estimate_keyword_difficulty` (linha ~49: `Promise.all(videoIds.map(id => getVideoById(client, id)))`)
  - `analyze_title_patterns` (linha ~181: `videoIds.slice(0, 30).map(id => getVideoById(client, id))`)
  - `detect_content_gaps` (linha ~315: `videoIds.map(id => getVideoById(client, id))`)
- MODIFICAR `src/tools/heuristic-advanced.tool.ts` — refactor de:
  - `find_trending_keywords` (linha ~347)
  - `analyze_retention_signals` (linha ~448 — JÁ usa videos.list batch nativamente; preservar)
  - `generate_content_calendar` (linhas ~659 e ~702)
- CRIAR `tests/integration/batch-optimization.test.ts` — benchmark quota antes/depois
- CRIAR `tests/integration/v01-regression.test.ts` — snapshots das 6 tools com input idêntico

## Implementation steps
1. **getVideosByIdsBatched:**
   ```typescript
   export async function getVideosByIdsBatched(
     client: YouTubeClient,
     ids: string[],
   ): Promise<(youtube_v3.Schema$Video | null)[]> {
     // 1. Validar cada ID via regex /^[a-zA-Z0-9_-]{11}$/ (filtrar inválidos)
     const validIds = ids.filter(id => /^[a-zA-Z0-9_-]{11}$/.test(id));
     if (validIds.length === 0) return [];
     // 2. Dividir em chunks de 50
     const chunks: string[][] = [];
     for (let i = 0; i < validIds.length; i += 50) {
       chunks.push(validIds.slice(i, i + 50));
     }
     // 3. Para cada chunk: client.videos.list({ part: [...], id: chunk })
     const allVideos: youtube_v3.Schema$Video[] = [];
     for (const chunk of chunks) {
       const res = await client.videos.list({
         part: ['snippet', 'statistics', 'contentDetails'],
         id: chunk,
       });
       allVideos.push(...(res.data.items ?? []));
       quotaService.record('youtube:videos.list', 1); // 1 unit por chunk
     }
     // 4. Preservar ordem dos IDs originais (map por ID → video, fallback null)
     const videoMap = new Map(allVideos.map(v => [v.id, v]));
     return ids.map(id => videoMap.get(id) ?? null);
   }
   ```
2. **Refactor de cada ocorrência:** substitua `Promise.all(ids.map(id => getVideoById(client, id)))` por `(await getVideosByIdsBatched(client, ids)).filter(v => v !== null)`
3. **Preservar shape de retorno:** as tools v0.1 esperam arrays não-nulos, então `.filter(Boolean)` continua igual
4. **Integração com cache:** `getVideosByIdsBatched` deve usar `withCache('videos_batch', { ids: ids.sort().join(',') }, tokenHash, fetcher)` para evitar re-fetch de batches conhecidos

## Validation Gates (Ralph Loop)
- [ ] `pnpm build` — 0 erros
- [ ] `pnpm test` — 100% (incluindo v01-regression)
- [ ] `pnpm lint` — 0 warnings
- [ ] Snapshots v0.1 (testes anteriores ao Tubemind v0.2) inalterados (output das 6 tools)
- [ ] Benchmark: `analyze_title_patterns` com 30 vídeos = 1-2 chamadas API (não 30)
- [ ] `grep -rn "Promise.all(.*getVideoById" src/tools/` retorna 0 resultados
- [ ] Cache hit de batch: 2ª chamada com mesmo conjunto de IDs = 0 quota (cache only)

## Tests
```bash
pnpm test tests/integration/batch-optimization.test.ts tests/integration/v01-regression.test.ts
# Casos:
# - should_batch_50_ids_in_single_api_call
# - should_split_100_ids_into_2_batches
# - should_filter_invalid_video_ids_via_regex
# - should_preserve_order_of_input_ids
# - should_return_null_for_not_found_videos
# - should_record_one_quota_unit_per_chunk_not_per_id
# - should_use_cache_on_second_call_with_same_ids
# - regression: analyze_title_patterns output matches v0.1 snapshot
# - regression: estimate_keyword_difficulty score matches v0.1 (±2 pontos margem)
```

## Security considerations
- ✅ **RS-3.6 (aplicado preventivamente):** regex de videoId rejeita inputs malformados
- ⚠️ **Cache poisoning:** chave de batch usa `ids.sort().join(',')` para ser deterministic — testar com ordens diferentes
- ✅ Audit log de cada batch (`YOUTUBE_BATCH_FETCH` com `count` de IDs)

## Anti-stub contract
- ❌ Nenhuma das 6 tools refatoradas pode reter o padrão antigo
- ❌ Nada de wrapper que internamente ainda faz `map(getVideoById)`
- ✅ Snapshot tests precisam usar fixtures reais (não dados hardcoded em controllers)

## Next task
- Camada 1 completa após task-005
- Paralelo: task-005 (Quota Tracker), task-006 (Vision), task-008 (Sanitizer)
