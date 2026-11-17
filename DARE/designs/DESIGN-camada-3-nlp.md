# DESIGN: Tubemind v0.2 — Camada 3: NLP (Comentários + Transcrições)

> **Versão:** v1.0 | **Data:** 2026-05-23 | **Status:** APROVADO

---

## 1. DESCRIÇÃO

Camada de inteligência linguística que estende o `tubemind-secure-mcp` para analisar as duas maiores fontes de sinal de um vídeo no YouTube: **comentários** (o que a audiência realmente pensa, pede, reclama) e **transcrições** (como vídeos virais são estruturados). Entrega 3 novas tools (`analyze_video_comments`, `analyze_video_transcript`, `reverse_engineer_viral_video`) que transformam audiência em pipeline de conteúdo e fazem engenharia reversa de vídeos virais com segurança contra prompt injection.

---

## 2. OBJETIVOS E MÉTRICAS DE SUCESSO

| # | Objetivo | Métrica verificável | Meta |
|---|----------|---------------------|------|
| O-01 | Fonte inédita de ideias vindas da audiência | Tool retorna ≥ 5 ideias acionáveis por análise | 100% das análises de canais ativos |
| O-02 | Engenharia reversa real de virais (não chute) | Tool extrai estrutura completa (hook+payoff+CTAs) com timestamps | 90%+ acurácia em vídeos com captions |
| O-03 | Diferencial NLP — nenhum concorrente faz | Comparativo público vs VidIQ/TubeBuddy | 1 post técnico publicado |
| O-04 | Custo controlado | Custo médio por análise de comentários | ≤ $0.005 (Haiku) |
| O-05 | Robustez contra prompt injection | Red team de 20 comentários adversariais | 0 instruções vazadas para o LLM |

---

## 3. STAKEHOLDERS

| Papel | Nome / Time | Interesse principal |
|-------|-------------|---------------------|
| Product Owner | Wanderson Leandro (Dewtech) | Validar valor das insights NLP |
| Tech Lead | Wanderson Leandro (Dewtech) | Mitigação de prompt injection, custo Haiku/Sonnet |
| Usuário Final | Criadores YouTube em fase de crescimento | Descobrir o que a audiência quer, replicar virais |
| Security Team (interno) | — | Validar que comentários adversariais não comprometem o sistema |
| Anthropic | — | Conformidade com Usage Policies |

---

## 4. REQUISITOS FUNCIONAIS

### Tool 1: `analyze_video_comments`

| ID | Requisito | Prioridade | Critério de aceite |
|----|-----------|------------|--------------------|
| RF-3.1 | Buscar top 100-200 comentários via `commentThreads.list` | MUST | Aceita `videoId` + `maxComments` (default 100, max 500) |
| RF-3.2 | Sentiment analysis agregada (% positivo / negativo / neutro) | MUST | Output: tabela de % com confidence |
| RF-3.3 | Extrair top 10 dores mais mencionadas | MUST | Lista numerada com frequência absoluta |
| RF-3.4 | Extrair top 10 perguntas frequentes | MUST | Lista de perguntas reais (não inferidas) |
| RF-3.5 | Extrair pedidos de tema agrupados ("podia fazer um sobre X") | MUST | Agrupamento semântico via Claude |
| RF-3.6 | Separar críticas construtivas de hate | SHOULD | Categorização binária com exemplos |
| RF-3.7 | Gerar 5 ideias de próximos vídeos baseado em dores+perguntas | MUST | Cada ideia com título sugerido + justificativa |
| RF-3.8 | Identificar comentários âncora (mais curtidos, mais respondidos) | SHOULD | Top 5 ordenados por `likeCount + replyCount * 2` |
| RF-3.9 | Sanitização obrigatória de comentários antes do prompt LLM | MUST | Wrapper `<comment>...</comment>` + remoção de instruções diretas |

### Tool 2: `analyze_video_transcript`

| ID | Requisito | Prioridade | Critério de aceite |
|----|-----------|------------|--------------------|
| RF-3.10 | Baixar captions via `captions.list` + `captions.download` | MUST | Try `pt`, `pt-BR`, `en`, `es` em ordem; falhar gracioso se nenhuma |
| RF-3.11 | Fallback: scrape de página pública se captions desabilitadas | COULD | Marcar como "best effort" no output |
| RF-3.12 | Extrair estrutura: hook (0-15s), intro (15-45s), payoff, CTAs com timestamps | MUST | Output em seções markdown com timestamps |
| RF-3.13 | Detectar palavras-gatilho faladas (não escritas no título) | SHOULD | Lista top 20 palavras de alta densidade |
| RF-3.14 | Calcular densidade de informação (palavras/min) por bloco | SHOULD | Tabela timestamp → palavras/min |
| RF-3.15 | Identificar tipos de hooks usados (problema, pergunta, estatística, história, controvérsia) | MUST | Enum classificado pelo Claude |
| RF-3.16 | Identificar CTAs detectados (inscreva-se, like, comentário, link, próximo vídeo) | MUST | Lista com timestamp de cada CTA |
| RF-3.17 | Gerar sumário automático por tópicos com timestamp | MUST | Bullet points: "X:XX — [tópico]" |
| RF-3.18 | Identificar padrões de retenção previstos (loops abertos, pattern interrupts, callbacks) | SHOULD | Lista de técnicas detectadas |

### Tool 3: `reverse_engineer_viral_video`

| ID | Requisito | Prioridade | Critério de aceite |
|----|-----------|------------|--------------------|
| RF-3.19 | Combinar análise de comentários + transcript + thumbnail (Camada 2) | MUST | Output unificado em markdown |
| RF-3.20 | Gerar hipótese de "por que esse vídeo viralizou" | MUST | Seção com 3-5 fatores ranqueados |
| RF-3.21 | Sugerir como replicar para nicho informado | MUST | Seção "Aplicação ao seu nicho" |
| RF-3.22 | Template de roteiro inspirado | SHOULD | Roteiro pronto para customizar (~300 palavras) |
| RF-3.23 | Template de thumbnail inspirada (descrição) | SHOULD | Descrição textual + paleta de cores |

---

## 5. REQUISITOS NÃO-FUNCIONAIS

| ID | Categoria | Requisito | Meta |
|----|-----------|-----------|------|
| RNF-3.1 | Performance | `analyze_video_comments` em 100 comments | < 15 segundos |
| RNF-3.2 | Performance | `analyze_video_transcript` para vídeo de 15 min | < 20 segundos |
| RNF-3.3 | Performance | `reverse_engineer_viral_video` end-to-end | < 60 segundos |
| RNF-3.4 | Segurança | 0 falhas de prompt injection em red team de 20 comments adversariais | 100% pass |
| RNF-3.5 | Segurança | Zero armazenamento de comentários brutos no disco | Inspeção pós-execução |
| RNF-3.6 | Custo | Comentários: ≤ $0.005/análise (Haiku) | Audit log valida |
| RNF-3.7 | Custo | Transcrições: ≤ $0.02/análise (Sonnet) | Audit log valida |
| RNF-3.8 | Observabilidade | Audit log de cada chamada LLM + custo estimado | Tag `NLP_LLM_CALL` |
| RNF-3.9 | Manutenibilidade | Cobertura de testes | ≥ 80% incluindo red team |
| RNF-3.10 | Compatibilidade | Reuso de cache da Camada 1 | TTL 24h comments, 7d transcripts |

---

## 6. REQUISITOS DE SEGURANÇA

| ID | Requisito | Referência |
|----|-----------|------------|
| RS-3.1 | **Prompt injection mitigation**: comentários SEMPRE encapsulados em `<comment idx="N">...</comment>` no prompt do sistema | OWASP LLM01 |
| RS-3.2 | Prompt do sistema **fixo** e versionado em código (sem interpolação de input do usuário) | OWASP LLM01 |
| RS-3.3 | Validação de output do LLM: rejeitar respostas que vazam instruções ou dados de prompt | OWASP LLM02 |
| RS-3.4 | Não armazenar comentários brutos — apenas a análise resultante | OWASP A02 (Data Exposure) |
| RS-3.5 | Filtrar PII detectada nos comentários (emails, telefones) antes do LLM | OWASP A02 |
| RS-3.6 | YouTube videoId validado via Zod (formato regex `[a-zA-Z0-9_-]{11}`) | OWASP A03 |
| RS-3.7 | `captions.download` requer escopo OAuth — verificar antes de chamar | OWASP A01 |
| RS-3.8 | Cap diário de chamadas LLM (`NLP_DAILY_BUDGET_USD`) configurável | OWASP A04 (Resource Exhaustion) |
| RS-3.9 | Auditoria de `@anthropic-ai/sdk` sem CVE HIGH/CRITICAL | OWASP A06 |
| RS-3.10 | Red team CI: suite de 20 comments adversariais executa em cada PR | OWASP LLM01 |

---

## 7. STACK TÉCNICA

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Linguagem / Runtime | TypeScript / Node.js | TS 5.7+, Node ≥ 20 |
| LLM SDK | `@anthropic-ai/sdk` | ^0.32.x |
| YouTube API client | `googleapis` | 171.4.0 |
| Cache | SQLite (Camada 1) | dependência interna |
| Validation | `zod` | 3.25.28 |
| Captions parser | `subsrt-ts` ou custom (parsing SRT/VTT) | latest |
| PII detection | regex próprio (não adicionar libs pesadas) | — |
| Testing | `vitest` + red team suite | 4.1.5 |

---

## 8. INTEGRAÇÕES EXTERNAS

| Sistema | Tipo | Protocolo | Direção | Dados trocados | Responsável |
|---------|------|-----------|---------|----------------|-------------|
| Claude API (Haiku) | LLM texto | HTTPS | Saída | Comentários sanitizados + prompt; análise estruturada | Anthropic |
| Claude API (Sonnet) | LLM texto | HTTPS | Saída | Transcrição completa + prompt; estrutura extraída | Anthropic |
| YouTube Data API v3 | API REST | HTTPS | Saída | `commentThreads.list`, `captions.list`, `captions.download` | Google |
| Página pública YouTube | HTML scrape (fallback) | HTTPS | Entrada | HTML para extrair captions se API falhar | Google |

---

## 9. RESTRIÇÕES

- **Prazo:** Sprint 2-3 do Tubemind v0.2 (depende de Camada 1)
- **Orçamento:** Custo NLP por usuário ~$2-10/mês estimado
- **Limitações técnicas:**
  - `captions.download` requer OAuth scope `youtube.force-ssl` (já presente)
  - Captions auto-geradas (sem revisão humana) têm qualidade variável
  - Scraping fallback pode quebrar se YouTube mudar HTML
- **Compliance:**
  - GDPR/LGPD: não armazenar comentários (que podem conter PII)
  - YouTube ToS: respeitar `commentThreads.list` rate limits
  - Anthropic Usage Policies: não enviar conteúdo NSFW/ofensivo (filtrar)

---

## 10. FORA DO ESCOPO (v0.2)

- **Tradução automática** de comentários multilíngues — Claude já entende multi-idioma nativo
- **Resposta automática** a comentários (Tubemind é read-only por design)
- **Detecção de bots** em comentários — out of scope
- **Sentiment ao longo do tempo** (histórico) — adiado, requer scheduled jobs
- **Análise de live chat** de transmissões — endpoint diferente, adiado
- **Speaker diarization** em transcrições — Claude não faz, requer modelo separado
- **Detecção de música/B-roll** em transcrições — fora do core

---

## 11. RISCOS E MITIGAÇÕES

| # | Risco | Probabilidade | Impacto | Mitigação |
|---|-------|---------------|---------|-----------|
| R-3.1 | **Prompt injection via comentário adversário** | Alta | Crítico | RS-3.1 (wrapper XML), RS-3.2 (prompt fixo), RS-3.3 (validação output), red team CI |
| R-3.2 | Captions indisponíveis (criador desabilita) | Alta | Médio | Fallback scrape; mensagem clara "transcrição não disponível" |
| R-3.3 | Quality de auto-captions ruim → análise pobre | Média | Médio | Indicar no output "análise baseada em auto-caption (qualidade variável)" |
| R-3.4 | Custo LLM explodir em uso intenso | Média | Alto | Cap diário, cache obrigatório, alerta em 70% |
| R-3.5 | PII vazar para Anthropic via comentários | Baixa | Alto | RS-3.5 (filtro regex), Anthropic é zero-retention sob enterprise tier |
| R-3.6 | YouTube revogar `captions.download` (já fez no passado) | Baixa | Alto | Manter scrape fallback como contingência |
| R-3.7 | Comentários ofensivos causam Anthropic recusar | Média | Baixo | Try/catch, retry com nota "alguns comentários filtrados" |
| R-3.8 | `commentThreads.list` paginação cara em quota (1 unit/page) | Média | Baixo | Cache agressivo, limite max 500 comments |
| R-3.9 | Vídeo com comentários desabilitados | Alta | Baixo | Detectar via API response, retornar mensagem clara |

---

## 12. CHECKLIST DE APROVAÇÃO

- [ ] Requisitos funcionais (RF-3.1 a RF-3.23) revisados
- [ ] Estratégia anti prompt injection (RS-3.1, RS-3.2, RS-3.3) validada pelo Tech Lead
- [ ] Custo NLP por usuário ($2-10/mês) aceitável
- [ ] Política de não-armazenamento de comentários brutos confirmada
- [ ] Red team suite (20 comments adversariais) definida e revisada
- [ ] Escopo OAuth `youtube.force-ssl` confirmado (já presente)
- [ ] Filtro de PII com regex revisado por security
- [ ] Cap de orçamento diário `NLP_DAILY_BUDGET_USD` definido
- [ ] Fallback de scraping documentado como "best effort"
