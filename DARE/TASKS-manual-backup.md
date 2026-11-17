# TASKS — Tubemind v0.2

> **Gerado a partir de:** `DARE/BLUEPRINT.md`
> **Data:** 2026-05-23 | **Total:** 17 tasks
> **Estratégia de execução:** DAG paralelo (ver `dare-dag.yaml`) — caminho crítico ≈ 8 etapas sequenciais

---

## Visão Geral

| ID | Título | Status | Depende de | Complexidade | Estimativa | Camada |
|----|--------|--------|------------|--------------|------------|--------|
| task-001 | Containerização e Setup (Dockerfile + Compose + envs) | ⏳ PENDING | — | LOW | 2h | 0 (infra) |
| task-002 | Schema SQLite + Migrations (cache + quota) | ⏳ PENDING | — | MED | 3h | 1 |
| task-003 | Cache Service (get/set/bypass/LRU evict) | ⏳ PENDING | task-002 | HIGH | 6h | 1 |
| task-004 | Batch Optimization (getVideosByIdsBatched + refactor 6 tools) | ⏳ PENDING | task-003 | MED | 4h | 1 |
| task-005 | Quota Tracker + tool get_quota_usage | ⏳ PENDING | task-003 | MED | 4h | 1 |
| task-006 | Vision Service + Thumbnail Fetcher + Budget/Rate Guard | ⏳ PENDING | task-003 | HIGH | 8h | 2 |
| task-007 | Vision Tools (analyze_thumbnail_visuals + score_my_thumbnail) | ⏳ PENDING | task-006 | HIGH | 6h | 2 |
| task-008 | Prompt Sanitizer + PII Filter + 20 Red Team Fixtures | ⏳ PENDING | task-003 | HIGH | 6h | 3 |
| task-009 | NLP Tool: analyze_video_comments | ⏳ PENDING | task-008 | MED | 5h | 3 |
| task-010 | NLP Tool: analyze_video_transcript | ⏳ PENDING | task-008 | HIGH | 6h | 3 |
| task-011 | NLP Tool: reverse_engineer_viral_video (orquestra 2+3) | ⏳ PENDING | task-007, task-009, task-010 | MED | 4h | 3 |
| task-012 | Pipeline Tool: generate_full_script | ⏳ PENDING | task-005, task-008 | HIGH | 6h | 4 |
| task-013 | Pipeline Tool: optimize_video_description | ⏳ PENDING | task-008 | MED | 4h | 4 |
| task-014 | Pipeline Tool: predict_video_performance | ⏳ PENDING | task-007, task-012 | MED | 4h | 4 |
| task-015 | Pipeline Tool: run_workflow (4 workflows pré-construídos) | ⏳ PENDING | task-011, task-012, task-013, task-014 | HIGH | 8h | 4 |
| task-016 | Auditoria de Segurança + Pin Final de Deps | ⏳ PENDING | task-015 | LOW | 2h | — |
| task-017 | README + SECURITY.md + Audit Log final + Changelog v0.2.0 | ⏳ PENDING | task-016 | LOW | 3h | — |

**Total estimado:** 81 horas sequenciais → **~24 horas paralelas** (DAG 75% speedup conforme DARE)

---

## Status Legend

| Símbolo | Significado |
|---------|-------------|
| ⏳ PENDING | Aguardando dependências OU não iniciada |
| 🟢 READY | Dependências satisfeitas, pode executar |
| 🔄 RUNNING | Em execução agora |
| ✅ DONE | Concluída + Ralph Loop verde + `dare review` passou |
| ❌ FAILED | Ralph Loop ou review falhou |
| 🔒 BLOCKED | Dependência falhou |

---

## Progresso

```
█████████████████████ 0/17 (0%)
```

---

## Caminho Crítico (sequencial obrigatório)

```
task-001/002 (paralelas) → task-003 → task-008 → task-010 → task-011 → task-015 → task-016 → task-017
```

8 etapas sequenciais. Tudo o que estiver fora deste caminho pode rodar em paralelo com algo dele.

---

## Grupos de Execução Paralela (Ranks)

### Rank 0 (sem dependências) — pode rodar imediatamente
- task-001 (Containerização)
- task-002 (Schema SQLite)

### Rank 1 (depende de Rank 0)
- task-003 (Cache Service) — espera task-002

### Rank 2 (depende de task-003)
- task-004 (Batch Optimization)
- task-005 (Quota Tracker)
- task-006 (Vision Service)
- task-008 (Sanitizer + PII)

### Rank 3
- task-007 (Vision Tools) — espera task-006
- task-009 (NLP Comments) — espera task-008
- task-010 (NLP Transcript) — espera task-008
- task-013 (Description Optimizer) — espera task-008

### Rank 4
- task-011 (Reverse Engineering) — espera 007, 009, 010
- task-012 (Script Generator) — espera 005, 008

### Rank 5
- task-014 (Predictor) — espera 007, 012

### Rank 6
- task-015 (Workflows) — espera 011, 012, 013, 014

### Rank 7
- task-016 (Security Audit)

### Rank 8
- task-017 (Docs + Final)

---

## Tasks Prontas Para Execução

🟢 **READY:** `task-001`, `task-002`

Comandos:
```bash
# Executar individualmente no Cursor (Auto mode)
/execute-task task-001
/execute-task task-002

# OU rodar via DAG paralelo (todo Rank 0+1 em sequência ótima)
dare execute --parallel
```

---

## Specs Detalhadas

Veja `DARE/EXECUTION/task-NNN.md` para cada task — contém:
- Objetivo verificável
- Arquivos a criar/modificar
- Implementação passo a passo
- Anti-stub contract aplicado
- Validation gates (Ralph Loop)
- Critérios de DONE checklist

---

## Atualização Manual

Quando uma task for completada (Ralph Loop verde + `dare review` passou), atualize esta tabela:
1. Mude `⏳ PENDING` para `✅ DONE`
2. Atualize a barra de progresso (X/17)
3. Recalcule tasks `🟢 READY` (PENDING com todas deps DONE)

Ou rode `/dare-tasks` (slash command) para regenerar a visão a partir do estado real.
