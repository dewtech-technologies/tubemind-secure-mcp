# Google OAuth Verification — tubemind-secure-mcp

Checklist mestra para submeter o app à verificação gratuita do Google.

> **Free path**: scopes sensitive + restricted, sem CASA, ~4–6 semanas de review.
> **CASA Tier 2** ($4–10k/ano) só é necessária se Google exigir explicitamente após a primeira rodada — para `youtube` e `youtube.upload` é provável; nesse caso você decide se segue ou se dropa esses scopes e ressubmete.

---

## Artefatos prontos neste repo

| Item | Local | O que fazer |
|------|-------|-------------|
| Privacy Policy | [`/docs/privacy.html`](../privacy.html) → `https://tubemind.dewtech.tech/privacy.html` | Já está pronto. URL pública após habilitar GitHub Pages. |
| Terms of Service | [`/docs/terms.html`](../terms.html) → `https://tubemind.dewtech.tech/terms.html` | Pronto. |
| Landing page | [`/docs/index.html`](../index.html) → `https://tubemind.dewtech.tech/` | Pronto. |
| Logo SVG | [`/docs/assets/logo.svg`](../assets/logo.svg) | Converter para **PNG 120×120** antes de enviar ao Google. |
| Scope justifications | [`./scope-justifications.md`](./scope-justifications.md) | Copy/paste no formulário, 1 caixa por scope. |
| Demo video script | [`./demo-video-script.md`](./demo-video-script.md) | Roteiro cena-a-cena pra gravar. |

---

## Checklist completa

### Pré-requisitos (uma vez só)

- [ ] **Habilitar GitHub Pages** no repo (`Settings → Pages → Source: /docs`)
- [ ] **DNS no Registro.br** para `dewtech.tech`:
      `CNAME tubemind → dewtech-technologies.github.io.`
- [ ] **Verificar HTTPS** em `https://tubemind.dewtech.tech/` (esperar propagar)
- [ ] **Verificar `dewtech.tech`** no Google Search Console via TXT no DNS
- [ ] **Confirmar** que a verificação do domínio aparece em `Google Cloud Console → APIs & Services → Domain verification`

### Logo PNG

- [ ] Converter `docs/assets/logo.svg` → PNG **120×120**
      (use https://cloudconvert.com/svg-to-png ou Inkscape)
- [ ] Salvar como `docs/assets/logo-120.png`

### OAuth Consent Screen — campos a preencher

Em `Google Cloud Console → APIs & Services → OAuth consent screen → Edit App`:

| Campo | Valor |
|-------|-------|
| App name | `tubemind-mcp-secure` |
| User support email | `wleandro.oliveira@gmail.com` |
| App logo | upload do PNG 120×120 |
| Application home page | `https://tubemind.dewtech.tech/` |
| Application privacy policy link | `https://tubemind.dewtech.tech/privacy.html` |
| Application terms of service link | `https://tubemind.dewtech.tech/terms.html` |
| Authorized domains | `dewtech.tech` |
| Developer contact email | `wleandro.oliveira@gmail.com` |

### Scopes — adicionar e justificar

Adicione no painel **Scopes** os 4 scopes:

- [ ] `https://www.googleapis.com/auth/youtube.readonly`
- [ ] `https://www.googleapis.com/auth/yt-analytics.readonly`
- [ ] `https://www.googleapis.com/auth/youtube`
- [ ] `https://www.googleapis.com/auth/youtube.upload`

Para cada um, cole as 3 respostas correspondentes do arquivo
[`scope-justifications.md`](./scope-justifications.md).

### Vídeo demo

- [ ] Seguir o roteiro em [`demo-video-script.md`](./demo-video-script.md)
- [ ] Gravar em 1080p, 2–4 min, voz em **inglês**
- [ ] Upload no YouTube como **unlisted**
- [ ] Título: `tubemind-secure-mcp — Google OAuth verification demo`
- [ ] Colar a URL unlisted no campo **Demo video** do formulário

### Submit

- [ ] Clicar **Submit for verification** no console
- [ ] Aguardar email do Google (2–6 semanas)
- [ ] Responder rapidamente se Google pedir esclarecimentos

---

## O que esperar do Google

1. **E-mail automático** ~5 min após submit confirmando recebimento.
2. **Primeira resposta** ~1–2 semanas: ou aprovação, ou pedido de mais informação (raramente aprovam de primeira para restricted).
3. Se Google pedir CASA para `youtube` + `youtube.upload`, você tem duas opções:
   - **Pagar Tier 2** (~$4–10k/ano) e seguir
   - **Dropar esses 2 scopes**, ficar só com `youtube.readonly` + `yt-analytics.readonly` (perde 1 tool: `update_video_metadata`) e ressubmeter — esses dois passam **sem CASA**.

## Status atual

- [x] Privacy Policy publicada
- [x] Terms of Service publicada
- [x] Landing page publicada
- [x] Scope justifications redigidas
- [x] Demo video script redigido
- [ ] GitHub Pages habilitado
- [ ] DNS configurado
- [ ] HTTPS validado
- [ ] Domain verified no Search Console
- [ ] Logo PNG 120×120 gerado
- [ ] OAuth Consent Screen preenchido
- [ ] Vídeo demo gravado
- [ ] Submetido à verificação
