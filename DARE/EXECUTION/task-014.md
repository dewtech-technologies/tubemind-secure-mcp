# task-014: Pipeline Tool — predict_video_performance

## Objective
Ao final desta task, `predict_video_performance` < 30s com thumbnail; disclaimer "estimativa heurística" presente em 100% das saídas; teste anti-tampering bloqueia injeção de score; fórmula viral score documentada e justificada.

## Description
Tool de previsão de performance que combina TODOS os sinais (CTR potencial v0.1 + score thumb Camada 2 + retention signals + janela publicação) em um score viral 0-100. CRÍTICO: previsão é heurística (não ML real) — disclaimer obrigatório e não removível. Anti-tampering: scores nunca aceitos como input.

## Dependencies
- `task-007` (Vision Tools para score_my_thumbnail)
- `task-012` (Script Generator) — não é dependência direta mas tipicamente usado depois

## Complexity
MED

## Files to create / modify
- MODIFICAR `src/services/pipeline.service.ts` — adicionar `predictPerformance()`
- MODIFICAR `src/tools/pipeline.tool.ts` — adicionar tool `predict_video_performance`
- MODIFICAR `src/schemas/input.schemas.ts` — `PredictVideoPerformanceSchema`
- MODIFICAR `src/schemas/output.schemas.ts` — `PredictionOutputSchema` (disclaimer obrigatório)
- CRIAR `tests/integration/predict-performance.test.ts`
- CRIAR `tests/security/prediction-anti-tampering.test.ts`

## Implementation steps
1. **PredictVideoPerformanceSchema:**
   ```typescript
   export const PredictVideoPerformanceSchema = z.object({
     title: z.string().min(5).max(100),
     thumbnailUrl: z.string().url().optional(),
     niche: z.string().min(2).max(120),
     channelId: z.string().regex(/^UC[a-zA-Z0-9_-]{22}$/),
     publishDate: z.string().datetime().optional(),
     // NOTA: NENHUM campo `score`, `viralScore`, `prediction` — esses são CALCULADOS, nunca aceitos
   });
   ```
2. **predictPerformance handler (formula explicada):**
   ```typescript
   export async function predictPerformance(input: PredictionInput, tokenHash: string): Promise<string> {
     // 1. Baseline do canal
     const channelAnalytics = await getChannelAnalytics({ channelId: input.channelId, startDate: '...', endDate: '...' }, tokenHash);
     const baselineViews = channelAnalytics.avgViewsPerVideo; // últimos 90 dias
     // 2. CTR potencial do título (v0.1)
     const ctrAnalysis = await estimateCtrPotential({ titles: [input.title], niche: input.niche, regionCode: 'BR' }, tokenHash);
     const ctrScore = ctrAnalysis.scores[0]; // 0-100
     // 3. Thumbnail score (opcional)
     let thumbScore = 50; // default neutro se sem thumb
     if (input.thumbnailUrl) {
       const thumbAnalysis = await scoreMyThumbnail({ thumbnailInput: { kind: 'url', value: input.thumbnailUrl }, niche: input.niche }, tokenHash);
       thumbScore = thumbAnalysis.score;
     }
     // 4. Retention signals do nicho
     const retentionAnalysis = await analyzeRetentionSignals({ niche: input.niche, regionCode: 'BR', videoCount: 20, minViews: 10000 }, tokenHash);
     const retentionScore = retentionAnalysis.avgScore;
     // 5. Janela de publicação
     const publishWindow = await scoreBestPublishWindow({ channelId: input.channelId, days: 30 }, tokenHash);
     const timingScore = input.publishDate ? scoreTimingMatch(input.publishDate, publishWindow) : 50;
     // 6. Difficulty do nicho
     const difficulty = await estimateKeywordDifficulty({ keyword: input.niche, regionCode: 'BR', maxVideos: 10 }, tokenHash);
     const nicheDifficultyScore = 100 - difficulty.score; // invertido (mais fácil = melhor)
     // 7. FÓRMULA VIRAL SCORE (documentada)
     const viralScore = Math.round(
       ctrScore * 0.30 +
       thumbScore * 0.25 +
       retentionScore * 0.25 +
       timingScore * 0.10 +
       nicheDifficultyScore * 0.10
     );
     // 8. Views previstas (fórmula: baseline * (viralScore/50)^1.5)
     const viewsBase = baselineViews * Math.pow(viralScore / 50, 1.5);
     const views7d = { min: Math.round(viewsBase * 0.3), max: Math.round(viewsBase * 0.7) };
     const views30d = { min: Math.round(viewsBase * 0.7), max: Math.round(viewsBase * 1.5) };
     const views90d = { min: Math.round(viewsBase * 1.0), max: Math.round(viewsBase * 2.5) };
     // 9. Recomendação binária
     const recommendation = viralScore >= 70 ? '🟢 PRODUZIR' : viralScore >= 40 ? '🟡 AJUSTAR' : '🔴 ABANDONAR';
     // 10. Top 5 ajustes (gerar via heurística: identificar dimensão mais fraca + sugerir ação)
     const adjustments = generateAdjustments({ ctrScore, thumbScore, retentionScore, timingScore });
     // 11. RENDERIZAR MARKDOWN com DISCLAIMER OBRIGATÓRIO (validado no schema)
     return renderPredictionMarkdown({ viralScore, recommendation, views7d, views30d, views90d, breakdown: { ctr: ctrScore, thumb: thumbScore, retention: retentionScore, timing: timingScore, niche: nicheDifficultyScore }, adjustments });
   }
   ```
3. **PredictionOutputSchema:**
   ```typescript
   export const PredictionOutputSchema = z.object({
     // ... campos ...
   }).refine(
     (data) => data.markdown.includes('⚠️ Estimativa') && data.markdown.toLowerCase().includes('heurística'),
     { message: 'Disclaimer obrigatório ausente' }
   );
   ```

## Validation Gates (Ralph Loop)
- [ ] `pnpm build` — 0 erros
- [ ] `pnpm test tests/integration/predict-performance.test.ts` — 100%
- [ ] `pnpm test tests/security/prediction-anti-tampering.test.ts` — 100%
- [ ] `pnpm lint` — 0 warnings
- [ ] < 10s sem thumbnail; < 30s com thumbnail (medido)
- [ ] Disclaimer "⚠️ Estimativa heurística" em 100% das saídas (snapshot test)
- [ ] Anti-tampering: tentar passar `viralScore: 100` no input → Zod rejeita
- [ ] Fórmula documentada em comentário/doc

## Tests
```bash
pnpm test tests/integration/predict-performance.test.ts tests/security/prediction-anti-tampering.test.ts
# Casos:
# - should_calculate_viral_score_with_documented_formula
# - should_recommend_PRODUZIR_when_score_ge_70
# - should_recommend_AJUSTAR_when_score_40_to_69
# - should_recommend_ABANDONAR_when_score_lt_40
# - should_include_disclaimer_in_every_output
# - should_predict_views_for_7d_30d_90d_with_min_max_range
# - should_skip_thumbnail_score_when_url_not_provided
# - should_return_top_5_prioritized_adjustments
# - anti-tampering: reject_input_with_extra_score_field
# - anti-tampering: reject_input_with_extra_viralScore_field
```

## Security considerations
- ✅ **RS-4.1:** Zod com regex strict para channelId
- ✅ **RS-4.4:** Disclaimer validado no schema (não bypassável)
- ✅ **RS-4.5:** budgetGuard antes de invocar Vision (parte de scoreMyThumbnail)
- ✅ **RS-4.7:** channelId regex
- ✅ **RS-4.10:** Schema Zod com `.strict()` rejeita campos extras (scoreScores não permitidos como input)

## Anti-stub contract
- ❌ Fórmula viral score NÃO pode ser `return 50` ou random — DEVE ser calculada
- ❌ Views previstas NÃO podem ser hardcoded — DEVEM derivar da baseline do canal
- ❌ Disclaimer NÃO pode ser opcional ou config — sempre presente
- ✅ Testes anti-tampering DEVEM cobrir todos campos sensíveis

## Next task
- `task-015` (Workflows) — workflow predict_video usa este
