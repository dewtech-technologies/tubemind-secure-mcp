# Demo Video Script — tubemind-secure-mcp

> **Goal:** prove to Google's verification reviewer that:
> 1. The OAuth Consent Screen they see actually belongs to a real, working app
> 2. Each requested scope is used in a legitimate, user-facing way
> 3. Branding is consistent (logo, app name, domain)
>
> **Format:** YouTube unlisted upload, 2–4 minutes, voiceover in English.
>
> **Recording:** OBS Studio (free) at 1080p 30fps. Mic check before recording.
>
> **Submit URL:** add to the OAuth Consent Screen → "Demo video".

---

## Pre-flight checklist (do once before recording)

- [ ] Tubemind app published "In Production" on Google Cloud Console
- [ ] OAuth Consent Screen shows app name **tubemind-mcp-secure** with logo, privacy URL `https://tubemind.dewtech.tech/privacy.html`, terms URL `https://tubemind.dewtech.tech/terms.html`
- [ ] Domain `dewtech.tech` verified in Google Search Console
- [ ] Browser zoom 100%, system theme dark, notifications silenced
- [ ] Claude Desktop installed with tubemind-secure-mcp configured
- [ ] A test YouTube channel with a few uploaded videos is signed in to your default Chrome profile
- [ ] Audit log file exists at `./logs/audit.log` (touch it first so the demo can show it)

---

## Scene-by-scene script

### Scene 1 — Intro (0:00 – 0:20)

**On screen:** browser at `https://tubemind.dewtech.tech`. The hero section visible.

**Voiceover:**
> "Hi, I'm Wanderson — author of tubemind-secure-mcp.
> This is an open-source Model Context Protocol server published as ``tubemind-secure-mcp`` on npm and listed on the Anthropic MCP Registry. It gives Claude Desktop 18 tools for YouTube research and analytics — running entirely on the user's machine, with no backend operated by us."

**Action:** scroll briefly through the landing page so the reviewer sees logo, name, links.

---

### Scene 2 — OAuth Consent Screen (0:20 – 0:55)

**On screen:** terminal in the project root. Run:
```bash
pnpm auth
```
Then click the URL that opens. Record the **full Google consent dialog**.

**Voiceover:**
> "When the user runs the auth command, the standard Google OAuth dialog opens.
> The app name shown — tubemind-mcp-secure — matches the branding of the website and the npm package.
> The user can review and individually accept each scope."

**Action:** zoom into the consent screen so the reviewer can see:
- App name and logo
- Email being authorized
- The 4 requested scopes listed individually

---

### Scene 3 — Scope #1: `youtube.readonly` (0:55 – 1:30)

**Voiceover:**
> "First scope — youtube.readonly. We use it to read public and authorized video metadata.
> Watch as I ask Claude to list my channel videos."

**On screen:** Claude Desktop. Ask:
> *"List the latest 5 videos from my channel using tubemind."*

Claude calls `list_channel_videos`. Result appears.

**Voiceover (over the result):**
> "Claude invoked the `list_channel_videos` tool, which is backed by the YouTube Data API v3 ``playlistItems.list`` endpoint. The response is rendered locally — nothing is sent to any third-party server."

---

### Scene 4 — Scope #2: `yt-analytics.readonly` (1:30 – 2:05)

**Voiceover:**
> "Second scope — yt-analytics.readonly. This powers the channel analytics tool."

**On screen:** Ask Claude:
> *"Get my channel analytics for the last 30 days."*

Claude calls `get_channel_analytics`. Show result with views, watch time, retention.

**Voiceover:**
> "The Analytics API returned aggregated metrics for the last 30 days. The user's data is shown only inside Claude's chat window. No analytics data is persisted by tubemind beyond the request lifecycle."

---

### Scene 5 — Scope #3: `youtube` (write) (2:05 – 2:50)

**Voiceover:**
> "Third scope — youtube. This is the write scope. We use it for one tool only: update_video_metadata.
> The Software verifies channel ownership before any write."

**On screen:** Ask Claude:
> *"Optimize the title and tags of video [VIDEO_ID] for higher CTR using tubemind."*

Claude calls `update_video_metadata`. Show success message.

**On screen (next):** open the video in YouTube Studio in another tab. Show that the title and tags were actually updated.

**Voiceover:**
> "Tubemind read the current metadata, verified that the video belongs to the authenticated channel via channels.list?mine=true, then called videos.update on the snippet part. Here in YouTube Studio you can see the change applied to the user's own video."

---

### Scene 6 — Scope #4: `youtube.upload` (2:50 – 3:10)

**Voiceover:**
> "Fourth scope — youtube.upload. This is reserved for our planned upload tool, scheduled for v0.3.
> It is requested during authorization but no current tool invokes ``videos.insert``.
> If Google requires removing reserved scopes, we will drop this one and resubmit when the upload feature ships."

**On screen:** open `src/tools/` directory in editor — show that no file calls `videos.insert`. Highlight that this is documented in the privacy policy.

---

### Scene 7 — Security & local-only architecture (3:10 – 3:40)

**Voiceover:**
> "Tokens are stored locally and encrypted at rest with AES-256-GCM. Every tool call is recorded in a local audit log."

**On screen:**
1. Open `./tokens/youtube.token.json` — show the encrypted ciphertext.
2. Open `./logs/audit.log` — show the per-call entries.
3. Open `https://tubemind.dewtech.tech/privacy.html` — scroll to section 5 (Limited Use compliance).

**Voiceover:**
> "The privacy policy explicitly states our compliance with the Limited Use requirements of the Google API Services User Data Policy: no ads, no sale, no transfer to third parties, no human reading of user data."

---

### Scene 8 — Revoke flow (3:40 – 3:55)

**Voiceover:**
> "Users can revoke access at any time at myaccount.google.com/permissions."

**On screen:** open `https://myaccount.google.com/permissions`, find tubemind-mcp-secure, hover over the "Remove access" button (do not actually click — keep the test grant for the reviewer).

---

### Scene 9 — Outro (3:55 – 4:00)

**On screen:** back to landing page footer with links.

**Voiceover:**
> "tubemind-secure-mcp is MIT-licensed and open source on GitHub. Thanks for reviewing."

---

## What the reviewer must see clearly

- ✅ App name **tubemind-mcp-secure** is consistent across: OAuth screen, website, npm, GitHub, MCP Registry
- ✅ Each requested scope produces a visible, useful, user-initiated outcome inside the app
- ✅ Privacy policy and terms of service URLs render correctly with the same branding
- ✅ Tokens are stored locally and encrypted (show file contents)
- ✅ Audit log exists and records calls
- ✅ Domain in OAuth screen (`dewtech.tech`) matches the branding shown on screen

## Common reasons Google rejects the video

| Reason | Avoid by… |
|--------|-----------|
| Branding mismatch | Make sure the OAuth Client's "Application name" exactly matches what's on the website (`tubemind-mcp-secure`) |
| Scope not demonstrated in app | Every requested scope must produce visible output (we covered all 4) |
| Reserved scopes without justification | We declared `youtube.upload` as reserved and explained — but Google may still ask you to drop it |
| Demo recorded in incognito or without sign-in | Use a real signed-in profile so the reviewer sees the genuine consent UI |
| Voice in a language other than English | English voiceover (or English subtitles) is strongly recommended |
| Domain not verified | Verify `dewtech.tech` in Google Search Console **before** submitting |

## After recording

1. Upload to YouTube as **Unlisted**
2. Title: `tubemind-secure-mcp — Google OAuth verification demo`
3. Description: link to npm + GitHub + privacy + terms
4. Paste the unlisted URL into the OAuth verification form's "Demo video" field
