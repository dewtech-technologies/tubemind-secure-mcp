# DESIGN: Tubemind v0.2 — Camada 4: Pipeline de Produção (Script + Description + Prediction + Workflows)

> **Versão:** v1.0 | **Data:** 2026-05-23 | **Status:** APROVADO

---

## 1. DESCRIÇÃO

Camada que fecha o ciclo **descoberta → produção** do `tubemind-secure-mcp`, entregando artefatos prontos para uso (roteiros completos, descrições SEO-otimizadas, previsões de performance) e workflows orquestrados que combinam todas as Camadas 1-3. Resolve o problema de criadores terem inteligência de descoberta mas ainda precisarem horas para transformar insights em produção final. Entrega 4 novas tools e 4 workflows pré-construídos.

---

## 2. OBJETIVOS E MÉTRICAS DE SUCESSO

| # | Objetivo | Métrica verificável | Meta |
|---|----------|---------------------|------|
| O-01 | Fechar ciclo descoberta → produção (sem sair do Claude) | Usuário publica vídeo apenas com saída do Tubemind | 5+ casos documentados pós-launch |
| O-02 | Roteiros usando dados reais do nicho (não genéricos) | Roteiro referencia padrões das Camadas 1-3 explicitamente | 100% dos roteiros |
| O-03 | Descrições com SEO score alto | Benchmark vs descrições top do nicho | ≥ 85% de keywords-alvo cobertas |
| O-04 | Previsão calibrada de performance | Backtest: erro médio de views previstas vs reais | ≤ 30% MAPE em 7d |
| O-05 | Workflows reduzem tempo de planning | "weekly_planning" do início ao fim | < 3 minutos |

---

## 3. STAKEHOLDERS

| Papel | Nome / Time | Interesse principal |
|-------|-------------|---------------------|
| Product Owner | Wanderson Leandro (Dewtech) | Aprovação de scope dos workflows, qualidade dos roteiros |
| Tech Lead | Wanderson Leandro (Dewtech) | Orquestração de tools (Camadas 1-3), custo, latência |
| Usuário Final | Criadores YouTube avançados + agências | Pipeline pronto, previsão honesta, workflows que economizam horas |
| Compliance / Legal (interno) | — | Disclaimers em nichos regulados (financeiro, médico) |

---

## 4. REQUISITOS FUNCIONAIS

### Tool 1: `generate_full_script`

| ID | Requisito | Prioridade | Critério de aceite |
|----|-----------|------------|--------------------|
| RF-4.1 | Inputs: `topic`, `niche`, `duration_minutes` (5/10/15/20), `tone`, `audience`, `competitor_video_id?` | MUST | Schema Zod com discriminated tone enum |
| RF-4.2 | Hook (0-15s): 3 opções com recomendada marcada | MUST | Output tem 3 hooks numerados + badge ⭐ no melhor |
| RF-4.3 | Intro/promessa (15-45s) | MUST | Seção dedicada com 50-80 palavras |
| RF-4.4 | Corpo: 3-5 seções com timestamp, pontos, transição | MUST | Cada seção em bloco markdown com `### XX:XX — [Seção]` |
| RF-4.5 | Pattern interrupts marcados em pontos de queda de retenção | SHOULD | Usar dados de `analyze_retention_signals` (Camada 1 base + transcripts Camada 3) |
| RF-4.6 | CTAs distribuídos no momento certo (não no início) | MUST | CTA-1 em ~25% do vídeo, CTA-2 em ~75% |
| RF-4.7 | Call-back para o hook na conclusão | MUST | Seção "Fechamento do loop" |
| RF-4.8 | Outro + sugestão de próximo vídeo | MUST | Última seção sempre presente |
| RF-4.9 | B-rolls sugeridos por seção | SHOULD | Lista por seção: "B-roll: [descrição visual]" |
| RF-4.10 | Pontos para jump cuts | COULD | Marcação "[CUT]" em pontos de transição rápida |
| RF-4.11 | Se `competitor_video_id` fornecido: invoca `reverse_engineer_viral_video` (Camada 3) | MUST | Roteiro incorpora padrões do vídeo referência |

### Tool 2: `optimize_video_description`

| ID | Requisito | Prioridade | Critério de aceite |
|----|-----------|------------|--------------------|
| RF-4.12 | Inputs: `title`, `tags`, `transcript?`, `timestamps?` | MUST | Schema Zod com `transcript` e `timestamps` opcionais |
| RF-4.13 | Primeira frase com keyword principal natural (zero keyword stuffing) | MUST | Validação Claude: primeira frase tem keyword + soa natural |
| RF-4.14 | Resumo expandido 150-200 palavras | MUST | Word count entre 150-200 |
| RF-4.15 | Capítulos automáticos se transcript fornecido | SHOULD | Output: "00:00 - Intro\n02:15 - [Tópico]..." |
| RF-4.16 | Keywords distribuídas naturalmente | MUST | Densidade ≤ 3% por keyword (anti-stuffing) |
| RF-4.17 | CTAs estruturados (inscreva-se, redes, próximos vídeos) | MUST | Seção fixa "🔔 Inscreva-se" + slots para customizar |
| RF-4.18 | 3-5 hashtags relevantes | MUST | Algoritmo sweet spot detectado em pesquisa |
| RF-4.19 | Links com UTM tracking sugeridos | SHOULD | Output: "Use `?utm_source=youtube&utm_medium=video&utm_campaign=[slug]`" |
| RF-4.20 | Disclaimer/aviso legal por nicho (afiliados, médico, financeiro) | SHOULD | Detectar nicho regulado e incluir disclaimer apropriado |

### Tool 3: `predict_video_performance`

| ID | Requisito | Prioridade | Critério de aceite |
|----|-----------|------------|--------------------|
| RF-4.21 | Inputs: `title`, `thumbnail_url?`, `niche`, `channel_id`, `publish_date?` | MUST | Schema Zod com opcionais |
| RF-4.22 | Views previstas em 7d / 30d / 90d (faixa min-max + confidence) | MUST | Output: tabela com 3 janelas + CI |
| RF-4.23 | CTR previsto (combina `estimate_ctr_potential` v0.1 + thumb score Camada 2) | MUST | Score 0-100 com breakdown |
| RF-4.24 | Retenção prevista (combina `analyze_retention_signals`) | MUST | Score 0-100 com fatores |
| RF-4.25 | Score de viralidade combinado (0-100) | MUST | Fórmula documentada e justificada |
| RF-4.26 | Recomendação binária: 🟢 PRODUZIR / 🟡 AJUSTAR / 🔴 ABANDONAR | MUST | Thresholds: ≥70 / 40-69 / <40 |
| RF-4.27 | Lista priorizada de ajustes para melhorar previsão | MUST | Top 5 ajustes numerados |
| RF-4.28 | Janela de publicação ideal (cruzamento com `score_best_publish_window`) | SHOULD | Output: "Publicar em [dia/hora] eleva score em +X pontos" |
| RF-4.29 | Disclaimer: "⚠️ Estimativa baseada em heurísticas — não é predição ML" | MUST | Presente em 100% das saídas |

### Tool 4: `run_workflow` — Workflows pré-construídos

| ID | Requisito | Prioridade | Critério de aceite |
|----|-----------|------------|--------------------|
| RF-4.30 | Workflow `launch_new_channel`: análise de mercado + calendário 30d + 10 roteiros + 10 thumbs sugeridas | MUST | Output unificado executando ≥8 tools |
| RF-4.31 | Workflow `revive_dead_channel`: diagnóstico declínio + plano recuperação | MUST | Output com análise histórica + plano 30d |
| RF-4.32 | Workflow `weekly_planning`: trending + gaps + calendário 7d | MUST | Executa em < 3 min |
| RF-4.33 | Workflow `competitor_takedown`: análise concorrente + estratégia + 5 vídeos sugeridos | MUST | Output inclui reverse-engineering Camada 3 |
| RF-4.34 | Cada workflow expõe pre-flight check com custo + tempo estimado | MUST | Output prefix: "Estimativa: $X.XX em ~Y min" |
| RF-4.35 | Workflows podem ser interrompidos sem perder progresso parcial | SHOULD | Cache intermediário salvo a cada step |

---

## 5. REQUISITOS NÃO-FUNCIONAIS

| ID | Categoria | Requisito | Meta |
|----|-----------|-----------|------|
| RNF-4.1 | Performance | `generate_full_script` | < 30 segundos |
| RNF-4.2 | Performance | `optimize_video_description` | < 15 segundos |
| RNF-4.3 | Performance | `predict_video_performance` | < 10 segundos (sem thumbnail), < 30s com |
| RNF-4.4 | Performance | Workflow `weekly_planning` | < 3 minutos |
| RNF-4.5 | Performance | Workflow `launch_new_channel` | < 10 minutos |
| RNF-4.6 | Custo | Roteiro completo | ~$0.02 (Sonnet) |
| RNF-4.7 | Custo | Workflow `launch_new_channel` | ~$0.50 total |
| RNF-4.8 | Disponibilidade | Falha graceful se Camada 2/3 indisponível (sem `ANTHROPIC_API_KEY`) | Roteiro funciona com Camada 1+ heurísticas v0.1 |
| RNF-4.9 | Observabilidade | Audit log de cada workflow com timing por step | Tag `WORKFLOW_STEP` no audit |
| RNF-4.10 | Manutenibilidade | Cobertura testes ≥ 75% (workflows são integração) | Vitest + mocks de Camadas 1-3 |
| RNF-4.11 | Honestidade | Previsões sempre com disclaimer de "heurística, não ML" | Validação automatizada do output |

---

## 6. REQUISITOS DE SEGURANÇA

| ID | Requisito | Referência |
|----|-----------|------------|
| RS-4.1 | Inputs de roteiro validados via Zod (tone enum, duration ∈ {5,10,15,20}) | OWASP A03 |
| RS-4.2 | Prompt do sistema para geração de roteiro: fixo, sem interpolar `topic` direto (usar wrapper `<topic>...</topic>`) | OWASP LLM01 |
| RS-4.3 | Output do LLM validado: nunca executar/interpretar como código | OWASP LLM02 |
| RS-4.4 | Disclaimer obrigatório em previsões (RF-4.29) — não pode ser bypassado | OWASP A04 |
| RS-4.5 | Workflows respeitam cap de orçamento por usuário (`WORKFLOW_DAILY_BUDGET_USD`) | OWASP A04 (Resource Exhaustion) |
| RS-4.6 | Detecção de nicho regulado (financeiro, médico, jurídico) → disclaimer mandatório no description | Compliance |
| RS-4.7 | Channel_id validado via Zod (formato YouTube) | OWASP A03 |
| RS-4.8 | Auditoria de deps sem CVE HIGH/CRITICAL | OWASP A06 |
| RS-4.9 | Audit log de cada chamada workflow + custo acumulado | OWASP A09 |
| RS-4.10 | Anti-tampering: scores não podem ser manipulados via input (ex: forçar score 100) | OWASP A04 |

---

## 7. STACK TÉCNICA

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Linguagem / Runtime | TypeScript / Node.js | TS 5.7+, Node ≥ 20 |
| LLM SDK | `@anthropic-ai/sdk` | ^0.32.x |
| Orquestração | Promises nativas + queue interno simples | nativo |
| Cache | SQLite (Camada 1) | dependência interna |
| Validation | `zod` | 3.25.28 |
| YouTube API | `googleapis` | 171.4.0 |
| Testing | `vitest` + integração com mocks Camadas 1-3 | 4.1.5 |

---

## 8. INTEGRAÇÕES EXTERNAS

| Sistema | Tipo | Protocolo | Direção | Dados trocados | Responsável |
|---------|------|-----------|---------|----------------|-------------|
| Claude API (Sonnet) | LLM | HTTPS | Saída | Prompts para script/description; outputs estruturados | Anthropic |
| YouTube Data API v3 | API REST | HTTPS | Saída | Channel/video metadata para previsão | Google |
| **Tubemind Camada 1** | Interno | direct call | Bidir | Cache, quota, batch | Internal |
| **Tubemind Camada 2** | Interno | direct call | Bidir | Análise de thumbnail | Internal |
| **Tubemind Camada 3** | Interno | direct call | Bidir | Análise de comentários/transcripts | Internal |

---

## 9. RESTRIÇÕES

- **Prazo:** Sprint 3-4 do Tubemind v0.2 (depende de Camadas 1, 2 e 3)
- **Orçamento:** Custo pipeline ~$5-20/mês por usuário ativo (depende uso)
- **Limitações técnicas:**
  - Roteiros longos (20+ min) podem exceder context window do Sonnet — limitar a 20 min max
  - Workflows com 10+ tools podem atingir timeout do cliente MCP (Claude Desktop default 60s) — usar progresso parcial
  - Previsão de views é heurística, não ML real
- **Compliance:**
  - Disclaimers obrigatórios em nichos regulados (RS-4.6)
  - Não gerar conteúdo que viole policies do YouTube (sex, hate, violence)

---

## 10. FORA DO ESCOPO (v0.2)

- **ML real de previsão** (treinar modelo próprio com dados históricos) — adiado para v0.3, requer dataset
- **Geração de thumbnail real** (não só descrição) — uso de nanobanana/Midjourney separado
- **Voiceover automático** — out of scope, há ferramentas dedicadas (ElevenLabs)
- **Edição de vídeo automática** — out of scope, CapCut/Descript existem
- **Tradução de roteiros** — Claude já traduz, mas não automatizamos pipeline
- **A/B testing real** (publicar 2 versões e medir) — requer integração escrita avançada
- **Workflows customizados pelo usuário** (DSL) — adiado, foco em 4 pré-construídos
- **Pipeline de Shorts dedicado** — adiado para v0.3

---

## 11. RISCOS E MITIGAÇÕES

| # | Risco | Probabilidade | Impacto | Mitigação |
|---|-------|---------------|---------|-----------|
| R-4.1 | Roteiros genéricos demais (sem usar dados reais) | Alta | Alto | Validação em testes: roteiro DEVE referenciar ≥3 dados de Camadas 1-3 |
| R-4.2 | Previsões erradas geram falsa confiança no usuário | Alta | Alto | Disclaimer obrigatório (RS-4.4); intervalos amplos de confidence |
| R-4.3 | Workflow `launch_new_channel` muito caro ($0.50+) afasta usuários | Média | Médio | Pre-flight check; opção "lite" sem Camada 2/3 |
| R-4.4 | Timeout do cliente MCP em workflows longos | Alta | Médio | Streaming de progresso; salvar resultado parcial em cache |
| R-4.5 | Conteúdo gerado viola policies YouTube | Baixa | Alto | Detector de palavras-chave proibidas antes de gerar |
| R-4.6 | Custo LLM explodir em pico de uso | Média | Alto | Cap diário; rate limit por workflow |
| R-4.7 | Tom inconsistente entre seções do roteiro | Média | Baixo | Prompt único para roteiro completo (não chunked) |
| R-4.8 | Descrição com keyword stuffing detectado pelo YouTube | Baixa | Médio | Validação de densidade ≤ 3% por keyword |
| R-4.9 | Workflows quebrarem se Camada 2/3 indisponível | Média | Médio | Fallback gracioso para versão "lite" só com Camada 1 + v0.1 |
| R-4.10 | Disclaimers regulados (médico/financeiro) inadequados → risco legal | Baixa | Alto | Templates de disclaimer revisados por jurídico; opção "consultar advogado" |

---

## 12. CHECKLIST DE APROVAÇÃO

- [ ] Requisitos funcionais (RF-4.1 a RF-4.35) revisados
- [ ] 4 workflows priorizados aprovados pelo Product Owner
- [ ] Custo estimado por workflow aceitável ($0.10-0.50)
- [ ] Disclaimers obrigatórios (previsão + nichos regulados) revisados
- [ ] Estratégia de fallback "lite" sem Camadas 2/3 documentada
- [ ] Estratégia de streaming/progresso parcial em workflows longos definida
- [ ] Templates de disclaimer para nichos regulados revisados por legal
- [ ] Backtest plan para validação de previsões definido
- [ ] Lista de palavras-chave proibidas (anti-policy violation) compilada
