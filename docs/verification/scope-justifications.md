# OAuth Scope Justifications — tubemind-secure-mcp

> Copie/cole no formulário do Google OAuth Verification em
> **APIs & Services → OAuth consent screen → Edit App → Scopes**.
>
> Cada scope tem uma caixa de texto exigindo:
> 1. **Why your app needs this scope**
> 2. **How your app uses this scope**
> 3. **Why a more limited scope wouldn't be sufficient**

---

## 1) `https://www.googleapis.com/auth/youtube.readonly`

**Category:** Sensitive

### Why your app needs this scope
tubemind-secure-mcp is a Model Context Protocol (MCP) server that exposes 18 YouTube research and analytics tools to AI assistants such as Anthropic's Claude Desktop. The majority of these tools — including reading the user's own video metadata, listing channel videos, retrieving competitor data and powering keyword/heuristic analysis — require read-only access to the YouTube Data API v3.

### How your app uses this scope
The scope is used to call the following YouTube Data API v3 endpoints, exclusively for read-only operations triggered by the user from inside the AI client:

- `videos.list` — used by `get_video_tags`, `analyze_title_patterns`, `estimate_ctr_potential`, `analyze_retention_signals`, `benchmark_channel`, `get_competitor_videos` to read public metadata of videos the user asks about.
- `search.list` — used by `search_trending_topics`, `find_trending_keywords`, `suggest_tags`, `get_keyword_stats`, `estimate_keyword_difficulty`, `detect_content_gaps`, `suggest_hook_angles` to surface trending topics and competitor content.
- `playlistItems.list` and `channels.list` — used by `list_channel_videos` and `generate_content_calendar` to paginate the user's uploads and channel summary.

All responses are returned to the local MCP client and never transmitted to any third-party server.

### Why a more limited scope wouldn't be sufficient
There is no narrower YouTube API scope that exposes the metadata fields (snippet, contentDetails, statistics, status) needed by the heuristic and analytics tools. `youtube.force-ssl` would not reduce data access; the public-data-only endpoints can be reached with an API key but only for fully public resources, and our tools require reading the authenticated user's own non-public videos (drafts, scheduled, unlisted) and their analytics-bound metadata.

---

## 2) `https://www.googleapis.com/auth/yt-analytics.readonly`

**Category:** Sensitive

### Why your app needs this scope
The analytics, benchmark and publish-window tools (`get_channel_analytics`, `score_best_publish_window`, `benchmark_channel`) provide insight into the user's own channel performance — views, watch time, average view duration, retention curves and top traffic sources — so the AI assistant can suggest content strategy. This data is not available through the YouTube Data API; it requires the YouTube Analytics API.

### How your app uses this scope
The scope is used solely to call read-only endpoints of the YouTube Analytics API v2:

- `reports.query` — fetch aggregated metrics (views, estimatedMinutesWatched, averageViewDuration, audienceWatchRatio) for the user's channel, scoped to dimensions like day-of-week and hour-of-day.

Results are returned to the user inside the MCP client; tubemind-secure-mcp does not store, transmit or share analytics data.

### Why a more limited scope wouldn't be sufficient
YouTube does not provide a narrower analytics scope. `yt-analytics-monetary.readonly` would expand access (revenue) — we deliberately do not request it. The chosen scope is the minimum required to read non-monetary channel performance data.

---

## 3) `https://www.googleapis.com/auth/youtube`

**Category:** Restricted

### Why your app needs this scope
The `update_video_metadata` tool allows the user to ask the AI assistant to optimize and apply title, description and tags on the user's **own** already-published videos. This is a write operation on the user's account that the read-only scope cannot perform.

### How your app uses this scope
Used exclusively by `update_video_metadata` to call:

- `videos.update` (parts: `snippet`, `status`) — modify title, description, tags and category of a video the user owns, after the Software has verified channel ownership of the target video against `channels.list?mine=true`.

The Software writes only to videos that belong to the authenticated user's channel (or the Brand Account they explicitly select). It never uploads new videos under this scope, never modifies videos belonging to other users, and never publishes private videos to public.

### Why a more limited scope wouldn't be sufficient
YouTube does not expose a narrower scope for editing video snippet/status fields. `youtube.readonly` cannot perform writes. `youtube.upload` is for uploads only, not edits. The full `youtube` scope is the minimum write permission required to update existing video metadata.

---

## 4) `https://www.googleapis.com/auth/youtube.upload`

**Category:** Restricted

### Why your app needs this scope
This scope is **declared but reserved for future functionality**. A planned tool (`upload_video`, scheduled for v0.3.x) will allow the user to ask the AI assistant to upload a finished video file from their machine to their own YouTube channel.

### How your app uses this scope
At the time of submission, the scope is requested during OAuth authorization but is not actively invoked by any of the 18 currently published tools. When the upload tool ships, it will call:

- `videos.insert` (parts: `snippet`, `status`) — upload a local video file as a draft on the authenticated user's channel.

The Software never uploads under another user's identity and the file path must be supplied by the user explicitly via the MCP tool invocation.

### Why a more limited scope wouldn't be sufficient
There is no narrower scope for uploading. `youtube.upload` is the dedicated minimum permission for the `videos.insert` endpoint.

> **If Google requires removing reserved scopes:** we will drop `youtube.upload` from this submission and resubmit when the upload feature is released.

---

## Common answers

### Will users be able to revoke access?
Yes — at any time at https://myaccount.google.com/permissions. The Software detects revoked tokens at next call and surfaces a clear error message guiding the user to re-authorize via `pnpm auth`.

### Will the data leave the user's machine?
No. tubemind-secure-mcp runs entirely on the user's local machine. There is no Dewtech-operated backend. Data flows: User's machine ↔ Google APIs ↔ User's MCP client (Claude Desktop). No third party in the path.

### Will tokens be stored?
Yes, locally only. Refresh tokens are persisted in `./tokens/youtube.token.json` encrypted with **AES-256-GCM** using a 256-bit key generated locally by the user (env var `TOKEN_ENCRYPTION_KEY`). The key is never transmitted.

### How does this comply with Limited Use?
We use scope-derived data exclusively to provide the user-facing 18 MCP tools. We do not show ads, do not sell or transfer data, and do not allow human reading of the data. Full statement is published at https://tubemind.dewtech.tech/privacy.html section 5.
