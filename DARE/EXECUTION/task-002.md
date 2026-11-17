# task-002: Schema SQLite + migrations (cache_entries + quota_log)

## Objective
Ao final desta task, `migrations.service.ts` cria as tabelas `cache_entries` e `quota_log` com índices em DB nova; `PRAGMA integrity_check` passa; testes de migração rodam em DB temp.

## Description
Implementa as 3 migrations SQL declarativas em `src/cache/migrations/*.sql` e o serviço idempotente que as roda no boot do MCP server. Configura SQLite com WAL mode, synchronous NORMAL, auto_vacuum incremental, e proteção contra corrupção (`PRAGMA integrity_check` com auto-reset se falhar).

## Dependencies
None (Rank 0, paralelo a task-001)

## Complexity
MED

## Files to create / modify
- CRIAR `src/cache/migrations/001_create_cache_entries.sql` — tabela cache_entries (ver BLUEPRINT seção 4.1)
- CRIAR `src/cache/migrations/002_create_quota_log.sql` — tabela quota_log (ver BLUEPRINT seção 4.2)
- CRIAR `src/cache/migrations/003_indexes.sql` — todos os índices (8 índices ao total)
- CRIAR `src/cache/migrations.service.ts` — runner idempotente: lê SQL files, executa em transação, registra em `_migrations` table
- CRIAR `tests/unit/migrations.service.test.ts` — testa idempotência, integridade, fallback de DB corrompida

## Implementation steps
1. **001_create_cache_entries.sql:** CREATE TABLE com colunas (id, cache_key UNIQUE, tool_name, token_hash, payload BLOB, payload_size_bytes, created_at, expires_at, last_accessed, access_count, tubemind_version)
2. **002_create_quota_log.sql:** CREATE TABLE com colunas (id, timestamp, tool_name, endpoint, units_consumed, estimated_cost_usd, token_hash, success, day_bucket TEXT 'YYYY-MM-DD')
3. **003_indexes.sql:** CREATE INDEX para: cache_entries(token_hash), (expires_at), (last_accessed), (tool_name); quota_log(day_bucket), (token_hash), (tool_name), (endpoint)
4. **migrations.service.ts:**
   ```typescript
   export function runMigrations(db: Database): void {
     // 1. Aplicar PRAGMAs: journal_mode=WAL, synchronous=NORMAL, auto_vacuum=INCREMENTAL
     // 2. Criar tabela _migrations(filename, applied_at) se não existir
     // 3. Listar arquivos em migrations/*.sql ordenados alfabeticamente
     // 4. Para cada arquivo não em _migrations: executar dentro de transaction + INSERT em _migrations
     // 5. Rodar PRAGMA integrity_check — se != 'ok', mover DB para .corrupted e recriar
   }
   ```
5. **Path do DB:** `path.join(os.homedir(), '.tubemind', 'cache.db')` ou env `TUBEMIND_CACHE_PATH`
6. **Permissões:** após criar arquivo, `fs.chmodSync(dbPath, 0o600)` em Unix; em Windows usar `icacls` via child_process (best effort)

## Validation Gates (Ralph Loop)
- [ ] `pnpm build` — 0 erros TypeScript
- [ ] `pnpm test tests/unit/migrations.service.test.ts` — 100% pass
- [ ] `pnpm lint` — 0 warnings
- [ ] Migration idempotente: rodar 2x não duplica tabelas/índices
- [ ] `PRAGMA integrity_check` retorna 'ok' em DB nova
- [ ] DB corrompida (arquivo random bytes) → renomeada para .corrupted e DB nova criada

## Tests
```bash
pnpm test tests/unit/migrations.service.test.ts
# Casos cobertos:
# - should_create_all_tables_when_db_is_new
# - should_skip_already_applied_migrations
# - should_apply_pragmas_correctly
# - should_recover_from_corrupted_db
# - should_set_chmod_600_on_unix
```

## Security considerations
- ✅ **RS-1.1:** SQL files declarativos (não strings concatenadas em runtime)
- ✅ **RS-1.5:** Path validado — rejeita `../` traversal antes de qualquer fs operation
- ✅ **RS-1.7:** chmod 600 (Unix) / ACL Windows após criação
- ✅ **RS-1.8:** WAL + synchronous NORMAL via PRAGMA
- ⚠️ **Não logar** o caminho completo do DB em audit (pode expor estrutura do filesystem)

## Anti-stub contract
- ❌ Nada de `// TODO: implement migrations later`
- ❌ Nada de `function runMigrations() { /* stub */ }`
- ✅ As 3 migrations DEVEM criar todas as 10 colunas + 8 índices especificados

## Next task
- `task-003` (Cache Service) — bloqueada nesta
- `task-005` (Quota Tracker) — também usa esta DB
