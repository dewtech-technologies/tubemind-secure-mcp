# Security Posture — tubemind-secure-mcp v0.2

> **Distribuição:** MCP stdio via `npx tubemind-secure-mcp` + Smithery. Sem container, sem servidor HTTP exposto a usuário final.
> **Auth:** OAuth2 com Google (YouTube Data API + Analytics API).
> **LLM externos:** Claude Vision/Haiku/Sonnet via `@anthropic-ai/sdk` (opcional — só ativa Camadas 2/3/4 se `ANTHROPIC_API_KEY` setada).

---

## OWASP Top 10 (Web)

### A01 — Broken Access Control
- **RS-1.3** Cache isolado por SHA-256 hash do OAuth token (sem leak entre usuários) → `src/services/cache.service.ts`
- **RS-3.7** Verifica scope OAuth `youtube.force-ssl` antes de `captions.download` → `src/services/youtube.service.ts`

### A02 — Cryptographic Failures
- **RS-1.2** Token OAuth SHA-256 hashado para uso como chave de cache (jamais armazenado plain) → `src/utils/hash.ts`
- **RS-1.7** Arquivo SQLite com `chmod 600` em Unix; ACL restrita em Windows → `src/cache/migrations.service.ts`
- **RS-2.3** Strip EXIF de imagens antes de upload ao Anthropic (anti-leak GPS/device) → `src/services/thumbnail-fetcher.service.ts`
- **RS-3.4** Comentários brutos NUNCA persistidos — apenas resultado da análise → `src/services/nlp.service.ts`
- **RS-3.5** PII (email/telefone-BR/CPF/CNPJ/CEP) redacted antes do LLM → `src/security/pii-filter.service.ts`

### A03 — Injection
- **RS-1.1** Inputs validados via Zod antes de qualquer SQL; prepared statements `better-sqlite3` → `src/services/cache.service.ts`, `src/services/quota.service.ts`
- **RS-1.5** Path SQLite valida `..` (anti path traversal) → `src/cache/migrations.service.ts:assertSafePath`
- **RS-2.4** Content-Type validation (image/*) em thumbnail downloads → `src/services/thumbnail-fetcher.service.ts`
- **RS-3.6** `videoId` regex `/^[a-zA-Z0-9_-]{11}$/` em todas as tools NLP → `src/tools/nlp.tool.ts`
- **RS-4.7** `channelId` regex `/^UC[a-zA-Z0-9_-]{22}$/` → `src/tools/pipeline.tool.ts`

### A04 — Insecure Design
- **RS-1.8** SQLite WAL mode + synchronous NORMAL + auto_vacuum INCREMENTAL (anti-corrupção) → `src/cache/migrations.service.ts`
- **RS-2.2** Limite de 5MB por imagem (anti-DoS) → `src/services/thumbnail-fetcher.service.ts`
- **RS-2.8** Rate limit Vision API: max 20 imagens/min por OAuth token → `src/security/vision-rate-limiter.service.ts`
- **RS-2.9** Cap diário `VISION_DAILY_BUDGET_USD` bloqueia ao atingir → `src/security/budget-guard.service.ts`
- **RS-3.8** Cap diário `NLP_DAILY_BUDGET_USD` → mesma source
- **RS-4.4** Disclaimer obrigatório em `predict_video_performance` (não bypassável) → `src/services/pipeline.service.ts`
- **RS-4.5** Cap diário `WORKFLOW_DAILY_BUDGET_USD` → budget-guard.service
- **RS-4.10** Schema Zod `.strict()` em `predict_video_performance` rejeita injeção de scores → `src/tools/pipeline.tool.ts`

### A05 — Security Misconfiguration
- **RS-2.6** `ANTHROPIC_API_KEY` apenas via `process.env` (nunca em código) → `.env.example` documenta, `src/services/anthropic.service.ts` lê
- `.env.example` ships sem secrets reais (apenas placeholders vazios)

### A06 — Vulnerable Components
- **RS-1.4** `better-sqlite3` auditado (0 CVE HIGH/CRITICAL) → GitHub Action `.github/workflows/security.yml`
- **RS-2.7** `@anthropic-ai/sdk` auditado → mesma Action
- **RS-3.9** Mesmo
- **RS-4.8** Mesmo
- Versões fixadas (sem ranges `^` ou `~`) em `package.json`
- Override `fast-uri >=3.1.2` resolveu CVE GHSA-v39h-62p7-jpjc (transitive)

### A09 — Logging & Monitoring Failures
- **RS-1.6** Audit log de operações sensíveis (CACHE_EVICT, QUOTA_THRESHOLD_70/90) → `src/security/audit.service.ts`
- **RS-4.9** Audit log de cada step de workflow com timing → `src/tools/pipeline.tool.ts`
- Log path configurável via env `AUDIT_LOG_PATH`; sem PII no log

### A10 — SSRF
- **RS-2.1** Whitelist de hosts para download de thumbnails (`*.ytimg.com`, `*.googleusercontent.com`, etc.) → `src/security/ssrf-guard.service.ts`
- Bloqueio explícito de IPs privados (10.x, 172.16.x, 192.168.x, 169.254.x, localhost)

---

## OWASP LLM Top 10

### LLM01 — Prompt Injection
- **RS-2.5** Prompt Vision FIXO; input do usuário (niche) sempre wrapped em `<niche>...</niche>` com escape de `<>&` → `src/prompts/vision-thumbnail.prompt.ts`
- **RS-3.1** Comentários SEMPRE encapsulados em `<comment idx="N" id="...">...</comment>` com escape + truncamento → `src/security/prompt-sanitizer.service.ts:wrapComments`
- **RS-3.2** Prompts NLP FIXOS (constants exportadas), versionados em código → `src/prompts/nlp-*.prompt.ts`
- **RS-3.10** Red team CI: 20 fixtures adversariais executadas em cada PR (20/20 devem ser neutralizadas) → `tests/security/red-team-prompt-injection.test.ts`
- **RS-4.2** Prompts Pipeline FIXOS; topic/niche/audience wrapped → `src/prompts/pipeline-*.prompt.ts`

### LLM02 — Insecure Output Handling
- **RS-3.3** Validação Zod do output LLM com `.refine(hasLeakageMarkers)` rejeita respostas com markers de prompt vazado → `src/schemas/output.schemas.ts`
- **RS-4.3** Output do LLM nunca interpretado como código — apenas renderizado em markdown

---

## Compliance & Audit

- **GDPR/LGPD:** comentários (que podem conter PII) NÃO são persistidos. Apenas análise resultante (sem PII após filtro).
- **Anthropic Usage Policies:** prompts FIXOS impedem geração de conteúdo proibido; falhas Anthropic são capturadas e retornadas como erro amigável.
- **YouTube API ToS:** rate limit interno + quota tracker respeita limites; OAuth tokens nunca compartilhados entre instâncias.

---

## Reportar Vulnerabilidades

Encontrou uma vulnerabilidade? **NÃO abra uma issue pública.**

📧 Email: **wleandro.oliveira@gmail.com** — resposta em até 72h.

Inclua:
- Descrição da vulnerabilidade
- Passos para reproduzir
- Impacto estimado
- Versão afetada (`tubemind-secure-mcp@X.Y.Z`)

Disclosure responsável: 90 dias após o patch ser liberado.
