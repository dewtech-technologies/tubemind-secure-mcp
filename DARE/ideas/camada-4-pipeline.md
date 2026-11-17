# Ideia — Camada 4: Pipeline de Produção (Script + Description + Prediction)

## Contexto

As Camadas 1-3 dão ao Tubemind **inteligência completa de descoberta**:
- O que pesquisar (keywords, gaps)
- Como o nicho se comporta (padrões de título, retenção, comentários)
- Como vídeos virais funcionam (transcrição, thumbnail)

Mas falta **fechar o loop até a produção**. Hoje o usuário pega os insights e ainda precisa:
1. Escrever o roteiro do zero
2. Escrever a descrição SEO-otimizada
3. Adivinhar se o vídeo vai performar

Quero que o Tubemind **gere artefatos prontos pra produção**, não só análises.

## O que quero construir

### Tool 1: `generate_full_script`

Input:
- `topic`: tópico do vídeo
- `niche`: nicho do canal
- `duration_minutes`: duração alvo (5, 10, 15, 20)
- `tone`: tom (educativo, descontraído, provocativo, técnico)
- `audience`: público-alvo
- `competitor_video_id`: (opcional) vídeo de referência para engenharia reversa

Output: roteiro COMPLETO em markdown:
- **Hook (0-15s)**: 3 opções, marcadas qual é a recomendada (baseado em `suggest_hook_angles`)
- **Intro/promessa (15-45s)**: setup do que será entregue
- **Corpo (3-5 seções)**: cada seção com timestamp sugerido, pontos principais, transição
- **Pattern interrupts**: marcados nos pontos onde retenção tende a cair (baseado em `analyze_retention_signals`)
- **CTAs distribuídos**: inscrição, like, comentário (no momento certo, não no início)
- **Call-back para o hook**: fecha o loop aberto
- **Outro + próximo vídeo sugestão**
- **B-rolls sugeridos** por seção (o que mostrar visualmente)
- **Pontos para corte rápido** (jump cuts)

### Tool 2: `optimize_video_description`

Input:
- `title`: título do vídeo
- `tags`: tags planejadas
- `transcript`: (opcional) transcrição do vídeo se já produzido
- `timestamps`: (opcional) capítulos definidos

Output: descrição otimizada com:
- **Primeira frase** com keyword principal natural (não keyword stuffing)
- **Resumo expandido** (150-200 palavras)
- **Capítulos automáticos** se transcrição fornecida (timestamps)
- **Keywords distribuídas** naturalmente ao longo do texto
- **CTAs estruturados**: inscreva-se, redes sociais, próximos vídeos
- **Hashtags relevantes** (3-5 — sweet spot do algoritmo)
- **Links com UTM tracking** sugeridos
- **Disclaimer/aviso legal** se nicho requer (afiliados, médico, financeiro)

### Tool 3: `predict_video_performance`

Input:
- `title`: título proposto
- `thumbnail_url`: URL da thumbnail (opcional, melhora previsão)
- `niche`: nicho
- `channel_id`: seu canal (para baseline histórica)
- `publish_date`: data planejada (opcional)

Output:
- **Views previstas** em 7d / 30d / 90d (faixa min-max com intervalo de confiança)
- **CTR previsto** (baseado em score do título + thumbnail)
- **Retenção prevista** (baseado em padrão do nicho)
- **Score de viralidade** (0-100, combinação de tudo)
- **Recomendação binária**: 🟢 PRODUZIR / 🟡 AJUSTAR / 🔴 ABANDONAR
- **Lista priorizada de ajustes** para melhorar a previsão
- **Janela de publicação ideal** (cruzamento com `score_best_publish_window`)

### Tool 4: `run_workflow` (Workflows Pré-construídos)

Workflows orquestrados que combinam várias tools:
- `launch_new_channel`: análise de mercado + calendário 30d + 10 roteiros + 10 thumbnails sugeridas
- `revive_dead_channel`: análise de declínio + diagnóstico + plano recuperação
- `weekly_planning`: trending da semana + gaps + calendário próximos 7d
- `competitor_takedown`: análise profunda + estratégia de diferenciação + 5 vídeos para "roubar" audiência

## Por que importa

- ✅ Fecha o loop **descoberta → produção** (sem precisar sair do Claude)
- ✅ Único MCP YouTube com geração de roteiros estruturados
- ✅ Workflows = produtividade 10x para criadores sérios
- ✅ Previsão de performance reduz risco de produzir vídeo flop

## Restrições

### Qualidade do roteiro

- NÃO pode ser genérico ("primeiro fale do problema, depois da solução")
- DEVE usar dados específicos do nicho (cruzando Camadas 1-3)
- DEVE ser editável (markdown estruturado, não prosa corrida)

### Previsão honesta

- Score é **heurístico**, não preditivo real
- Sempre marcar com `⚠️ Estimativa baseada em heurísticas`
- Não prometer precisão de ML — somos transparentes

### Custo

- `generate_full_script` é caro (~$0.02 por roteiro com Sonnet)
- Cache de roteiros NÃO faz sentido (input sempre único)
- Avisar usuário sobre custo antes de gerar

## Definição de "feito"

- [ ] 4 tools (script, description, prediction, workflow)
- [ ] Roteiros usando dados das Camadas 1-3 (não genéricos)
- [ ] Descrições otimizadas medidas vs benchmark (SEO score)
- [ ] Previsão calibrada em backtest (compara previsão vs vídeos reais)
- [ ] 4 workflows pré-construídos funcionando ponta-a-ponta
- [ ] Documentação com exemplos reais por workflow
