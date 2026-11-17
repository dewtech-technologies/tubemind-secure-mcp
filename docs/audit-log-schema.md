# Audit Log Schema — tubemind-secure-mcp v0.2

O audit log é um JSONL (uma entrada por linha) gravado em `AUDIT_LOG_PATH`
(default `./logs/audit.log`). Cada entrada segue o schema abaixo.

## Schema canonical

```typescript
interface AuditEntry {
  timestamp: string         // ISO 8601 (ex: "2026-05-24T12:34:56.789Z")
  action: AuditAction       // tag canonical (lista abaixo)
  toolName: string          // nome da tool MCP que originou
  success: boolean
  durationMs: number
  errorCode?: string        // nome da classe de erro OU detalhe (NUNCA stack trace)
  channelIdHash?: string    // hash SHA-256 do channelId (não o valor real)
}
```

## Tags canonical (`AuditAction`)

### v0.1 (tools originais)
- `SEARCH_TRENDING`, `GET_KEYWORD_STATS`, `GET_VIDEO_TAGS`, `SUGGEST_TAGS`
- `UPDATE_VIDEO_METADATA`, `LIST_CHANNEL_VIDEOS`
- `GET_CHANNEL_ANALYTICS`, `GET_COMPETITOR_VIDEOS`
- `ESTIMATE_KEYWORD_DIFFICULTY`, `ANALYZE_TITLE_PATTERNS`, `DETECT_CONTENT_GAPS`
- `SCORE_BEST_PUBLISH_WINDOW`, `BENCHMARK_CHANNEL`
- `ESTIMATE_CTR_POTENTIAL`, `SUGGEST_HOOK_ANGLES`, `FIND_TRENDING_KEYWORDS`
- `ANALYZE_RETENTION_SIGNALS`, `GENERATE_CONTENT_CALENDAR`
- `OAUTH_INIT`, `OAUTH_CALLBACK`, `TOKEN_REFRESH`, `TOKEN_REVOKE`

### v0.2 Camada 1 — Cache + Quota
- `CACHE_HIT` — cache lookup retornou valor válido
- `CACHE_MISS` — cache lookup falhou (key ausente ou TTL expirado)
- `CACHE_BYPASS` — chamada com `fresh: true` ignorou cache
- `CACHE_EVICT` — LRU eviction disparada (size > 100MB)
- `CACHE_INIT_FAILED` — DB SQLite indisponível (fail-soft)
- `QUOTA_RECORD` — chamada API registrada em `quota_log`
- `QUOTA_THRESHOLD_70` — uso diário atingiu 70% (WARN)
- `QUOTA_THRESHOLD_90` — uso diário atingiu 90% (ERROR)
- `GET_QUOTA_USAGE` — tool invocada
- `YOUTUBE_BATCH_FETCH` — fetch batched de N videoIds

### v0.2 Camada 2 — Vision
- `VISION_API_CALL` — chamada Claude Vision (registra `durationMs`)
- `ANALYZE_THUMBNAIL_VISUALS` — tool invocada
- `SCORE_MY_THUMBNAIL` — tool invocada

### v0.2 Camada 3 — NLP
- `NLP_LLM_CALL` — chamada Claude texto (Haiku ou Sonnet)
- `ANALYZE_VIDEO_COMMENTS` — tool invocada
- `ANALYZE_VIDEO_TRANSCRIPT` — tool invocada
- `REVERSE_ENGINEER_VIRAL_VIDEO` — tool invocada

### v0.2 Camada 4 — Pipeline
- `GENERATE_FULL_SCRIPT` — tool invocada
- `OPTIMIZE_VIDEO_DESCRIPTION` — tool invocada
- `PREDICT_VIDEO_PERFORMANCE` — tool invocada
- `RUN_WORKFLOW` — tool invocada
- `WORKFLOW_STEP` — step individual de workflow (registra duration + success por step)

## Garantias

- **Sem PII**: emails, telefones, channelIds reais NUNCA aparecem no log.
- **Sem stack traces**: `errorCode` é nome da classe ou detalhe seguro.
- **Append-only**: logs nunca são reescritos.
- **Fail-soft**: se gravação falha, operação principal continua.

## Análise (exemplo)

```bash
# Top 10 tools mais usadas (último dia)
grep '"2026-05-24"' logs/audit.log | jq -r '.action' | sort | uniq -c | sort -rn | head

# Taxa de cache hit/miss
grep -E '"CACHE_(HIT|MISS)"' logs/audit.log | jq -r '.action' | sort | uniq -c

# Workflows que falharam
grep '"WORKFLOW_STEP"' logs/audit.log | jq 'select(.success == false)'
```
