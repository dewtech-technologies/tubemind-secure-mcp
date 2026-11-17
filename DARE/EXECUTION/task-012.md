# task-012: Pipeline Tool — generate_full_script

## Objective
Ao final desta task, `generate_full_script` retorna roteiro completo estruturado em < 30s; validação de qualidade rejeita roteiros genéricos (busca por strings específicas do nicho); 100% dos outputs têm 5+ seções (Hook, Intro, Corpo 3-5, CTAs, Outro).

## Description
Primeira tool da Camada 4 (Pipeline). Gera roteiros completos para vídeos YouTube usando dados REAIS do nicho (cruza Camadas 1-3): retention patterns, title patterns, e opcionalmente engenharia reversa de um competidor. Usa Sonnet 4.6 com prompt único (não chunked para garantir consistência de tom).

## Dependencies
- `task-005` (quota tracker — budget cap)
- `task-008` (sanitizer + schemas)

## Complexity
HIGH

## Files to create / modify
- CRIAR `src/services/pipeline.service.ts` — parte `generateScript()`
- CRIAR `src/tools/pipeline.tool.ts` — adicionar tool `generate_full_script`
- CRIAR `src/prompts/pipeline-script.prompt.ts` — prompt FIXO Sonnet
- MODIFICAR `src/schemas/input.schemas.ts` — `GenerateFullScriptSchema`
- MODIFICAR `src/schemas/output.schemas.ts` — `ScriptOutputSchema` (5+ seções obrigatórias)
- MODIFICAR `src/index.ts` — registrar tool
- CRIAR `tests/integration/generate-script.test.ts`

## Implementation steps
1. **GenerateFullScriptSchema:**
   ```typescript
   export const GenerateFullScriptSchema = z.object({
     topic: z.string().min(3).max(200),
     niche: z.string().min(2).max(120),
     durationMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]),
     tone: z.enum(['educativo', 'descontraido', 'provocativo', 'tecnico']),
     audience: z.string().min(2).max(200).optional(),
     competitorVideoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/).optional(),
   });
   ```
2. **generateScript handler:**
   ```typescript
   // SEM cache (input sempre único — topic, niche, tone, audience)
   export async function generateScript(input: ScriptInput, tokenHash: string): Promise<string> {
     budgetGuard.check('workflow', 0.02); // pre-flight Sonnet cost
     // 1. Buscar contexto cached do nicho
     const retentionSignals = await analyzeRetentionSignals({ niche: input.niche, regionCode: 'BR', videoCount: 20, minViews: 10000 }, tokenHash);
     const titlePatterns = await analyzeTitlePatterns({ niche: input.niche, regionCode: 'BR', videoCount: 30 }, tokenHash);
     // 2. Engenharia reversa opcional
     let competitorReverse = '';
     if (input.competitorVideoId) {
       competitorReverse = await reverseEngineer({ videoId: input.competitorVideoId, myNiche: input.niche, includeThumbnail: false }, tokenHash);
     }
     // 3. Prompt ÚNICO (não chunked) com todos os dados
     const prompt = SCRIPT_PROMPT
       .replace('{{TOPIC}}', escapeForPrompt(input.topic))
       .replace('{{NICHE}}', escapeForPrompt(input.niche))
       .replace('{{DURATION}}', String(input.durationMinutes))
       .replace('{{TONE}}', input.tone)
       .replace('{{AUDIENCE}}', escapeForPrompt(input.audience ?? 'criadores YouTube'))
       .replace('{{RETENTION_SIGNALS}}', retentionSignals)
       .replace('{{TITLE_PATTERNS}}', titlePatterns)
       .replace('{{COMPETITOR_REVERSE}}', competitorReverse || '(não fornecido)');
     // 4. Sonnet 4.6
     const response = await callClaudeText('claude-sonnet-4-6', prompt, tokenHash);
     // 5. Validar via schema (5+ seções)
     const parsed = ScriptOutputSchema.parse(JSON.parse(extractJSON(response)));
     // 6. Validar qualidade: roteiro DEVE referenciar ≥3 dados específicos do nicho
     const nicheKeywords = extractKeywords(input.niche);
     const mentions = nicheKeywords.filter(kw => parsed.fullScript.toLowerCase().includes(kw.toLowerCase()));
     if (mentions.length < 3) throw new QualityError('Roteiro genérico — não referencia o nicho');
     // 7. Render markdown estruturado
     return renderScriptMarkdown(parsed);
   }
   ```
3. **Estrutura do output markdown:**
   - `### 🎬 Hook (0-15s) — 3 opções` (badge ⭐ na recomendada)
   - `### 🎯 Intro / Promessa (15-45s)` (50-80 palavras)
   - `### 📚 Corpo` — 3-5 seções com `### XX:XX — [Nome da seção]`, pontos principais, B-roll: [descrição], `[CUT]` em jump cuts
   - `### 🔔 CTA 1 (~25% do vídeo)` e `### 🔔 CTA 2 (~75%)`
   - `### 🔁 Fechamento do loop (call-back ao hook)`
   - `### 🚪 Outro + Próximo vídeo`
4. **Pattern interrupts:** marcar em pontos onde retentionSignals indica queda (ex: minuto 5 em vídeos de 15min — comum)

## Validation Gates (Ralph Loop)
- [ ] `pnpm build` — 0 erros
- [ ] `pnpm test tests/integration/generate-script.test.ts` — 100%
- [ ] `pnpm lint` — 0 warnings
- [ ] < 30s (benchmark com mock Anthropic)
- [ ] 100% dos outputs têm 5+ seções (validado pelo schema)
- [ ] Roteiro genérico (input cuidadosamente preparado p/ não ter dados de nicho) é rejeitado com QualityError
- [ ] Custo ~$0.02 estimado (1 call Sonnet)
- [ ] Sem cache (validar com 2 chamadas idênticas que ambas chamam o LLM)

## Tests
```bash
pnpm test tests/integration/generate-script.test.ts
# Casos:
# - should_call_dependencies_in_correct_order (retention + title before LLM)
# - should_include_competitor_reverse_when_id_provided
# - should_skip_competitor_reverse_when_id_omitted
# - should_validate_script_has_5_or_more_sections
# - should_reject_script_with_less_than_3_niche_keyword_mentions
# - should_not_cache_results (input sempre único)
# - should_generate_3_hooks_with_one_starred
# - should_distribute_ctas_at_25pct_and_75pct
```

## Security considerations
- ✅ **RS-4.1:** Zod com enum strict (tone, duration)
- ✅ **RS-4.2:** Prompt fixo com `escapeForPrompt` em todos inputs interpolados
- ✅ **RS-4.3:** Output do LLM nunca interpretado como código (string markdown render)
- ✅ **RS-4.5:** budgetGuard.check antes de chamar Sonnet
- ⚠️ **R-4.1 (mitigação):** validador de qualidade rejeita genérico (≥ 3 niche keywords)

## Anti-stub contract
- ❌ Output NÃO pode ter "[descrição do hook]" ou placeholders genéricos
- ❌ Schema ScriptOutputSchema NÃO pode aceitar `sections.length === 0`
- ✅ Validador de qualidade DEVE ser invocado (não comentado para "facilitar testes")

## Next task
- `task-014` (Predictor) — combina script + thumbnail
- `task-015` (Workflows) — orquestra
