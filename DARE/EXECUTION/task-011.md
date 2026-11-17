# task-011: NLP Tool — reverse_engineer_viral_video

## Objective
Ao final desta task, `reverse_engineer_viral_video` end-to-end em < 60s; output combina dados das 3 análises (comments + transcript + thumbnail) em hipótese unificada; teste de integração com vídeo viral conhecido retorna análise consistente.

## Description
Tool flagship da Camada 3 — combina TODAS as inteligências (Camadas 2 + 3) para fazer engenharia reversa de um vídeo viral. Resposta a: "por que esse vídeo viralizou?" + "como replicar no meu nicho?" + templates de roteiro/thumbnail inspirados. Diferencial competitivo único no mercado MCP YouTube.

## Dependencies
- `task-007` (analyze_thumbnail_visuals)
- `task-009` (analyze_video_comments)
- `task-010` (analyze_video_transcript)

## Complexity
MED

## Files to create / modify
- MODIFICAR `src/tools/nlp.tool.ts` — adicionar tool `reverse_engineer_viral_video`
- MODIFICAR `src/services/nlp.service.ts` — adicionar `reverseEngineer()`
- CRIAR `src/prompts/nlp-reverse-engineer.prompt.ts` — prompt FIXO unificado
- MODIFICAR `src/schemas/input.schemas.ts` — `ReverseEngineerViralVideoSchema`
- MODIFICAR `src/schemas/output.schemas.ts` — `NLPReverseEngineerOutputSchema`
- CRIAR `tests/integration/reverse-engineer.test.ts`

## Implementation steps
1. **ReverseEngineerViralVideoSchema:**
   ```typescript
   export const ReverseEngineerViralVideoSchema = z.object({
     videoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/),
     myNiche: z.string().min(2).max(120),
     regionCode: z.string().regex(/^[A-Z]{2}$/).default('BR'),
     includeThumbnail: z.boolean().default(true),
   });
   ```
2. **Orquestração paralela:**
   ```typescript
   export async function reverseEngineer(input: ReverseEngineerInput, tokenHash: string): Promise<string> {
     return withCache('reverse_engineer_viral_video', input, tokenHash, async () => {
       // Lançar 2 análises em paralelo (transcript depende de captions; comments sempre disponível)
       const [commentsAnalysis, transcriptAnalysis, thumbnailAnalysis] = await Promise.all([
         analyzeComments({ videoId: input.videoId, maxComments: 100 }, tokenHash),
         analyzeTranscript({ videoId: input.videoId, preferredLanguages: ['pt', 'pt-BR', 'en'] }, tokenHash),
         input.includeThumbnail ? analyzeThumbnailVisuals({ niche: input.myNiche, maxThumbs: 5 }, tokenHash) : Promise.resolve(null),
       ]);
       // Sonnet 4.6 com prompt único agregando os 3 outputs
       const prompt = REVERSE_ENGINEER_PROMPT
         .replace('{{COMMENTS_ANALYSIS}}', commentsAnalysis)
         .replace('{{TRANSCRIPT_ANALYSIS}}', transcriptAnalysis)
         .replace('{{THUMBNAIL_ANALYSIS}}', thumbnailAnalysis ?? '(thumbnail analysis skipped)')
         .replace('{{MY_NICHE}}', escapeForPrompt(input.myNiche));
       const response = await callClaudeText('claude-sonnet-4-6', prompt, tokenHash);
       const parsed = NLPReverseEngineerOutputSchema.parse(JSON.parse(extractJSON(response)));
       return renderReverseEngineerMarkdown(parsed);
     }, { ttlSeconds: 604800 }); // 7 dias
   }
   ```
3. **Output esperado (markdown):**
   - **Por que esse vídeo viralizou?** (3-5 fatores ranqueados com evidência)
   - **Como replicar no nicho "{myNiche}"** (adaptações concretas)
   - **Template de roteiro inspirado** (~300 palavras, customizável)
   - **Template de thumbnail inspirada** (descrição visual + paleta de cores)
4. **Custo estimado:** ~$0.04-0.08 (Haiku + Sonnet + Vision em paralelo). Avisar no pre-flight.

## Validation Gates (Ralph Loop)
- [ ] `pnpm build` — 0 erros
- [ ] `pnpm test tests/integration/reverse-engineer.test.ts` — 100%
- [ ] `pnpm lint` — 0 warnings
- [ ] End-to-end < 60s (benchmark com mocks)
- [ ] Output unificado tem TODAS as 4 seções (não pode faltar nenhuma)
- [ ] Cache 7d hit em 2ª chamada
- [ ] Se thumbnail falha (vídeo sem maxres): análise continua sem ela (não crash)

## Tests
```bash
pnpm test tests/integration/reverse-engineer.test.ts
# Casos:
# - should_run_three_analyses_in_parallel
# - should_combine_outputs_in_unified_markdown
# - should_skip_thumbnail_analysis_when_includeThumbnail_false
# - should_continue_if_transcript_unavailable
# - should_cache_for_7_days
# - should_estimate_combined_cost_in_pre_flight
# - integration: viral video YouTube ID retorna análise estruturada
```

## Security considerations
- ✅ Herda todas RS-3.X das tools chamadas (Camadas 2 + 3)
- ✅ **myNiche** passado por `escapeForPrompt` (similar a wrapComments) antes de interpolar no prompt
- ⚠️ Custo combinado é alto — pre-flight obrigatório

## Anti-stub contract
- ❌ Output NÃO pode conter "(análise pendente)" — todas 4 seções DEVEM estar preenchidas
- ❌ Se Sonnet retornar JSON inválido, lançar erro claro (não retornar vazio)
- ✅ Pelo menos 1 teste E2E com mocks coerentes (não dados aleatórios)

## Next task
- Camada 3 completa
- Desbloqueia: `task-015` (Workflows usam reverseEngineer)
- Em paralelo: `task-012` (Script generator usa este como input opcional)
