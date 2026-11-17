# task-013: Pipeline Tool — optimize_video_description

## Objective
Ao final desta task, `optimize_video_description` < 15s; densidade keyword ≤ 3% validada; disclaimer regulado detectado em snapshots financeiro/médico/jurídico; capítulos gerados se transcript fornecido.

## Description
Tool de SEO para descrições de vídeo. Gera descrição com primeira frase contendo keyword principal (natural, não stuffing), 150-200 palavras, capítulos automáticos (se transcript), CTAs estruturados, 3-5 hashtags sweet spot, UTM tracking sugerido, e disclaimer obrigatório para nichos regulados (financeiro/médico/jurídico).

## Dependencies
- `task-008` (sanitizer)

## Complexity
MED

## Files to create / modify
- MODIFICAR `src/services/pipeline.service.ts` — adicionar `optimizeDescription()`
- MODIFICAR `src/tools/pipeline.tool.ts` — adicionar tool `optimize_video_description`
- CRIAR `src/prompts/pipeline-description.prompt.ts` — prompt FIXO Haiku
- CRIAR `src/services/regulated-niche-detector.service.ts` — detecta nicho via keywords
- MODIFICAR `src/schemas/input.schemas.ts` — `OptimizeVideoDescriptionSchema`
- MODIFICAR `src/schemas/output.schemas.ts` — `DescriptionOutputSchema` com validações
- CRIAR `tests/integration/optimize-description.test.ts`

## Implementation steps
1. **OptimizeVideoDescriptionSchema:**
   ```typescript
   export const OptimizeVideoDescriptionSchema = z.object({
     title: z.string().min(5).max(100),
     tags: z.array(z.string()).min(1).max(30),
     transcript: z.string().max(50000).optional(),
     timestamps: z.array(z.object({
       time: z.string().regex(/^\d{1,2}:\d{2}$/),
       label: z.string(),
     })).optional(),
   });
   ```
2. **regulated-niche-detector.service.ts:**
   ```typescript
   const REGULATED_NICHES = {
     financeiro: ['investimento', 'ação', 'trading', 'cripto', 'bolsa', 'forex', 'b3', 'criptomoeda'],
     medico: ['saúde', 'remédio', 'diagnóstico', 'tratamento', 'doença', 'cura', 'sintoma', 'medicamento'],
     juridico: ['jurídico', 'lei', 'processo', 'advogado', 'tribunal', 'contrato', 'ação judicial'],
   };
   export function detectRegulatedNiche(text: string): string | null {
     const lower = text.toLowerCase();
     for (const [niche, keywords] of Object.entries(REGULATED_NICHES)) {
       if (keywords.some(kw => lower.includes(kw))) return niche;
     }
     return null;
   }
   export const DISCLAIMERS = {
     financeiro: '⚠️ Este conteúdo é educativo e não constitui recomendação de investimento. Investimentos envolvem riscos. Consulte um profissional certificado.',
     medico: '⚠️ Este conteúdo é informativo e não substitui consulta médica. Procure um profissional de saúde para qualquer condição.',
     juridico: '⚠️ Este conteúdo é informativo e não constitui aconselhamento jurídico. Consulte um advogado para seu caso específico.',
   };
   ```
3. **optimizeDescription handler:**
   - Detectar nicho regulado em `title + tags`
   - Chamar Claude Haiku 4.5 com prompt FIXO contendo (escapados): title, tags, primeiras 2000 chars do transcript
   - Validar output via `DescriptionOutputSchema`:
     - Word count 150-200
     - Primeira frase contém keyword principal (extraída do title)
     - Densidade de cada keyword principal ≤ 3% no texto
     - 3-5 hashtags
   - Gerar capítulos se transcript fornecido (estrutura: `00:00 - Intro\n02:15 - Tópico X`)
   - Se nicho regulado: prepend disclaimer apropriado
   - Render markdown final + UTM template

## Validation Gates (Ralph Loop)
- [ ] `pnpm build` — 0 erros
- [ ] `pnpm test tests/integration/optimize-description.test.ts` — 100%
- [ ] `pnpm lint` — 0 warnings
- [ ] < 15s (mock Anthropic)
- [ ] Densidade keyword ≤ 3% verificada em todos snapshots
- [ ] Disclaimer financeiro presente em snapshot com title "Como investir em ações"
- [ ] Disclaimer médico presente em snapshot com title "Tratamento natural para diabetes"
- [ ] Disclaimer jurídico presente em snapshot com title "Como entrar com ação trabalhista"
- [ ] Capítulos gerados quando transcript fornecido

## Tests
```bash
pnpm test tests/integration/optimize-description.test.ts
# Casos:
# - should_generate_description_between_150_and_200_words
# - should_include_main_keyword_in_first_sentence
# - should_keep_keyword_density_below_3pct
# - should_generate_3_to_5_hashtags
# - should_generate_chapters_when_transcript_provided
# - should_detect_financial_niche_and_prepend_disclaimer
# - should_detect_medical_niche_and_prepend_disclaimer
# - should_detect_juridical_niche_and_prepend_disclaimer
# - should_not_add_disclaimer_for_non_regulated_niche
# - should_include_utm_tracking_template
```

## Security considerations
- ✅ **RS-4.1:** Zod com max lengths (title 100, tags 30, transcript 50k)
- ✅ **RS-4.2:** Prompt FIXO; inputs interpolados via escapeForPrompt
- ✅ **RS-4.3:** Markdown render (não eval)
- ✅ **RS-4.6:** Detector regulado obrigatório + disclaimer não pode ser removido (validação final)
- ⚠️ **R-4.10 (mitigação):** Templates de disclaimer devem ser revisados periodicamente por jurídico

## Anti-stub contract
- ❌ Descrição NÃO pode ter "[escreva sua descrição aqui]"
- ❌ Capítulos NÃO podem ser stub `00:00 - Capítulo 1` — devem refletir transcrição real
- ❌ Detector regulado NÃO pode ser bypassado (testes verificam)

## Next task
- `task-015` (Workflows) — workflow weekly_planning usa esta
- Em paralelo: `task-014` (Predictor)
