# task-016: Auditoria de Segurança + Pin Final de Dependências

## Objective
Ao final desta task, `pnpm audit --audit-level=high` retorna 0 CVE HIGH/CRITICAL; `package.json` fixa todas as versões (sem `^` ou `~`); SECURITY.md mapeia todos os 37 RSs para seções; gitleaks scan limpo.

## Description
Penúltima task — gate de segurança obrigatório antes do release v0.2.0. Audita todas as deps (incluindo as 3 novas: `better-sqlite3`, `@anthropic-ai/sdk`, `sharp`), fixa versões exatas, adiciona GitHub Action de gitleaks (scan de secrets no histórico Git), e atualiza SECURITY.md completo com mapeamento OWASP Top 10 + LLM Top 10.

## Dependencies
- `task-015` (todas as features implementadas — agora audita o resultado)

## Complexity
LOW

## Files to create / modify
- MODIFICAR `package.json` — fixar versões exatas (remover `^` de `@anthropic-ai/sdk`, `better-sqlite3`, `sharp`)
- MODIFICAR `pnpm-lock.yaml` — regenerar com `pnpm install --lockfile-only`
- MODIFICAR `SECURITY.md` — adicionar seções mapeando RS-1.1 a RS-4.10 (37 controles) para arquivos/PRs
- CRIAR `.github/workflows/security.yml` — pnpm audit + gitleaks em cada PR
- CRIAR `.gitleaks.toml` — configuração customizada (ignorar fixtures de teste)
- CRIAR `tests/security/dependency-audit.test.ts` — script de verificação CI

## Implementation steps
1. **Fixar deps em `package.json`:**
   ```json
   "dependencies": {
     "@modelcontextprotocol/sdk": "1.26.0",
     "@anthropic-ai/sdk": "0.32.1",
     "better-sqlite3": "11.5.0",
     "googleapis": "171.4.0",
     "sharp": "0.33.5",
     "zod": "3.25.28"
   }
   ```
2. **Regenerar lockfile:** `pnpm install --lockfile-only`
3. **Rodar audit + corrigir achados:**
   ```bash
   pnpm audit --audit-level=high
   # Se houver HIGH/CRITICAL: pnpm update --interactive, validar fix, re-rodar
   ```
4. **SECURITY.md (estrutura sugerida):**
   ```markdown
   # Security Posture — tubemind-secure-mcp v0.2
   
   ## OWASP Top 10 (Web)
   ### A01 - Broken Access Control
   - RS-1.3 (cache isolado por token_hash): src/services/cache.service.ts
   - RS-3.7 (verificar OAuth scope antes captions.download): src/services/youtube.service.ts
   
   ### A02 - Cryptographic Failures
   - RS-1.2 (token SHA-256 hash): src/services/cache.service.ts:computeKey
   - RS-2.3 (strip EXIF): src/services/thumbnail-fetcher.service.ts
   - RS-3.4 (zero storage de comentários brutos): policy + tests/integration/no-pii-persisted.test.ts
   - RS-3.5 (PII filter): src/security/pii-filter.service.ts
   
   ### A03 - Injection
   - RS-1.1 (Zod + prepared statements): src/schemas/*.ts + src/services/cache.service.ts
   - RS-1.5 (path validation): src/cache/migrations.service.ts
   - RS-2.4 (Content-Type validation): src/services/thumbnail-fetcher.service.ts
   - RS-3.6, RS-4.7 (regex strict para IDs): src/schemas/input.schemas.ts
   
   ### A04 - Insecure Design
   - RS-1.8 (WAL mode), RS-2.2 (5MB limit), RS-2.8 (rate limit), RS-2.9/RS-3.8/RS-4.5 (budget caps), RS-4.10 (anti-tampering)
   
   ### A05 - Security Misconfiguration
   - RS-1.7 (chmod 600), RS-2.6 (env-only secrets)
   
   ### A06 - Vulnerable & Outdated Components
   - RS-1.4, RS-2.7, RS-3.9, RS-4.8 (pnpm audit + dependabot + GitHub Action)
   
   ### A09 - Logging & Monitoring Failures
   - RS-1.6, RS-4.9 (audit log de eventos sensíveis)
   
   ### A10 - SSRF
   - RS-2.1 (whitelist hosts thumbnail)
   
   ## OWASP LLM Top 10
   ### LLM01 - Prompt Injection
   - RS-2.5 (prompt Vision fixo), RS-3.1 (wrapper XML), RS-3.2 (prompt NLP fixo), RS-3.10 (red team CI), RS-4.2 (prompt pipeline fixo)
   
   ### LLM02 - Insecure Output Handling
   - RS-3.3 (validação Zod do output LLM), RS-4.3 (output não executável)
   
   ## Reporting Vulnerabilities
   Email: wleandro.oliveira@gmail.com — resposta em 72h
   ```
5. **GitHub Action `.github/workflows/security.yml`:**
   ```yaml
   name: Security
   on: [pull_request]
   jobs:
     audit:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: '20' }
         - uses: pnpm/action-setup@v3
           with: { version: '9.15.4' }
         - run: pnpm install --frozen-lockfile
         - run: pnpm audit --audit-level=high
         - uses: gitleaks/gitleaks-action@v2
           env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
     red-team:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: '20' }
         - uses: pnpm/action-setup@v3
           with: { version: '9.15.4' }
         - run: pnpm install --frozen-lockfile
         - run: pnpm test tests/security/
   ```

## Validation Gates (Ralph Loop)
- [ ] `pnpm install --frozen-lockfile` sucesso após regenerar lockfile
- [ ] `pnpm audit --audit-level=high` — 0 vulnerabilities HIGH/CRITICAL
- [ ] `pnpm test tests/security/` — 100% (inclui red team)
- [ ] `pnpm lint` — 0 warnings
- [ ] `pnpm build` — 0 erros
- [ ] Gitleaks scan local: `gitleaks detect --source . --config .gitleaks.toml` — 0 findings
- [ ] SECURITY.md tem entrada para cada um dos 37 RSs
- [ ] Versões em `package.json` fixadas (sem `^` ou `~`)

## Tests
```bash
pnpm audit --audit-level=high
pnpm test tests/security/
gitleaks detect --source . --config .gitleaks.toml
# Validação manual:
grep -c "^- RS-" SECURITY.md  # deve ser >= 37
```

## Security considerations
- ✅ Esta task É a auditoria de segurança — todos os RSs anteriores são validados aqui
- ⚠️ Pin de versões reduz reproducibilidade automática de updates — compensar com dependabot + revisão manual

## Anti-stub contract
- ❌ SECURITY.md NÃO pode ter "TODO: document RS-X.X"
- ❌ Action de CI NÃO pode ter `continue-on-error: true` no audit
- ✅ Dependabot configurado para abrir PRs semanais com bump de patch versions

## Next task
- `task-017` (Docs Final + Changelog)
