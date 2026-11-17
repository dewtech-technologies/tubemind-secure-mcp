# task-005: Quota Tracker + tool get_quota_usage

## Objective
Ao final desta task, `get_quota_usage` retorna dados confiáveis de uso; threshold warnings (70%/90%) disparam em testes; reset diário funciona com clock mockado; tabela `youtube-quota-costs.ts` cobre todos endpoints usados.

## Description
Implementa tracking persistente de uso de quota YouTube API + custo monetário Anthropic em `quota_log` (criada em task-002). Cada chamada de API é registrada automaticamente via helper `quotaService.record()`. Adiciona a nova tool `get_quota_usage` para o usuário inspecionar via Claude Desktop. Reset diário à meia-noite via day_bucket. Audit log emite WARN/ERROR ao passar thresholds.

## Dependencies
- `task-003` (cache disponível, DB inicializada)

## Complexity
MED

## Files to create / modify
- CRIAR `src/services/quota.service.ts` — record(), getUsage(period), checkThresholds()
- CRIAR `src/config/youtube-quota-costs.ts` — tabela canonical de custos por endpoint
- CRIAR `src/tools/quota.tool.ts` — tool `get_quota_usage`
- MODIFICAR `src/schemas/input.schemas.ts` — adicionar `GetQuotaUsageSchema`
- MODIFICAR `src/index.ts` — registrar nova tool no router MCP
- MODIFICAR `src/services/youtube.service.ts` — chamar `quotaService.record()` após cada API call
- CRIAR `tests/unit/quota.service.test.ts`
- CRIAR `tests/integration/quota-thresholds.test.ts`

## Implementation steps
1. **youtube-quota-costs.ts:**
   ```typescript
   export const QUOTA_COSTS: Record<string, number> = {
     'youtube:search.list': 100,
     'youtube:videos.list': 1,           // por chunk
     'youtube:channels.list': 1,
     'youtube:commentThreads.list': 1,    // por página
     'youtube:captions.list': 50,
     'youtube:captions.download': 200,
     'youtube:videos.update': 50,
   };
   export const DAILY_LIMIT = parseInt(process.env.YOUTUBE_DAILY_QUOTA ?? '10000', 10);
   ```
2. **quota.service.ts:**
   ```typescript
   export const quotaService = {
     record(endpoint: string, units: number, costUsd: number = 0, tokenHash: string, success = true) {
       const dayBucket = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
       db.prepare(`INSERT INTO quota_log (timestamp, tool_name, endpoint, units_consumed, estimated_cost_usd, token_hash, success, day_bucket) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
         .run(Date.now(), getCurrentToolName(), endpoint, units, costUsd, tokenHash, success ? 1 : 0, dayBucket);
       this.checkThresholds(tokenHash, dayBucket);
     },
     getUsage(period: 'today' | 'week' | 'month', tokenHash: string): UsageReport { /* SUM agrupado */ },
     checkThresholds(tokenHash: string, dayBucket: string) {
       const todayUnits = db.prepare(`SELECT SUM(units_consumed) FROM quota_log WHERE day_bucket = ? AND token_hash = ?`).get(dayBucket, tokenHash);
       const pct = (todayUnits / DAILY_LIMIT) * 100;
       if (pct >= 90) auditLog('QUOTA_THRESHOLD_90', { pct, units: todayUnits });
       else if (pct >= 70) auditLog('QUOTA_THRESHOLD_70', { pct, units: todayUnits });
     }
   };
   ```
3. **get_quota_usage tool:** Schema Zod com `period: z.enum(['today', 'week', 'month']).default('today')`. Output markdown rico (ver BLUEPRINT seção 5.1).
4. **Integração:** em cada função de `youtube.service.ts` que chama API, adicionar `quotaService.record('youtube:<endpoint>', cost, 0, tokenHash)` após resposta.

## Validation Gates (Ralph Loop)
- [ ] `pnpm build` — 0 erros
- [ ] `pnpm test tests/unit/quota.service.test.ts` — 100%
- [ ] `pnpm test tests/integration/quota-thresholds.test.ts` — 100%
- [ ] `pnpm lint` — 0 warnings
- [ ] Tool `get_quota_usage` em DB vazia retorna "Sem dados"
- [ ] Após 100 chamadas mockadas, `get_quota_usage` retorna total correto agrupado por tool
- [ ] WARN dispara em 70%, ERROR em 90% (verificado via audit log capturado)
- [ ] Reset diário: registros de 2 dias diferentes não somam no `today`

## Tests
```bash
pnpm test tests/unit/quota.service.test.ts tests/integration/quota-thresholds.test.ts
# Casos:
# - should_record_quota_entry_with_correct_day_bucket
# - should_return_empty_report_when_no_data
# - should_sum_units_per_tool_in_period
# - should_calculate_pct_against_daily_limit
# - should_emit_warn_threshold_at_70pct
# - should_emit_error_threshold_at_90pct
# - should_isolate_quota_per_token_hash
# - should_handle_clock_change_for_day_reset (via mock clock)
# - get_quota_usage_returns_markdown_with_top_5_tools
```

## Security considerations
- ✅ **RS-1.1:** SQL via prepared statements (better-sqlite3)
- ✅ **RS-1.3:** Tracking por token_hash (audit isolado por usuário)
- ✅ **RS-1.6:** Audit de QUOTA_THRESHOLD_70, QUOTA_THRESHOLD_90
- ⚠️ **Performance:** `checkThresholds` roda em cada record — usar índice em (day_bucket, token_hash)

## Anti-stub contract
- ❌ Não retornar dados hardcoded em `get_quota_usage` — SEMPRE query real à DB
- ❌ Nada de mock de `quota_log` em código de produção
- ✅ Cada chamada à YouTube API DEVE ter `quotaService.record()` correspondente (auditável via grep)

## Next task
- Camada 1 completa
- Desbloqueia: task-006 (Vision Service usa quota tracker para custos LLM)
- Desbloqueia: task-012 (Script Generator precisa do budget cap)
