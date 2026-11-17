# task-007: Vision Tools (analyze_thumbnail_visuals + score_my_thumbnail)

## Objective
Ao final desta task, `analyze_thumbnail_visuals` retorna análise estruturada em < 60s para 15 thumbs; `score_my_thumbnail` aceita URL e base64; cache hit reduz custo ≥ 95% no 2º call (medido).

## Description
Implementa as 2 tools públicas da Camada 2 que expõem o motor de visão. `analyze_thumbnail_visuals` busca top N vídeos do nicho, baixa thumbnails, analisa em paralelo (max 5 concurrent), agrega resultados e gera recomendação textual. `score_my_thumbnail` aceita uma thumb candidata (URL ou base64) e compara com baseline do nicho.

## Dependencies
- `task-006` (Vision Service + fetcher + guards)

## Complexity
HIGH

## Files to create / modify
- CRIAR `src/tools/vision.tool.ts` — 2 tools com definitions MCP + handlers
- MODIFICAR `src/schemas/input.schemas.ts` — `AnalyzeThumbnailVisualsSchema`, `ScoreMyThumbnailSchema`
- MODIFICAR `src/index.ts` — registrar as 2 tools no router
- CRIAR `tests/integration/vision-end-to-end.test.ts` — fluxo completo com mock Anthropic
- CRIAR `tests/fixtures/thumbnails/` — 5 thumbs reais (com permissão de uso) + 1 com GPS EXIF

## Implementation steps
1. **AnalyzeThumbnailVisualsSchema:**
   ```typescript
   export const AnalyzeThumbnailVisualsSchema = z.object({
     niche: z.string().min(2).max(120),
     regionCode: z.string().regex(/^[A-Z]{2}$/).default('BR'),
     maxThumbs: z.number().int().min(3).max(20).default(15),
     fresh: z.boolean().default(false),
   });
   ```
2. **ScoreMyThumbnailSchema (discriminated union):**
   ```typescript
   export const ScoreMyThumbnailSchema = z.object({
     thumbnailInput: z.discriminatedUnion('kind', [
       z.object({ kind: z.literal('url'), value: z.string().url() }),
       z.object({ kind: z.literal('base64'), value: z.string().regex(/^[A-Za-z0-9+/=]+$/) }),
     ]),
     niche: z.string().min(2).max(120),
     regionCode: z.string().regex(/^[A-Z]{2}$/).default('BR'),
   });
   ```
3. **analyze_thumbnail_visuals handler:**
   - withCache(toolName, params, tokenHash, fetcher) com TTL 7d
   - fetcher: searchVideos(niche, maxThumbs, region, 'viewCount') → resolver thumbnail URLs (maxres → hq fallback) → `Promise.all` com `pLimit(5)` para fetchThumbnail → callClaudeVision por imagem → agregar
   - Pre-flight: `const estimateUsd = VISION_COST_PER_IMAGE_USD * input.maxThumbs;` no output prefix
   - Output markdown: ver BLUEPRINT seção 5.2 (Padrão do Nicho + análise individual + recomendação)
4. **score_my_thumbnail handler:**
   - Se `kind=url`: validar URL via fetcher (SSRF + size + content-type + EXIF strip)
   - Se `kind=base64`: decodificar, validar tamanho ≤ 5MB, strip EXIF via sharp
   - Buscar baseline do nicho (cache hit do analyze_thumbnail_visuals se disponível)
   - Chamar Claude Vision com 2 inputs (thumb do usuário + 3 thumbs baseline) + prompt comparativo
   - Output: score 0-100 + breakdown + top 3 ajustes
5. **Fallback sem API key:** se `getAnthropicClient() === null`, retornar mensagem amigável

## Validation Gates (Ralph Loop)
- [ ] `pnpm build` — 0 erros
- [ ] `pnpm test tests/integration/vision-end-to-end.test.ts` — 100%
- [ ] `pnpm lint` — 0 warnings
- [ ] 2ª chamada de `analyze_thumbnail_visuals` com mesmos params: 0 chamadas a Vision API (cache hit)
- [ ] Pre-flight prefix presente em 100% dos outputs
- [ ] Fallback sem ANTHROPIC_API_KEY retorna texto, não crash

## Tests
```bash
pnpm test tests/integration/vision-end-to-end.test.ts
# Casos:
# - should_call_vision_api_for_15_thumbs_in_first_request
# - should_skip_vision_api_on_cached_second_request
# - should_output_aggregated_niche_pattern_section
# - should_output_recommendation_text
# - should_accept_url_input_in_score_my_thumbnail
# - should_accept_base64_input_in_score_my_thumbnail
# - should_return_pre_flight_cost_estimate
# - should_fallback_gracefully_without_anthropic_key
# - should_skip_failed_thumbnail_url_404_and_continue
```

## Security considerations
- ✅ Reutiliza guards da task-006 (SSRF, EXIF, budget, rate limit)
- ✅ **RS-2.5:** Prompt FIXO importado de `vision-thumbnail.prompt.ts`
- ✅ Validação Zod ANTES de qualquer operação (input adversário rejeitado)
- ⚠️ Output do LLM precisa ser parseado com cuidado (validation: deve ter campos esperados; se vier markdown solto, rejeitar)

## Anti-stub contract
- ❌ Output da tool NÃO pode ter "Análise pendente" ou placeholders
- ❌ Cache deve ser REAL (DB SQLite), não mock em runtime
- ✅ Pelo menos 1 teste com fixture real de thumbnail (não imagem 1x1 dummy)

## Next task
- Camada 2 completa
- `task-011` (Reverse Engineering) — uses analyzeThumbnailVisuals
- `task-014` (Predictor) — uses scoreMyThumbnail
