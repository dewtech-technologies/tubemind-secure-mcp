<h1 align="center">tubemind-secure-mcp</h1>

<p align="center">
  <b>YouTube intelligence, powered by Claude. Secure by design.</b><br/>
  Model Context Protocol server with 18 tools for YouTube research, analytics, benchmarking and content strategy.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/tubemind-secure-mcp"><img src="https://img.shields.io/npm/v/tubemind-secure-mcp?style=flat-square&color=CB3837&logo=npm" alt="npm version"/></a>
  <a href="https://www.npmjs.com/package/tubemind-secure-mcp"><img src="https://img.shields.io/npm/dm/tubemind-secure-mcp?style=flat-square" alt="downloads"/></a>
  <a href="https://github.com/dewtech-technologies/tubemind-secure-mcp/blob/main/SECURITY.md"><img src="https://img.shields.io/badge/security-OWASP_Top_10-5A67D8?style=flat-square" alt="OWASP"/></a>
  <a href="https://github.com/dewtech-technologies/tubemind-secure-mcp/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/tubemind-secure-mcp?style=flat-square&color=blue" alt="MIT License"/></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-1.26-5A67D8?style=flat-square" alt="MCP SDK"/></a>
</p>

<p align="center">
  <b>📦 18 tools · 🔐 OAuth2 + AES-256-GCM · 🛡️ OWASP Top 10 · 🤖 Claude Desktop ready</b>
</p>

---

## 🎯 Why tubemind-secure-mcp?

> Turn Claude into a **YouTube growth strategist** — without ever handing it your raw OAuth tokens.

- ⚡ **Plug-and-play with Claude Desktop** — drop one config block, get 18 production tools.
- 🔐 **Secure by default** — tokens encrypted at rest (AES-256-GCM), SSRF guard, rate limiting, audit log, Zod-validated inputs. **OWASP Top 10** mapped end-to-end.
- 📊 **Real data, not scraping** — official YouTube Data API v3 + YouTube Analytics API. Brand Accounts supported.
- 🧠 **Beyond raw API** — built-in heuristics for CTR, retention, keyword difficulty, content gaps, hook angles and N-day content calendars.
- 🪶 **Tiny footprint** — 3 runtime deps (`@modelcontextprotocol/sdk`, `googleapis`, `zod`). Node ≥ 20.

---

## ✨ Overview

`tubemind-secure-mcp` is a **Model Context Protocol (MCP) server** that gives Claude Desktop (and any MCP client) **18 production-grade tools** for working with YouTube:

- 🔍 **Search & SEO** — trending topics, keyword stats, tag suggestions
- 📺 **Video & Channel** — list videos, read/update metadata, get tags
- 📊 **Analytics** — channel analytics (views, watch time, retention) via YouTube Analytics API
- 🏆 **Benchmark** — compare your channel against competitors
- 🧠 **Heuristics** — keyword difficulty, title patterns, content gaps, hook angles, CTR potential, retention signals, content calendar
- 🕵️ **Competitor research** — competitor video discovery

Built **secure by design**: OAuth2 (Brand Account ready), AES-256-GCM token encryption at rest, SSRF guard, rate limiting, audit logging, Zod input validation — mapped to **OWASP Top 10**.

---

## 📦 Installation

```bash
# Global install
npm install -g tubemind-secure-mcp

# Or run on demand
npx tubemind-secure-mcp
```

Requires **Node.js ≥ 20**.

---

## 🔐 OAuth Setup (one-time)

YouTube APIs need an OAuth2 token. The package ships with an auth server that walks you through it.

### 1) Create OAuth credentials in Google Cloud

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Enable **YouTube Data API v3** and **YouTube Analytics API**
3. Create OAuth 2.0 Client ID → **Web application**
4. Authorized redirect URI: `http://localhost:4000/oauth/callback`
5. Copy the **Client ID** and **Client Secret**

### 2) Configure environment

Copy `.env.example` to `.env` and fill in:

```bash
YOUTUBE_CLIENT_ID=your-client-id.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=your-client-secret
YOUTUBE_REDIRECT_URI=http://localhost:4000/oauth/callback

# Generate with: openssl rand -hex 32
TOKEN_ENCRYPTION_KEY=your-64-char-hex-key

RATE_LIMIT_PER_MINUTE=60
REQUEST_TIMEOUT_MS=10000
AUDIT_LOG_PATH=./logs/audit.log
NODE_ENV=production
```

### 3) Run the OAuth flow

```bash
pnpm auth
# or: npx tsx --env-file=.env src/auth-server.ts
```

Open `http://localhost:4000`, sign in with the Google account that owns the channel (Brand Accounts supported), authorize, and the encrypted token is saved to `./tokens/youtube.token.json`.

---

## 🤖 Use with Claude Desktop

Add to `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "tubemind": {
      "command": "npx",
      "args": ["-y", "tubemind-secure-mcp"],
      "env": {
        "YOUTUBE_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "YOUTUBE_CLIENT_SECRET": "your-client-secret",
        "YOUTUBE_REDIRECT_URI": "http://localhost:4000/oauth/callback",
        "TOKEN_ENCRYPTION_KEY": "your-64-char-hex-key",
        "RATE_LIMIT_PER_MINUTE": "60",
        "REQUEST_TIMEOUT_MS": "10000",
        "AUDIT_LOG_PATH": "./logs/audit.log",
        "NODE_ENV": "production"
      }
    }
  }
}
```

Restart Claude Desktop. The 18 tools will appear automatically.

---

## 🛠️ Tools

| Category | Tool | Description |
|----------|------|-------------|
| **Search** | `search_trending_topics` | Discover trending topics by region/category |
| | `get_keyword_stats` | Search volume signals for keywords |
| | `suggest_tags` | Tag recommendations from a seed |
| **Video** | `get_video_tags` | Read tags from a video |
| | `update_video_metadata` | Update title/description/tags (write scope) |
| | `list_channel_videos` | Paginate channel uploads |
| **Analytics** | `get_channel_analytics` | Views, watch time, retention (Analytics API) |
| | `score_best_publish_window` | Best day/hour heatmap to publish |
| **Benchmark** | `benchmark_channel` | Compare channel vs. peers |
| **Heuristics** | `estimate_keyword_difficulty` | Difficulty score 0–100 |
| | `analyze_title_patterns` | Common patterns in top videos |
| | `detect_content_gaps` | Topics competitors cover that you don't |
| **Heuristics+** | `estimate_ctr_potential` | CTR estimate from title/thumbnail signals |
| | `suggest_hook_angles` | Hook angles for a topic |
| | `find_trending_keywords` | Rising-momentum keywords |
| | `analyze_retention_signals` | Retention-shaping factors |
| | `generate_content_calendar` | N-day content plan |
| **Competitor** | `get_competitor_videos` | Top videos from a competitor channel |

All inputs are validated with **Zod**. All errors return safe messages (stack traces only when `NODE_ENV=development`).

---

## 🔒 Security

`tubemind-secure-mcp` is built secure-by-default. See [SECURITY.md](./SECURITY.md) for the full posture mapped to OWASP Top 10.

| Control | Implementation |
|---------|----------------|
| **A01 — Broken Access Control** | OAuth2 scopes least-privilege, audit log per call |
| **A02 — Cryptographic Failures** | AES-256-GCM at rest for tokens, secrets via env only |
| **A03 — Injection** | Zod schemas on every tool input |
| **A04 — Insecure Design** | Rate limit, request timeout, SSRF guard (host whitelist) |
| **A05 — Misconfiguration** | `.env.example` template, no defaults that leak |
| **A07 — AuthN Failures** | OAuth2 PKCE-style flow, encrypted token storage |
| **A08 — Software/Data Integrity** | Pinned deps, `pnpm audit` in CI, dependabot |
| **A09 — Logging Failures** | Audit log of every tool call (timestamp, tool, success) |
| **A10 — SSRF** | Outbound calls restricted to `googleapis.com` family |

**Found a vulnerability?** Email **wleandro.oliveira@gmail.com** — 72h response.

---

## 🧰 Local development

```bash
pnpm install
pnpm dev          # tsx watch on src/index.ts
pnpm build        # tsc → dist/
pnpm typecheck
pnpm test
pnpm audit:security
```

---

## 📜 License

MIT © [Wanderson Leandro de Oliveira](https://github.com/wleandrooliveira) / [Dewtech](https://github.com/dewtech-technologies)
