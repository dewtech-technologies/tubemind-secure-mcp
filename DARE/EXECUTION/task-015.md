# task-015: Pipeline Tool — run_workflow (4 workflows pré-construídos)

## Objective
Ao final desta task, 4 workflows funcionam end-to-end com mocks; `weekly_planning` executa em < 3min em teste de integração; progresso parcial recuperável (kill no meio + retry retoma do último step); pre-flight check de custo + tempo presente em todos.

## Description
Tool flagship da Camada 4 que orquestra workflows compostos (combinando todas as Camadas 1-4). 4 workflows pré-construídos: launch_new_channel (mais caro, $0.50), revive_dead_channel, weekly_planning (mais rápido, <3min), competitor_takedown. Cada step salva progresso no cache (interruptível).

## Dependencies
- `task-011` (reverse_engineer_viral_video) — usado em launch e takedown
- `task-012` (generate_full_script) — usado em launch
- `task-013` (optimize_video_description) — usado em weekly
- `task-014` (predict_video_performance) — opcional em launch

## Complexity
HIGH

## Files to create / modify
- MODIFICAR `src/services/pipeline.service.ts` — `runWorkflow()` + WORKFLOW_REGISTRY
- MODIFICAR `src/tools/pipeline.tool.ts` — tool `run_workflow`
- CRIAR `src/services/workflow-state.service.ts` — persistência de progresso parcial
- MODIFICAR `src/schemas/input.schemas.ts` — `RunWorkflowSchema` (discriminated por workflow name)
- CRIAR `tests/integration/workflow-launch-channel.test.ts`
- CRIAR `tests/integration/workflow-weekly-planning.test.ts`
- CRIAR `tests/integration/workflow-resume.test.ts`

## Implementation steps
1. **WORKFLOW_REGISTRY:**
   ```typescript
   export const WORKFLOW_REGISTRY: Record<string, WorkflowDef> = {
     launch_new_channel: {
       estimatedCostUsd: 0.50,
       estimatedMinutes: 10,
       paramsSchema: z.object({ niche: z.string(), regionCode: z.string().default('BR') }),
       steps: [
         { id: 'market', tool: 'search_trending_topics' },
         { id: 'gaps', tool: 'detect_content_gaps' },
         { id: 'patterns', tool: 'analyze_title_patterns' },
         { id: 'thumbs', tool: 'analyze_thumbnail_visuals' },
         { id: 'calendar', tool: 'generate_content_calendar' },
         { id: 'scripts', tool: 'generate_full_script_batch', batch: 10 }, // gera 10 roteiros
       ],
     },
     weekly_planning: {
       estimatedCostUsd: 0.05,
       estimatedMinutes: 3,
       paramsSchema: z.object({ niche: z.string(), channelId: z.string().regex(/^UC[a-zA-Z0-9_-]{22}$/) }),
       steps: [
         { id: 'trending', tool: 'find_trending_keywords' },
         { id: 'gaps', tool: 'detect_content_gaps' },
         { id: 'calendar', tool: 'generate_content_calendar' },
       ],
     },
     revive_dead_channel: { /* ... */ },
     competitor_takedown: { /* ... */ },
   };
   ```
2. **runWorkflow handler:**
   ```typescript
   export async function runWorkflow(input: WorkflowInput, tokenHash: string): Promise<string> {
     const workflow = WORKFLOW_REGISTRY[input.workflow];
     if (!workflow) throw new Error('Unknown workflow');
     workflow.paramsSchema.parse(input.params);
     // 1. Pre-flight check
     budgetGuard.check('workflow', workflow.estimatedCostUsd);
     const runId = `workflow_run_${crypto.randomUUID()}`;
     const preFlightHeader = `**Estimativa:** $${workflow.estimatedCostUsd.toFixed(2)} em ~${workflow.estimatedMinutes} min\n**Run ID:** \`${runId}\` (use para retomar se interrompido)\n\n`;
     // 2. Executar steps (com persistência parcial)
     const results: Record<string, any> = {};
     for (const step of workflow.steps) {
       // Check se step já foi executado (resume)
       const cached = await workflowStateService.get(runId, step.id);
       if (cached) { results[step.id] = cached; continue; }
       // Executar step
       const stepStart = Date.now();
       try {
         results[step.id] = await invokeTool(step.tool, { ...input.params, ...resolveStepInputs(step, results) }, tokenHash);
         await workflowStateService.save(runId, step.id, results[step.id]);
         auditLog('WORKFLOW_STEP', { runId, stepId: step.id, durationMs: Date.now() - stepStart, success: true });
       } catch (e) {
         auditLog('WORKFLOW_STEP', { runId, stepId: step.id, error: e.message, success: false });
         throw e;
       }
     }
     // 3. Renderizar consolidação
     return preFlightHeader + renderWorkflowMarkdown(input.workflow, results);
   }
   ```
3. **workflow-state.service.ts:**
   ```typescript
   export const workflowStateService = {
     async save(runId: string, stepId: string, data: any): Promise<void> {
       await cacheSet(`workflow:${runId}:${stepId}`, data, { tool: 'workflow_state', tokenHash: 'system', ttlSeconds: 86400 }); // 24h
     },
     async get(runId: string, stepId: string): Promise<any | null> {
       return cacheGet(`workflow:${runId}:${stepId}`);
     }
   };
   ```
4. **Retomada via parâmetro:** schema aceita opcional `resumeRunId: string` para continuar workflow interrompido

## Validation Gates (Ralph Loop)
- [ ] `pnpm build` — 0 erros
- [ ] `pnpm test tests/integration/workflow-*.test.ts` — 100%
- [ ] `pnpm lint` — 0 warnings
- [ ] `weekly_planning` end-to-end < 3min (mocks)
- [ ] `launch_new_channel` invoca ≥ 8 tools distintas (verificado via audit log)
- [ ] Resume: kill no meio de launch + retry resume retoma do step não completado (não re-executa anteriores)
- [ ] Pre-flight header presente em 100% dos outputs
- [ ] Budget cap bloqueia launch se cumulative > WORKFLOW_DAILY_BUDGET_USD

## Tests
```bash
pnpm test tests/integration/workflow-launch-channel.test.ts tests/integration/workflow-weekly-planning.test.ts tests/integration/workflow-resume.test.ts
# Casos:
# - launch_new_channel_invokes_8_or_more_tools_with_mocks
# - weekly_planning_completes_in_under_3_minutes_with_mocks
# - workflow_outputs_pre_flight_estimate_header
# - workflow_saves_partial_progress_after_each_step
# - workflow_resume_skips_completed_steps_from_cache
# - workflow_blocked_when_daily_budget_exceeded
# - workflow_reports_failed_step_with_audit_log_entry
# - unknown_workflow_name_returns_friendly_error
```

## Security considerations
- ✅ **RS-4.1:** Zod schemas por workflow (discriminated union)
- ✅ **RS-4.5:** WORKFLOW_DAILY_BUDGET_USD enforced via budgetGuard
- ✅ **RS-4.9:** Audit log de WORKFLOW_STEP com timing por step
- ⚠️ **R-4.4 (timeout MCP client):** workflows longos retornam progress incremental via audit; output final ainda é uma resposta MCP única — instruir usuário no README a usar `resumeRunId` se timeout

## Anti-stub contract
- ❌ WORKFLOW_REGISTRY NÃO pode ter workflow com `steps: []`
- ❌ Output NÃO pode ter "(step pendente)" — todos steps DEVEM ter resultado real ou erro registrado
- ❌ Pre-flight estimateCost NÃO pode ser 0 ou hardcoded universal — específico por workflow

## Next task
- `task-016` (Security Audit) — última validação antes de release
