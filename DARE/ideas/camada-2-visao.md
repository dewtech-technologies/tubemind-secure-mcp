# Ideia — Camada 2: Análise Visual de Thumbnails (Claude Vision)

## Contexto

Nenhum dos concorrentes do Tubemind (VidIQ, TubeBuddy, Morningfame) faz análise visual real de thumbnails. Eles só analisam texto (título, tags, descrição). Isso é uma **lacuna gigante** porque:

- **CTR no YouTube é 50%+ definido pela thumbnail**, não pelo título
- Padrões visuais são tão importantes quanto padrões textuais
- Criadores de conteúdo perdem horas testando thumbnails sem dados

Eu quero que o Tubemind seja o **primeiro MCP YouTube com visão computacional de verdade**.

## O que quero construir

Uma nova tool: `analyze_thumbnail_visuals`

Que pega os top N vídeos de um nicho, baixa as thumbnails, e usa **Claude Vision API** para analisar cada uma em profundidade.

### Análises que quero por thumbnail

1. **Cores dominantes** (top 3 cores em HSL + percentual de cobertura)
2. **Presença de face** (sim/não + expressão: sorriso/choque/raiva/neutro)
3. **Texto na thumbnail** (OCR — quantas palavras, qual texto, tamanho relativo)
4. **Contraste/legibilidade** (score 0-100 — quão legível em mobile pequeno)
5. **Padrão dominante** (face-grande, texto-grande, mockup-produto, lifestyle, before-after, gráfico/chart)
6. **Score de clicabilidade** (0-100 baseado em heurísticas de CTR comprovadas)

### Análise agregada do nicho

Depois de analisar 10-20 thumbnails do nicho:
- Qual % usa face? Que expressões dominam?
- Qual paleta de cores domina? (vermelho choque? amarelo atenção? azul corporativo?)
- Quantas palavras de texto em média?
- Padrão visual #1, #2, #3 do nicho
- **Recomendação concreta**: "para esse nicho, use thumbnail com face surpresa + 3-5 palavras em amarelo sobre fundo vermelho"

### Tool complementar: `score_my_thumbnail`

Input: URL ou base64 de uma thumbnail proposta + nicho
Output: 
- Score 0-100
- Comparação com padrão do nicho
- Sugestões de melhoria específicas
- "Esta thumbnail está 73% alinhada com top performers — ajuste contraste do texto"

## Por que importa

- ✅ **Diferencial competitivo único** (nenhum concorrente faz)
- ✅ Fecha o ciclo: keyword → título → **thumbnail** → publicação
- ✅ Usuário pode iterar thumbnail antes de subir
- ✅ Marketing: "Tubemind = primeiro YouTube intelligence com visão"

## Como implementar (alto nível)

- Usar API do Anthropic (Claude Vision) — input image + prompt estruturado
- Cache obrigatório (análise de imagem é cara, ~$0.01 por thumbnail)
- Reusar cache da Camada 1 com TTL longo (7 dias — thumbnails raramente mudam)
- Limitar a max 20 thumbnails por análise (custo + tempo)
- Fallback gracioso se Vision API estiver indisponível

## Restrições

- Custo: cada chamada Vision API é paga (~$0.003-0.01)
- Privacidade: NÃO armazenar thumbnails localmente (apenas análise resultante)
- Rate limit próprio para Vision API (separado da YouTube API)
- Backward compat: Vision é OPCIONAL (env var `ANTHROPIC_API_KEY`)
- Sanitização: remover EXIF de qualquer imagem processada

## Definição de "feito"

- [ ] Tool `analyze_thumbnail_visuals` retornando análise rica em markdown
- [ ] Tool `score_my_thumbnail` aceitando URL ou base64
- [ ] Cache de análises (reduz custo em 90%+ em uso repetido)
- [ ] Documentação clara sobre custo Vision API
- [ ] Testes com thumbnails reais (snapshot testing)
- [ ] Manter OWASP A03 (sanitizar input de imagem antes de mandar pra Claude)
