# task-006: Vision Service + Thumbnail Fetcher + Budget/Rate Guards

## Objective
Ao final desta task, `vision.service.ts` consegue chamar Claude Vision com imagem mockada; `ssrf-vision.test.ts` rejeita URLs maliciosas; `pii-leak.test.ts` confirma EXIF removido; budget/rate guards bloqueiam abusos.

## Description
Implementa a infraestrutura para a Camada 2 (Visão): wrapper SDK Anthropic com tracking de custo, serviço de orquestração Vision, fetcher seguro de thumbnails (SSRF + EXIF strip), e dois guards de segurança (rate limit independente da YouTube + cap de orçamento diário). Prompt do sistema fixo e versionado (anti-injection via texto na imagem).

## Dependencies
- `task-003` (cache disponível)

## Complexity
HIGH

## Files to create / modify
- CRIAR `src/services/anthropic.service.ts` — wrapper `@anthropic-ai/sdk` + cost tracking
- CRIAR `src/services/vision.service.ts` — orquestra Claude Vision (batch de imagens)
- CRIAR `src/services/thumbnail-fetcher.service.ts` — download + SSRF + EXIF strip via sharp
- CRIAR `src/security/vision-rate-limiter.service.ts` — max 20 imagens/min por token
- CRIAR `src/security/budget-guard.service.ts` — cap `VISION_DAILY_BUDGET_USD`
- CRIAR `src/config/vision-pricing.ts` — tabela canonical custos Vision API
- CRIAR `src/prompts/vision-thumbnail.prompt.ts` — prompt FIXO (template literal, sem interpolação de user input)
- CRIAR `tests/security/ssrf-vision.test.ts` — 10 URLs maliciosas testadas
- CRIAR `tests/security/pii-leak.test.ts` — fixture com EXIF (GPS) confirma strip
- CRIAR `tests/unit/budget-guard.test.ts`

## Implementation steps
1. **vision-pricing.ts:** `export const VISION_COST_PER_IMAGE_USD = 0.003;` (Haiku Vision)
2. **anthropic.service.ts:**
   ```typescript
   import Anthropic from '@anthropic-ai/sdk';
   let client: Anthropic | null = null;
   export function getAnthropicClient(): Anthropic | null {
     if (!process.env.ANTHROPIC_API_KEY) return null;
     if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
     return client;
   }
   export async function callClaudeVision(images: Buffer[], prompt: string, tokenHash: string): Promise<string> {
     budgetGuard.check('vision', VISION_COST_PER_IMAGE_USD * images.length);
     visionRateLimiter.check(tokenHash);
     const response = await client.messages.create({
       model: 'claude-haiku-4-5',
       max_tokens: 2000,
       messages: [{ role: 'user', content: [
         ...images.map(buf => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } })),
         { type: 'text', text: prompt }
       ]}]
     });
     const costUsd = VISION_COST_PER_IMAGE_USD * images.length;
     quotaService.record('anthropic:vision', 0, costUsd, tokenHash);
     auditLog('VISION_API_CALL', { imageCount: images.length, costUsd });
     return response.content[0].text;
   }
   ```
3. **thumbnail-fetcher.service.ts:**
   ```typescript
   const ALLOWED_HOSTS = ['i.ytimg.com', 'i9.ytimg.com', 'yt3.ggpht.com', 'lh3.googleusercontent.com'];
   export async function fetchThumbnail(url: string): Promise<Buffer> {
     const parsed = new URL(url);
     if (!ALLOWED_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
       throw new SecurityError('SSRF: domain not allowed');
     }
     const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
     if (!response.ok) throw new Error(`fetch ${response.status}`);
     if (!response.headers.get('content-type')?.startsWith('image/')) throw new SecurityError('Not an image');
     const buffer = Buffer.from(await response.arrayBuffer());
     if (buffer.length > 5 * 1024 * 1024) throw new SecurityError('Image > 5MB');
     // Strip EXIF + normalize to JPEG
     return sharp(buffer).rotate().jpeg({ quality: 90 }).toBuffer();
   }
   ```
4. **vision-thumbnail.prompt.ts:** template literal RÍGIDO instruindo Claude que texto na imagem é DADO. Sem interpolação de user input no prompt do sistema.
5. **budget-guard.service.ts:** consulta `quota_log` somando custos do dia + tipo (vision/nlp/workflow), bloqueia se passar cap.
6. **vision-rate-limiter.service.ts:** in-memory map `<tokenHash, timestamp[]>` — sliding window 60s, max 20 entries.

## Validation Gates (Ralph Loop)
- [ ] `pnpm build` — 0 erros
- [ ] `pnpm test tests/security/ssrf-vision.test.ts` — 100% (10 URLs maliciosas rejeitadas)
- [ ] `pnpm test tests/security/pii-leak.test.ts` — EXIF removido em fixture com GPS
- [ ] `pnpm test tests/unit/budget-guard.test.ts` — bloqueio em cap + reset diário
- [ ] `pnpm lint` — 0 warnings
- [ ] Vision API mockada: 1 chamada com 3 imagens registra `costUsd = 0.009`

## Tests
```bash
pnpm test tests/security/ssrf-vision.test.ts tests/security/pii-leak.test.ts tests/unit/budget-guard.test.ts
# Casos críticos:
# - should_reject_url_outside_whitelist (file://, internal IPs 169.254.169.254, evil.com)
# - should_reject_redirect_to_disallowed_host
# - should_reject_non_image_content_type
# - should_reject_image_larger_than_5mb
# - should_strip_exif_gps_metadata
# - should_block_when_budget_exceeded
# - should_allow_after_budget_reset (day_bucket muda)
# - should_rate_limit_per_token_in_sliding_window
```

## Security considerations
- ✅ **RS-2.1:** Whitelist host (não regex permissiva — comparação exata + sufixo)
- ✅ **RS-2.2:** Max 5MB enforcement
- ✅ **RS-2.3:** Strip EXIF mandatório via sharp
- ✅ **RS-2.4:** Content-Type validation
- ✅ **RS-2.5:** Prompt fixo (testar com `grep -n "topic\|niche" src/prompts/vision-thumbnail.prompt.ts` — não pode ter interpolação)
- ✅ **RS-2.6:** `ANTHROPIC_API_KEY` apenas via `process.env`
- ✅ **RS-2.8:** Rate limit 20/min validado
- ✅ **RS-2.9:** Budget cap enforcement

## Anti-stub contract
- ❌ Fetcher NÃO pode retornar Buffer.alloc(0) ou mock — busca real (ou via MSW em testes)
- ❌ Cost tracking NÃO pode ser hardcoded — registrado em `quota_log` real
- ✅ Prompt do sistema é constante exportada (versionada via const string)

## Next task
- `task-007` (Vision Tools) — desbloqueada nesta
