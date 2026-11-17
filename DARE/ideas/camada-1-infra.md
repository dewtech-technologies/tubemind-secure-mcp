# Ideia — Camada 1: Infraestrutura (Cache + Batch + Quota)

## Contexto

O Tubemind v0.1 funciona, mas tem um problema sério de **consumo de quota da YouTube API**.
Cada chamada de tool faz múltiplas requests sequenciais (search.list + videos.list por ID + channels.list por canal), queimando rápido o limite diário de 10.000 unidades.

Em uma única chamada de `detect_content_gaps`, gastamos ~50 unidades. Em uma `generate_content_calendar`, ~200 unidades. Um usuário ativo esgota a quota em 1-2 horas de uso.

## O que quero construir

Uma camada de infraestrutura que **reduz consumo de quota em 80-90%** sem perder qualidade dos dados, e que adiciona observabilidade do consumo.

### 1. Cache SQLite com TTL configurável

- Cache local em SQLite (já temos SQLite no ecossistema DARE)
- Chave: `hash(tool_name + query + region + params)`
- TTL configurável por tool (defaults sensatos):
  - `search_trending_topics`: 1h (muda rápido)
  - `get_keyword_stats`: 6h
  - `estimate_keyword_difficulty`: 24h
  - `analyze_title_patterns`: 24h
  - `detect_content_gaps`: 12h
  - `get_channel_analytics`: 1h
- LRU eviction quando passar de 100MB
- Cache isolado por OAuth token (sem leak entre usuários)
- Opção de bypass: `?fresh=true` no parâmetro

### 2. Batch Optimization

O código atual faz:
```typescript
const videos = await Promise.all(videoIds.map(id => getVideoById(client, id)))
// → 50 ids = 50 chamadas API = 50 unidades de quota
```

Quero refatorar para:
```typescript
const videos = await getVideosByIdsBatched(client, videoIds)
// → 50 ids = 1 chamada (videos.list aceita até 50 IDs) = 1 unidade
```

Aplicar isso em TODAS as tools que fazem fan-out de IDs:
- `estimate_keyword_difficulty`
- `analyze_title_patterns`
- `detect_content_gaps`
- `find_trending_keywords`
- `analyze_retention_signals`
- `generate_content_calendar`

### 3. Quota Tracker Persistente

Nova tool: `get_quota_usage`
- Tracking em SQLite (tabela `quota_log`)
- Quota usage por: tool, dia, hora
- Avisos automáticos no audit log quando passar 70%, 90% do limite diário
- Reset automático à meia-noite (timezone do servidor)
- Endpoint para visualizar histórico semanal

## Por que importa

- ✅ Usuários poderem usar Tubemind **o dia inteiro sem esgotar quota**
- ✅ Latência **<2s** para chamadas cacheadas (atualmente 5-15s)
- ✅ Diferencial competitivo: nenhum outro MCP YouTube tem cache nativo
- ✅ Base para todas as próximas camadas (visão, NLP, pipeline)

## Restrições

- Não pode quebrar backward compatibility da v0.1
- Cache opcional (pode desabilitar via env var `TUBEMIND_CACHE_ENABLED=false`)
- Manter postura OWASP Top 10 (cache não pode vazar dados entre tokens OAuth)
- SQLite local — sem dependência externa (Redis, etc.)

## Definição de "feito"

- [ ] 80%+ redução de quota medida em benchmark (cache hit em 2ª chamada)
- [ ] Tool `get_quota_usage` retornando dados confiáveis
- [ ] Todas as 6 tools com fan-out usando batch
- [ ] Testes de integração com cache hit/miss
- [ ] Documentação no README sobre cache + flags de configuração
