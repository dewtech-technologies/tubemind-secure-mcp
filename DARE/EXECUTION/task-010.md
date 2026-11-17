# task-010: NLP Tool — analyze_video_transcript

## Objective
Ao final desta task, `analyze_video_transcript` para vídeo 15min < 20s; custo ≤ $0.02 (Sonnet); cache 7d hit; fallback scrape testado para vídeo sem captions; output estruturado com timestamps.

## Description
Implementa engenharia reversa de transcrições de YouTube. Baixa captions oficiais (caro — 200 quota units), parseia SRT/VTT inline (sem dep), chama Claude Sonnet 4.6 (profundidade > custo aqui) para extrair estrutura completa do vídeo (hook + intro + payoff + CTAs com timestamps). Cache agressivo 7 dias.

## Dependencies
- `task-008` (sanitizer + schemas)

## Complexity
HIGH

## Files to create / modify
- MODIFICAR `src/services/nlp.service.ts` — adicionar `analyzeTranscript()`
- MODIFICAR `src/tools/nlp.tool.ts` — adicionar tool `analyze_video_transcript`
- CRIAR `src/prompts/nlp-transcript.prompt.ts` — prompt FIXO (Sonnet)
- MODIFICAR `src/services/youtube.service.ts` — adicionar `listCaptions(videoId)` e `downloadCaption(captionId, format)`
- CRIAR `src/utils/srt-parser.ts` — parser inline regex (SRT/VTT)
- MODIFICAR `src/schemas/output.schemas.ts` — `NLPTranscriptOutputSchema`
- MODIFICAR `src/schemas/input.schemas.ts` — `AnalyzeVideoTranscriptSchema`
- CRIAR `tests/integration/analyze-transcript.test.ts`
- CRIAR `tests/unit/srt-parser.test.ts`
- CRIAR `tests/fixtures/transcripts/` — 3 captions reais (.srt) de vídeos públicos

## Implementation steps
1. **AnalyzeVideoTranscriptSchema:**
   ```typescript
   export const AnalyzeVideoTranscriptSchema = z.object({
     videoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/),
     preferredLanguages: z.array(z.string()).default(['pt', 'pt-BR', 'en', 'es']),
     fresh: z.boolean().default(false),
   });
   ```
2. **listCaptions + downloadCaption:** wrappers de `client.captions.list({videoId})` e `client.captions.download({id, tfmt: 'srt'})`. Registrar 50u + 200u no quota log.
3. **srt-parser.ts:**
   ```typescript
   export interface SrtCue { startMs: number; endMs: number; text: string; }
   export function parseSRT(srt: string): SrtCue[] {
     const blocks = srt.split(/\n\n/).filter(b => b.trim());
     return blocks.map(block => {
       const lines = block.split('\n');
       const timeMatch = lines[1]?.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
       if (!timeMatch) return null;
       const startMs = toMs(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
       const endMs = toMs(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
       return { startMs, endMs, text: lines.slice(2).join(' ') };
     }).filter(Boolean);
   }
   ```
4. **analyzeTranscript handler:**
   - withCache TTL 7 dias
   - listCaptions → escolher caption em `preferredLanguages` (ordem) → downloadCaption
   - Se NENHUMA caption disponível: retornar mensagem "Transcrição não disponível para este vídeo"
   - parseSRT → texto consolidado (anotado com timestamps)
   - Se vídeo > 60min: truncar texto antes do prompt (context window Sonnet)
   - Sanitização leve (transcrição vem de criador, mas escape defensivo)
   - callClaudeText('claude-sonnet-4-6', prompt, tokenHash) — custo ~$0.015-0.02
   - Validar via `NLPTranscriptOutputSchema` (estrutura: hook/intro/sections/ctas com timestamps)
   - Renderizar markdown estruturado (BLUEPRINT seção 5.3)
5. **Fallback scrape (best effort — opt-in via env `TUBEMIND_TRANSCRIPT_SCRAPE_FALLBACK=true`):**
   - Tentar buscar HTML da página `https://www.youtube.com/watch?v=<id>`
   - Extrair `captionTracks` do JS embedded (best effort, frágil)
   - Marcar output: "⚠️ Análise baseada em fallback scrape — qualidade reduzida"

## Validation Gates (Ralph Loop)
- [ ] `pnpm build` — 0 erros
- [ ] `pnpm test tests/integration/analyze-transcript.test.ts` — 100%
- [ ] `pnpm test tests/unit/srt-parser.test.ts` — 100%
- [ ] `pnpm lint` — 0 warnings
- [ ] Vídeo 15min analisado em < 20s (mock Anthropic)
- [ ] Custo ≤ $0.02 estimado
- [ ] Cache 7d hit em 2ª chamada
- [ ] Vídeo sem captions retorna mensagem clara (não crash)
- [ ] Fallback scrape testado com mock HTTP

## Tests
```bash
pnpm test tests/integration/analyze-transcript.test.ts tests/unit/srt-parser.test.ts
# Casos:
# - should_parse_valid_srt_with_multiple_cues
# - should_handle_srt_with_comma_separator_milliseconds
# - should_handle_srt_with_dot_separator_milliseconds
# - should_select_caption_in_preferred_language_order
# - should_fallback_to_next_language_when_first_unavailable
# - should_return_friendly_message_when_no_captions_available
# - should_truncate_transcript_for_videos_over_60min
# - should_validate_llm_output_structure_via_schema
# - should_cache_for_7_days
# - fallback_scrape_marked_as_best_effort
```

## Security considerations
- ✅ **RS-3.1, RS-3.2:** Sanitização + prompt fixo (mesmo schema da task-008)
- ✅ **RS-3.6:** videoId regex
- ✅ **RS-3.7:** captions.download requer scope `youtube.force-ssl` — verificar via `client.oauth2Client.getAccessToken()` antes de chamar
- ✅ **RS-3.8:** Budget cap aplicado (Sonnet é caro)
- ⚠️ **Fallback scrape:** desabilitado por padrão (opt-in via env) — usuário ciente de fragilidade

## Anti-stub contract
- ❌ Parser SRT NÃO pode retornar `[]` silenciosamente em SRT inválido — lançar erro claro
- ❌ Tool NÃO pode chamar Sonnet com transcript vazia
- ✅ Pelo menos 1 teste integra com fixture SRT real

## Next task
- `task-011` (Reverse Engineering) — usa esta tool
