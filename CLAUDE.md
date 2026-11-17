# tubemind-secure-mcp

Servidor MCP seguro (TubeMind). TypeScript + pnpm.

Caminho: `C:\projetos-dewtech\fermio-plataform\tubemind-secure-mcp` · repo `git@github.com:dewtech-technologies/tubemind-secure-mcp.git`

## Stack — verificado no código em 2026-11-15
- TypeScript `5.7.3`, Vite `6.4.2`, testes **vitest** `4.1.5`, ESLint `9.39.4`
- `packageManager: pnpm@9.15.4` — **use pnpm**

## Ralph Loop deste projeto
`pnpm build && pnpm test && pnpm lint && pnpm audit:security`

Rode o portão completo antes de marcar qualquer task como DONE. Os comandos acima são os
**deste** projeto; não use os de outro.

## Estrutura
`src/` (entry `src/index.ts`), `tests/`, `scripts/`, `docs/`

## Avisos deste projeto
- O hook `PostToolUse` deste projeto já anuncia esse Ralph Loop (corrigido em 2026-11-15; antes mandava `python -m py_compile main.py`, que não existe aqui).

## Método DARE

As fases, regras e contratos do DARE estão nas skills `dare-*` — invoque a que precisar
(`/dare-design`, `/dare-blueprint`, `/dare-tasks`, `/dare-execute`, `/dare-review`). Não há
cópia da metodologia aqui: este arquivo é só o que é verdade **neste** projeto.

Artefatos deste projeto ficam em `DARE/`. O blueprint é `DARE/BLUEPRINT.md`.
