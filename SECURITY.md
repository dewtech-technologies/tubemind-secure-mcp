# Security Policy — tubemind-secure-mcp

## Princípios

Este projeto segue o **OWASP Top 10** desde o design:

| OWASP | Controle |
|---|---|
| A01 Broken Access Control | OAuth scopes mínimos, validação de ownership |
| A02 Cryptographic Failures | AES-256-GCM para tokens, HTTPS only |
| A03 Injection | Zod validation em todos os inputs |
| A04 Insecure Design | Separação de camadas, least privilege |
| A05 Security Misconfiguration | Sem defaults inseguros, secrets via env |
| A06 Vulnerable Components | Dependabot + pnpm audit no CI |
| A07 Auth Failures | OAuth2 PKCE, state CSRF, rate limit |
| A08 Integrity Failures | Validação de schema nas respostas |
| A09 Logging & Monitoring | Audit log sem dados sensíveis |
| A10 SSRF | Whitelist de domínios, bloqueio de IPs privados |

## Reportar Vulnerabilidades

Encontrou uma vulnerabilidade? **Não abra uma issue pública.**

Entre em contato via: wleandro.oliveira@gmail.com

Inclua:
- Descrição da vulnerabilidade
- Passos para reproduzir
- Impacto estimado
- Sugestão de correção (opcional)

Resposta esperada em até **72 horas**.

## Escopo

- Código neste repositório
- Dependências diretas listadas em `package.json`

## Fora do Escopo

- Vulnerabilidades na YouTube Data API (reporte ao Google)
- Vulnerabilidades no Claude / MCP SDK (reporte à Anthropic)
