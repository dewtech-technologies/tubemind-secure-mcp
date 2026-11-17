# task-017: README + audit log estruturado + changelog v0.2.0

## Objective
Ao final desta task, README v0.2 documenta as 28 tools (10 novas + 18 v0.1) com custos e setup; CHANGELOG.md tem entrada v0.2.0 no formato Keep a Changelog; audit log com schema canonical documentado; demo end-to-end registrado.

## Description
Última task — finalização documental para release v0.2.0. Atualiza README com tabela completa de tools, instruções de setup das novas envs (Anthropic + caps), demo de cada Camada. Formaliza o formato do audit log (que já é estruturado, só documentar campos). Cria CHANGELOG.md com entrada detalhada. Atualiza smithery.yaml se necessário.

## Dependencies
- `task-016` (security audit completo, deps fixadas)

## Complexity
LOW

## Files to create / modify
- MODIFICAR `README.md` — adicionar seção "v0.2" com 10 tools novas + custos + setup envs
- CRIAR `CHANGELOG.md` — entrada v0.2.0 (Keep a Changelog format)
- CRIAR `docs/audit-log-schema.md` — documenta formato canonical do audit log
- MODIFICAR `smithery.yaml` — atualizar version + descrição se necessário
- CRIAR `docs/demo-v0.2.md` — passo a passo de cada workflow + screenshots de output markdown
- MODIFICAR `package.json` — bump version para `0.2.0`

## Implementation steps
1. **README.md (adicionar seções):**
   - Atualizar badge de versão
   - Atualizar contagem: "📦 28 tools" (era 18)
   - Nova seção "🆕 What's new in v0.2"
     - Cache SQLite (80-90% economia de quota)
     - Análise visual de thumbnails (Claude Vision)
     - NLP de comentários + transcrições
     - Pipeline completo (script + description + prediction + workflows)
   - Expandir tabela de tools (das 18 existentes adicionar as 10 novas com categoria)
   - Nova seção "💰 Custos das APIs externas" com tabela:
     | Camada | API | Custo estimado/análise |
     | Camada 2 | Claude Vision (Haiku) | ~$0.003 por imagem |
     | Camada 3 | Claude Haiku (comments) | ~$0.005 por análise |
     | Camada 3 | Claude Sonnet (transcript) | ~$0.02 por análise |
     | Camada 4 | Sonnet (script) | ~$0.02 por roteiro |
     | Camada 4 | Workflow launch_new_channel | ~$0.50 total |
   - Nova seção "⚙️ Setup Camada 2/3/4" — explica `ANTHROPIC_API_KEY` (opcional, ativa Vision/NLP/Pipeline)
   - Nova seção "🔒 Budget caps" — explica `VISION_DAILY_BUDGET_USD`, `NLP_DAILY_BUDGET_USD`, `WORKFLOW_DAILY_BUDGET_USD`
2. **CHANGELOG.md (Keep a Changelog):**
   ```markdown
   # Changelog
   All notable changes to this project will be documented in this file.
   The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
   and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
   
   ## [0.2.0] - 2026-XX-XX
   
   ### Added
   - **Camada 1 (Infra):** Cache SQLite local com TTL configurável por tool (80-90% economia quota YouTube API)
   - **Camada 1:** Batch optimization (`getVideosByIdsBatched`) — 50 IDs em 1 chamada API
   - **Camada 1:** Quota tracker persistente + tool `get_quota_usage`
   - **Camada 2 (Visão):** Tool `analyze_thumbnail_visuals` (Claude Vision API)
   - **Camada 2:** Tool `score_my_thumbnail` (URL ou base64)
   - **Camada 3 (NLP):** Tool `analyze_video_comments` (sentiment + dores + ideias)
   - **Camada 3:** Tool `analyze_video_transcript` (engenharia reversa de estrutura)
   - **Camada 3:** Tool `reverse_engineer_viral_video` (combina Camadas 2+3)
   - **Camada 4 (Pipeline):** Tool `generate_full_script` (roteiros completos)
   - **Camada 4:** Tool `optimize_video_description` (SEO + disclaimers regulados)
   - **Camada 4:** Tool `predict_video_performance` (heurística com disclaimer)
   - **Camada 4:** Tool `run_workflow` (4 workflows pré-construídos)
   - **Segurança:** Red team CI suite com 20 prompt injection adversariais
   - **Segurança:** PII filter (emails, telefones BR, CPF)
   - **Segurança:** Budget caps configuráveis (Vision/NLP/Workflow USD/dia)
   - **DARE Method:** projeto desenvolvido com DARE v2.17 — ver `DARE/` para artefatos
   
   ### Changed
   - Refactor de 6 tools v0.1 para usar batch optimization (backward compat 100%)
   - Audit log expandido com tags `CACHE_*`, `VISION_*`, `NLP_*`, `WORKFLOW_*`
   - Boot log em stderr identifica versão (stdout reservado para protocolo MCP)
   
   ### Security
   - OWASP Top 10 + LLM Top 10 mapeados em SECURITY.md (37 controles)
   - Versões de deps fixadas (sem ranges)
   - GitHub Action de gitleaks + pnpm audit em cada PR
   
   ### Dependencies
   - Added: `better-sqlite3@11.5.0`, `@anthropic-ai/sdk@0.32.1`, `sharp@0.33.5`
   ```
3. **docs/audit-log-schema.md:** documentar campos canonical do JSON log (timestamp, action, tool, durationMs, costUsd, success, metadata)
4. **smithery.yaml:** bump version, atualizar descrição se necessário
5. **package.json:** version → `"version": "0.2.0"`
6. **docs/demo-v0.2.md:** passo a passo executando 1 workflow de cada (recomendado: weekly_planning como showcase rápido)

## Validation Gates (Ralph Loop)
- [ ] `pnpm build` — 0 erros
- [ ] `pnpm test` — 100% (regressão final)
- [ ] `pnpm lint` — 0 warnings
- [ ] `pnpm audit --audit-level=high` — 0 CVE
- [ ] README valido (markdownlint sem erros)
- [ ] CHANGELOG segue Keep a Changelog format (validador opcional `keepachangelog/keepachangelog-action`)
- [ ] `package.json version === "0.2.0"`
- [ ] Demo end-to-end executável (instruções no docs/demo-v0.2.md funcionam manualmente)

## Tests
```bash
pnpm build && pnpm test && pnpm lint && pnpm audit --audit-level=high
markdownlint README.md CHANGELOG.md docs/*.md
node -e "console.log(require('./package.json').version)"  # → 0.2.0
```

## Security considerations
- ✅ Documentar setup das envs com EXEMPLOS (não valores reais — apenas placeholders)
- ✅ README destaca que `ANTHROPIC_API_KEY` é OPCIONAL (Camadas 2/3/4 são gracefully degradadas sem ela)
- ⚠️ Demo NÃO pode usar API key real — usar mock ou comentário "[insira sua API key]"

## Anti-stub contract
- ❌ README NÃO pode ter seções "Em construção" ou "TODO"
- ❌ CHANGELOG NÃO pode ter "v0.2.0 - YYYY-XX-XX" — preencher data real ao fazer release
- ❌ Demo NÃO pode ter screenshots placeholder

## Final Release Checklist
- [ ] Tag `v0.2.0` criada no GitHub
- [ ] `npm publish` → atualiza `tubemind-secure-mcp@0.2.0`
- [ ] Smithery publish via `mcp-publisher.exe`
- [ ] GitHub Release com release notes (extraídos do CHANGELOG)
- [ ] Smoke test pós-release: `npx tubemind-secure-mcp@0.2.0` (com OAuth válido) inicia em modo stdio sem crash
- [ ] Anúncio: Twitter/X + LinkedIn + Hacker News (Show HN)

> Sem Docker Hub. Sem container release. Tubemind v0.2 é MCP stdio puro — usuários consomem via `npx` em Claude Desktop / Cursor / Antigravity / outros MCP clients.

## Next steps (post v0.2)
- Iniciar Tubemind Platform Rails (ver `[[Tubemind-Platform-Rails]]` no Obsidian)
- Monitorar bug reports + uso real para v0.2.1
- Open-source decision: manter público ou mover para tier comercial
