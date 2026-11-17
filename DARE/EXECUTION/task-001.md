# task-001: Bootstrap v0.2 — dependências + envs + verificação

## Objective
Ao final desta task, as 3 deps novas (`better-sqlite3`, `@anthropic-ai/sdk`, `sharp`) instaladas; `.env.example` lista todas as envs novas; `pnpm install --frozen-lockfile && pnpm build && pnpm test` passa; `npx tubemind-secure-mcp` continua iniciando como MCP stdio sem erros.

## Description
Primeira task do v0.2 — fundação para todas as outras. **NÃO inclui Docker** porque o Tubemind é um MCP server stdio distribuído via npm/Smithery; usuários rodam via `npx` no laptop deles (ver `claude_desktop_config.json`). Dockerfile para o futuro Cloud Run da [[Tubemind-Platform-Rails]] é responsabilidade daquele projeto, não deste.

Adiciona as 3 deps que serão usadas pelas Camadas 1-4, atualiza `.env.example` com TODAS as novas envs (cache, Anthropic, budget caps), valida que o build TypeScript ainda passa e que o MCP server arranca corretamente em modo stdio.

## Dependencies
None (Rank 0)

## Complexity
LOW

## Files to create / modify
- MODIFICAR `package.json`:
  - Adicionar `"better-sqlite3": "11.5.0"` em dependencies
  - Adicionar `"@anthropic-ai/sdk": "0.32.1"` em dependencies
  - Adicionar `"sharp": "0.33.5"` em dependencies
  - Adicionar `"@types/better-sqlite3": "^7.6.0"` em devDependencies
  - Bump version para `"0.2.0-alpha.0"` (release final em task-017)
- MODIFICAR `pnpm-lock.yaml` — regenerar via `pnpm install --lockfile-only`
- MODIFICAR `.env.example` — adicionar as 6 novas envs:
  ```
  # Camada 1 — Cache (opcional, default enabled)
  TUBEMIND_CACHE_PATH=
  TUBEMIND_CACHE_ENABLED=true
  
  # Camadas 2-4 — Anthropic (opcional, ativa Vision/NLP/Pipeline)
  ANTHROPIC_API_KEY=
  
  # Budget caps por API (USD/dia)
  VISION_DAILY_BUDGET_USD=5.00
  NLP_DAILY_BUDGET_USD=10.00
  WORKFLOW_DAILY_BUDGET_USD=20.00
  ```
- MODIFICAR `src/index.ts` — adicionar log de boot identificando v0.2 (helps debugging futuro):
  ```typescript
  console.error(`[tubemind-secure-mcp] v${pkg.version} iniciado (stdio mode)`);
  ```
- CRIAR `tests/unit/bootstrap.test.ts` — valida que:
  - Todas as 3 novas deps carregam sem erro
  - `process.env.TUBEMIND_CACHE_ENABLED` default = `'true'` quando não setada
  - Sem `ANTHROPIC_API_KEY`, o módulo de Vision/NLP/Pipeline pode ser importado sem crash (lazy)

## Implementation steps
1. **Atualizar `package.json`:**
   ```bash
   pnpm add better-sqlite3@11.5.0 @anthropic-ai/sdk@0.32.1 sharp@0.33.5
   pnpm add -D @types/better-sqlite3
   ```
2. **Atualizar `.env.example`** com as 6 envs acima (preservar as existentes do v0.1: `YOUTUBE_CLIENT_ID`, etc.)
3. **Regenerar lockfile reproduzível:** `pnpm install --frozen-lockfile` deve passar
4. **Boot log em `src/index.ts`:** após criar o `Server` MCP, logar versão no stderr (stdout é reservado para MCP messages — não pode poluir)
5. **Teste de smoke:** rodar `node dist/index.js < /dev/null` (Unix) ou `echo '' | node dist/index.js` (Windows) — não pode crashar imediatamente; deve logar a linha de boot e esperar input MCP
6. **Importação lazy:** garantir que `import` do anthropic SDK e sharp NÃO crashe se as envs não estiverem setadas — só falha ao USAR a função

## Validation Gates (Ralph Loop)
- [ ] `pnpm install --frozen-lockfile` sucesso
- [ ] `pnpm build` (tsc) — 0 erros TypeScript
- [ ] `pnpm test` — 100% pass (suite v0.1 inalterada + novo `bootstrap.test.ts`)
- [ ] `pnpm lint` — 0 errors, 0 warnings
- [ ] `pnpm audit --audit-level=high` — 0 CVE HIGH/CRITICAL
- [ ] `node dist/index.js` arranca sem crash (testar com timeout 2s)
- [ ] `pnpm pack` gera tarball; `npm install -g <tarball>` + `tubemind-secure-mcp --help` (ou rodar sem args) funciona
- [ ] **NÃO regrediu:** o usuário pode continuar usando `npx tubemind-secure-mcp` no Claude Desktop (smoke test manual)

## Tests
```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test tests/unit/bootstrap.test.ts
pnpm lint
pnpm audit --audit-level=high

# Smoke test do MCP stdio (vai esperar input — kill após 2s)
timeout 2 node dist/index.js || echo "OK (esperado: timeout)"

# Validar que pacote final é instalável
pnpm pack
```

## Security considerations
- ✅ **RS-2.6:** `.env.example` sem secrets reais — apenas placeholders vazios
- ✅ **RS-4.5:** Defaults de budget caps configurados (não enforcement nesta task — vem em task-006)
- ⚠️ **Deps nativas:** `better-sqlite3` e `sharp` requerem compilação — prebuilt binaries são distribuídos via npm, mas Windows pode precisar `windows-build-tools`. Documentar em README.md (task-017)
- ✅ Importações lazy garantem que usuários sem `ANTHROPIC_API_KEY` não veem crash no startup

## Anti-stub contract
- ❌ NÃO adicionar `console.log("TODO: validate envs")` no boot
- ❌ NÃO criar wrapper vazio para deps novas que serão usadas em tasks posteriores
- ✅ `bootstrap.test.ts` precisa carregar as deps de verdade (não mock)
- ✅ As 3 deps DEVEM estar no `dependencies` (não `devDependencies`)

## Notas importantes (sobre Docker)
> **Docker NÃO é parte desta task.** O Tubemind v0.2 é um MCP server stdio
> distribuído via npm registry — usuários rodam `npx tubemind-secure-mcp` no
> laptop deles, configurado em `claude_desktop_config.json`. Container Docker
> só fará sentido quando a [[Tubemind-Platform-Rails]] (GCP Cloud Run)
> começar — e será responsabilidade daquele projeto.
>
> Se quiser preparar para o futuro Cloud Run AGORA, pode opcionalmente
> adicionar um `Dockerfile` simples (single-stage, sem healthcheck HTTP)
> em task-017, mas não bloqueia o release v0.2.

## Next task
- `task-003` (Cache Service) — desbloqueada após task-002
- task-002 (Schema SQLite) — paralela a esta no Rank 0
