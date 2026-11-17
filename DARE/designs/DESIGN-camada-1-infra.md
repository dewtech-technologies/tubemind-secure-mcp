# DESIGN: Tubemind v0.2 — Camada 1: Infraestrutura (Cache + Batch + Quota)

> **Versão:** v1.0 | **Data:** 2026-05-23 | **Status:** APROVADO

---

## 1. DESCRIÇÃO

Camada de infraestrutura do `tubemind-secure-mcp` que reduz o consumo da quota diária da YouTube Data API em 80-90% através de cache local em SQLite, refatoração de chamadas em batch e tracking persistente de uso de quota. Resolve o problema atual de usuários esgotarem a quota de 10.000 unidades/dia em 1-2 horas de uso intenso, e adiciona observabilidade para evitar bloqueios surpresa.

---

## 2. OBJETIVOS E MÉTRICAS DE SUCESSO

| # | Objetivo | Métrica verificável | Meta |
|---|----------|---------------------|------|
| O-01 | Reduzir consumo de quota YouTube API | Benchmark `repeat_calls.test.ts` em 2ª chamada idêntica | ≥ 80% redução |
| O-02 | Reduzir latência de tools cacheadas | p95 de tempo de resposta em cache hit | < 2 segundos |
| O-03 | Reduzir chamadas via batch optimization | Quota usada em `analyze_title_patterns` (30 vídeos) | de 30 unidades → ≤ 2 unidades |
| O-04 | Visibilidade do consumo de quota | Tool `get_quota_usage` retornando dados confiáveis | 100% das chamadas auditadas |
| O-05 | Backward compatibility | Suite de testes da v0.1 passando sem alteração | 100% pass rate |

---

## 3. STAKEHOLDERS

| Papel | Nome / Time | Interesse principal |
|-------|-------------|---------------------|
| Product Owner | Wanderson Leandro (Dewtech) | Aprovação de scope, alinhamento com roadmap v0.2 |
| Tech Lead | Wanderson Leandro (Dewtech) | Decisões de arquitetura SQLite, manter OWASP posture |
| Usuário Final | Criadores YouTube + agências usando Claude Desktop | Não esgotar quota, latência baixa, MCP estável |
| Comunidade Open Source | Issuers do repo dewtech-technologies/tubemind-secure-mcp | Manter compatibilidade, docs claras |

---

## 4. REQUISITOS FUNCIONAIS

| ID | Requisito | Prioridade | Critério de aceite |
|----|-----------|------------|--------------------|
| RF-1.1 | Cache SQLite com chave `hash(tool_name + query + region + params + token_hash)` | MUST | Tabela `cache_entries` com unique constraint; 2ª chamada idêntica retorna em < 100 ms |
| RF-1.2 | TTL configurável por tool com defaults sensatos (1h trending, 24h heurísticas, 6h keywords) | MUST | `cache.config.ts` exporta map `<toolName, ttlSeconds>`; testes validam TTL por tool |
| RF-1.3 | Isolamento de cache por OAuth token (hash do token na chave) | MUST | Teste de integração: 2 tokens diferentes não compartilham cache para mesma query |
| RF-1.4 | LRU eviction quando cache > 100MB | MUST | `pragma page_count * page_size` > limite → DELETE oldest entries; teste de stress |
| RF-1.5 | Bypass de cache via parâmetro `?fresh=true` em qualquer tool | SHOULD | Schema Zod aceita `fresh: boolean`; quando true, ignora cache e re-escreve |
| RF-1.6 | Toggle global de cache via env var `TUBEMIND_CACHE_ENABLED` | MUST | Default `true`; `false` desabilita lookups e escritas |
| RF-1.7 | Batch fetch de vídeos: `getVideosByIdsBatched(ids: string[])` aceitando até 50 IDs por chamada | MUST | 50 IDs = 1 chamada `videos.list`, não 50; tests com mock client confirmam |
| RF-1.8 | Refactor de 6 tools (`estimate_keyword_difficulty`, `analyze_title_patterns`, `detect_content_gaps`, `find_trending_keywords`, `analyze_retention_signals`, `generate_content_calendar`) para usar batch | MUST | Code review confirma ausência de `Promise.all(ids.map(getVideoById))` |
| RF-1.9 | Quota tracker persistente em tabela `quota_log` (timestamp, tool, units_consumed) | MUST | Cada chamada API registra unidades estimadas; tabela populada em testes |
| RF-1.10 | Nova tool `get_quota_usage(period: 'today' \| 'week' \| 'month')` | MUST | Retorna markdown com total, por tool, % do limite diário |
| RF-1.11 | Audit log emite WARN ao passar 70% e ERROR ao passar 90% do limite diário | SHOULD | Logs visíveis em `./logs/audit.log` com tags `QUOTA_THRESHOLD_70`, `QUOTA_THRESHOLD_90` |
| RF-1.12 | Reset automático do contador diário à meia-noite (TZ do servidor) | MUST | Cron interno ou check on-demand baseado em `date('now', 'start of day')` |
| RF-1.13 | Migração SQLite automática na primeira execução (criação de schema) | MUST | `migrations.service.ts` executa idempotente no boot |

> Prioridades: **MUST** (bloqueia v0.2) · **SHOULD** (importante, mas não bloqueia) · **COULD** (nice to have)

---

## 5. REQUISITOS NÃO-FUNCIONAIS

| ID | Categoria | Requisito | Meta |
|----|-----------|-----------|------|
| RNF-1.1 | Performance | Latência cache hit | p95 < 100 ms, p99 < 200 ms |
| RNF-1.2 | Performance | Latência cache miss (chamada API + escrita) | p95 < 3s (igual baseline atual) |
| RNF-1.3 | Disponibilidade | Cache não pode quebrar tools — falha graceful | Erro de cache logado, fallback à API direta |
| RNF-1.4 | Segurança | Cache em path do usuário sem permissão de outros usuários | Path: `~/.tubemind/cache.db` com chmod 600 (Unix) |
| RNF-1.5 | Segurança | Token hash com SHA-256 (não plain) | Validado por inspeção da tabela `cache_entries` |
| RNF-1.6 | Observabilidade | Cada operação de cache loga em audit (hit/miss/evict) | Tag `CACHE_HIT`, `CACHE_MISS`, `CACHE_EVICT` no audit log |
| RNF-1.7 | Manutenibilidade | Cobertura de testes nova feature | ≥ 85% |
| RNF-1.8 | Manutenibilidade | Zero novas runtime dependencies além de `better-sqlite3` | `package.json` review |
| RNF-1.9 | Compatibilidade | Backward compat com v0.1 | Todos os tools da v0.1 funcionam sem mudança de assinatura |

---

## 6. REQUISITOS DE SEGURANÇA

| ID | Requisito | Referência |
|----|-----------|------------|
| RS-1.1 | Inputs validados via Zod antes de qualquer query SQLite (parametrized queries obrigatórias) | OWASP A03 (Injection) |
| RS-1.2 | Token OAuth nunca armazenado em texto plano; usar SHA-256 hash como chave de cache | OWASP A02 (Crypto Failures) |
| RS-1.3 | Cache isolado por token — query DEVE incluir `token_hash` na cláusula WHERE | OWASP A01 (Broken Access Control) |
| RS-1.4 | Auditoria de `better-sqlite3` sem CVE HIGH/CRITICAL antes de release | OWASP A06 (Vulnerable Components) |
| RS-1.5 | Caminhos de arquivo SQLite validados (sem path traversal `../`) | OWASP A03 |
| RS-1.6 | Audit log de operações sensíveis (eviction, reset, bypass) | OWASP A09 (Logging Failures) |
| RS-1.7 | Cache db file com permissão restrita (Unix: 600; Windows: ACL apenas usuário) | OWASP A05 (Misconfiguration) |
| RS-1.8 | Pragma `journal_mode=WAL` + `synchronous=NORMAL` para evitar corrupção sob crash | OWASP A04 (Insecure Design) |

---

## 7. STACK TÉCNICA

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Linguagem / Runtime | TypeScript / Node.js | TS 5.7+, Node ≥ 20 |
| Framework MCP | `@modelcontextprotocol/sdk` | 1.26.0 (já no projeto) |
| Cache storage | `better-sqlite3` | ^11.x |
| YouTube API client | `googleapis` | 171.4.0 (já no projeto) |
| Validation | `zod` | 3.25.28 (já no projeto) |
| Testing | `vitest` | 4.1.5 (já no projeto) |
| Hashing | `node:crypto` (SHA-256) | nativo |

---

## 8. INTEGRAÇÕES EXTERNAS

| Sistema | Tipo | Protocolo | Direção | Dados trocados | Responsável |
|---------|------|-----------|---------|----------------|-------------|
| YouTube Data API v3 | API REST | HTTPS | Saída | Search, videos.list (batch), channels.list | Google |
| YouTube Analytics API | API REST | HTTPS | Saída | Métricas de canal (já integrado) | Google |
| Filesystem local | Storage | FS | I/O | SQLite db (cache + quota_log) | OS |

---

## 9. RESTRIÇÕES

- **Prazo:** Sprint 1 do Tubemind v0.2 (estimativa 5-7 dias úteis)
- **Orçamento de infra:** Zero — tudo local, sem custos adicionais
- **Limitações técnicas:**
  - Não pode adicionar Redis ou dependência externa (manter "tiny footprint")
  - Manter Node ≥ 20 (sem upgrade obrigatório)
  - `better-sqlite3` requer compilação nativa — incluir prebuilt binaries
- **Compliance:** N/A (sem PII gerenciado)

---

## 10. FORA DO ESCOPO (v0.2)

- **Cache distribuído** (Redis, Memcached) — adiado para enterprise tier futuro; complexidade não justifica para v0.2
- **Cache warming proativo** (pre-fetch de keywords populares) — adiado por falta de telemetria de uso real
- **Quota tracking por usuário em multi-tenant** — Tubemind atual é single-tenant (1 OAuth por instância)
- **Cache federado entre instâncias** — não há demanda detectada
- **Compressão de cache entries** — só vale a pena se cache > 500MB (não esperado em v0.2)

---

## 11. RISCOS E MITIGAÇÕES

| # | Risco | Probabilidade | Impacto | Mitigação |
|---|-------|---------------|---------|-----------|
| R-1.1 | `better-sqlite3` falha em build no Windows do usuário | Média | Alto | Documentar pré-requisitos (windows-build-tools); fallback gracioso desabilita cache se SQLite indisponível |
| R-1.2 | Cache eviction agressiva remove entries quentes | Baixa | Médio | LRU baseado em `last_accessed`, não FIFO; logs de eviction para audit |
| R-1.3 | Corrupção de db por crash | Baixa | Alto | WAL mode + auto-reset se `PRAGMA integrity_check` falhar |
| R-1.4 | Cache hit incorreto após mudança de algoritmo (heurísticas) | Média | Médio | Incluir `tubemind_version` na chave de cache (invalida cache em upgrade) |
| R-1.5 | Quota estimada divergir do real (Google revisa custos) | Média | Baixo | Comparar com `quotaUser` real do Google quando disponível; ajustar tabela de custos |
| R-1.6 | Race condition em escritas concorrentes ao SQLite | Baixa | Médio | WAL + transações; `better-sqlite3` é synchronous (mitigação natural) |
| R-1.7 | Volume de logs de auditoria cresce demais | Baixa | Baixo | Rotação automática quando > 50MB; documentar config |

---

## 12. CHECKLIST DE APROVAÇÃO

- [ ] Requisitos funcionais (RF-1.1 a RF-1.13) revisados e priorizados
- [ ] Requisitos de segurança (RS-1.1 a RS-1.8) validados pelo Tech Lead
- [ ] Stack técnica aprovada (especial: adicionar `better-sqlite3` ao bundle)
- [ ] Path do cache db acordado (`~/.tubemind/cache.db` vs `./tokens/cache.db`)
- [ ] Tabela de custos por endpoint YouTube API validada
- [ ] Backward compat plan revisado (testes v0.1 não podem quebrar)
- [ ] Riscos críticos R-1.1, R-1.3, R-1.4 com mitigação confirmada
