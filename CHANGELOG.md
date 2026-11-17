# Changelog

All notable changes to **tubemind-secure-mcp** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0] - 2026-05-24

### Added

#### Camada 1 — Infraestrutura
- **Cache SQLite local** com TTL configurável por tool (`src/services/cache.service.ts`). Reduz consumo da YouTube API em 80-90% em uso normal.
- **Batch optimization**: nova função `getVideosByIdsBatched` que envia até 50 IDs em uma única chamada `videos.list` (em vez de 50 chamadas separadas). 7 ocorrências refatoradas nos tools v0.1.
- **Quota Tracker persistente** em `quota_log` SQLite com warnings em 70%/90% do limite diário.
- Nova tool `get_quota_usage` (period: today/week/month) — relatório markdown com totais + breakdown por tool/endpoint.

#### Camada 2 — Visão Computacional (Claude Vision)
- Nova tool `analyze_thumbnail_visuals` — análise visual de N thumbnails do nicho: cores dominantes (HSL), face/expressão, OCR de texto, padrão dominante, contraste mobile, score de clicabilidade.
- Nova tool `score_my_thumbnail` — compara uma thumbnail candidata (URL ou base64) contra o padrão do nicho. Retorna score, alinhamento % e top 3 ajustes.

#### Camada 3 — NLP (Claude Haiku + Sonnet)
- Nova tool `analyze_video_comments` — sentiment, top 10 dores, top 10 perguntas, pedidos de tema, 5 ideias de próximos vídeos, comentários âncora.
- Nova tool `analyze_video_transcript` — engenharia reversa via captions (SRT/VTT): estrutura completa, tipo de hook, CTAs com timestamps, técnicas de retenção.
- Nova tool `reverse_engineer_viral_video` — combina comentários + transcript + thumbnail em relatório markdown unificado de POR QUE viralizou + como replicar no seu nicho + templates.

#### Camada 4 — Pipeline de Produção
- Nova tool `generate_full_script` — roteiro completo (3 hooks com 1 recomendado, intro, 3-5 seções com b-rolls, 2 CTAs, fechamento + call-back, sugestão próximo vídeo). Usa contexto REAL do nicho (retention + title patterns).
- Nova tool `optimize_video_description` — descrição SEO-otimizada com primeira frase com keyword principal, 150-200 palavras, capítulos automáticos (se transcript), 3-5 hashtags. Detector de nicho regulado (financeiro/médico/jurídico) adiciona disclaimer apropriado.
- Nova tool `predict_video_performance` — score viral 0-100 combinando CTR + thumbnail + retention + timing + dificuldade do nicho. Recomendação 🟢/🟡/🔴 + previsão de views 7d/30d/90d com faixa. Disclaimer obrigatório de heurística (não ML).
- Nova tool `run_workflow` — 4 workflows pré-construídos: `launch_new_channel` ($0.50), `revive_dead_channel` ($0.20), `weekly_planning` ($0.05), `competitor_takedown` ($0.30).

#### Segurança
- **Red team CI** com 20 fixtures de prompt injection adversariais — todas neutralizadas via wrapper XML + escape (`src/security/prompt-sanitizer.service.ts`).
- **PII filter** (email/telefone-BR/CPF/CNPJ/CEP) aplicado antes de enviar comentários ao LLM (`src/security/pii-filter.service.ts`).
- **Budget caps** configuráveis: `VISION_DAILY_BUDGET_USD` (default $5), `NLP_DAILY_BUDGET_USD` (default $10), `WORKFLOW_DAILY_BUDGET_USD` (default $20).
- **Vision rate limiter** dedicado: max 20 imagens/min por OAuth token (sliding window).
- **Output schemas** com `.refine(hasLeakageMarkers)` — defense-in-depth contra prompt injection bem-sucedida.

#### DARE Method
- Projeto desenvolvido seguindo [DARE Method v2.17](https://github.com/dewtech-technologies/dare-method). Artefatos completos em `DARE/`:
  - `DARE/DESIGN.md` — 88 RFs, 39 RNFs, 37 RSs aprovados
  - `DARE/BLUEPRINT.md` — 12 decisões arquiteturais + contratos anti-stub
  - `DARE/dare-dag.yaml` — DAG validado (17 tasks)
  - `DARE/EXECUTION/task-{001..017}.md` — specs executáveis

### Changed
- Refactor de 7 ocorrências de `Promise.all(ids.map(getVideoById))` → `getVideosByIdsBatched` em `heuristic.tool.ts`, `heuristic-advanced.tool.ts`, `search.tool.ts`.
- Audit log expandido com 16 novas tags: `CACHE_*`, `QUOTA_*`, `VISION_*`, `NLP_*`, `WORKFLOW_*`.
- Boot do MCP loga versão + cache status + LLM status em stderr (stdout reservado pro protocolo MCP).
- ESLint atualizado para flat config (v9) — `eslint.config.js`.

### Security
- Versões fixadas em `package.json` (sem ranges `^` ou `~`): `better-sqlite3@11.5.0`, `@anthropic-ai/sdk@0.32.1`, `sharp@0.33.5`.
- Override `pnpm.overrides.fast-uri >=3.1.2` resolveu CVE HIGH GHSA-v39h-62p7-jpjc (transitive via `ajv → @modelcontextprotocol/sdk`).
- 37 controles de segurança (OWASP Top 10 + LLM Top 10) mapeados em `SECURITY.md`.
- GitHub Action `.github/workflows/security.yml`: audit + gitleaks + red team em cada PR.

### Dependencies
- Added: `better-sqlite3@11.5.0`, `@anthropic-ai/sdk@0.32.1`, `sharp@0.33.5`
- Added (dev): `@types/better-sqlite3@7.6.11`

### Distribution
- Sem Docker Hub. Tubemind é MCP **stdio** distribuído via `npm` + Smithery. Usuários rodam `npx tubemind-secure-mcp` em Claude Desktop / Cursor / Antigravity / outros MCP clients.

---

## [0.1.3] - 2026-XX-XX (anterior)
- 18 tools de search, video, analytics, benchmark, heuristics, competitor research.
- OAuth2 + AES-256-GCM token encryption.
- OWASP Top 10 controles iniciais.
