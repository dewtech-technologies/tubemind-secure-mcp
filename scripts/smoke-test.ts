/**
 * Smoke test do Tubemind v0.2 contra YouTube real.
 *
 * Roda 4 cenários:
 * 1. search_trending_topics (v0.1) — valida YouTube + tracking de quota
 * 2. analyze_title_patterns (v0.1 refactored) — valida batch optimization
 * 3. get_quota_usage (v0.2 NOVA) — mostra acumulado da sessão
 * 4. analyze_thumbnail_visuals (v0.2 NOVA) — valida fallback gracioso sem ANTHROPIC_API_KEY
 *
 * Para rodar:
 *   pnpm tsx --env-file=.env scripts/smoke-test.ts
 */

import { getAccessToken } from '../src/services/oauth.service.js'
import { searchTrendingTopics } from '../src/tools/search.tool.js'
import { analyzeTitlePatterns } from '../src/tools/heuristic.tool.js'
import { getQuotaUsage } from '../src/tools/quota.tool.js'
import { analyzeThumbnailVisuals } from '../src/tools/vision.tool.js'

const SEPARATOR = '\n' + '═'.repeat(80) + '\n'

async function run(): Promise<void> {
  console.log('🧠 Tubemind v0.2 — Smoke Test contra YouTube real')
  console.log(SEPARATOR)

  // 1. Resolve OAuth token
  let accessToken: string
  try {
    accessToken = await getAccessToken()
    console.log('✅ OAuth token carregado')
  } catch (err) {
    console.error(
      '❌ OAuth falhou:',
      err instanceof Error ? err.message : err,
      '\nRode `pnpm auth` primeiro.',
    )
    process.exit(1)
  }

  // 2. search_trending_topics — v0.1 com tracking de quota
  console.log(SEPARATOR)
  console.log('📡 [1/4] search_trending_topics (v0.1) — "automação com IA"')
  console.log('Expectativa: 1 chamada API (search.list = 100 quota units)')
  console.log()
  try {
    const out = await searchTrendingTopics(
      { query: 'automação com IA', maxResults: 5, regionCode: 'BR' },
      accessToken,
    )
    console.log(truncate(out, 1500))
  } catch (err) {
    console.error('❌', err instanceof Error ? err.message : err)
  }

  // 3. analyze_title_patterns — v0.1 REFACTORED para usar batch
  console.log(SEPARATOR)
  console.log('🔬 [2/4] analyze_title_patterns (refactored com batch) — "marketing digital"')
  console.log('Expectativa: 1 search (100u) + 1 videos.list batched (1u) = 101u total')
  console.log('(antes do batch optimization seria: 100 + 30 = 130u)')
  console.log()
  try {
    const out = await analyzeTitlePatterns(
      { niche: 'marketing digital', regionCode: 'BR', videoCount: 30 },
      accessToken,
    )
    console.log(truncate(out, 1500))
  } catch (err) {
    console.error('❌', err instanceof Error ? err.message : err)
  }

  // 4. get_quota_usage — v0.2 NOVA
  console.log(SEPARATOR)
  console.log('💰 [3/4] get_quota_usage (v0.2 NOVA) — relatório do que foi consumido')
  console.log()
  try {
    const out = await getQuotaUsage({ period: 'today' }, accessToken)
    console.log(out)
  } catch (err) {
    console.error('❌', err instanceof Error ? err.message : err)
  }

  // 5. analyze_thumbnail_visuals — v0.2 deve dar fallback gracioso (sem ANTHROPIC_API_KEY)
  console.log(SEPARATOR)
  console.log('🎨 [4/4] analyze_thumbnail_visuals (v0.2 Camada 2)')
  console.log('Expectativa: fallback gracioso (ANTHROPIC_API_KEY não setada)')
  console.log()
  try {
    const out = await analyzeThumbnailVisuals(
      { niche: 'marketing digital', maxThumbs: 5 },
      accessToken,
    )
    console.log(out)
  } catch (err) {
    console.error('❌', err instanceof Error ? err.message : err)
  }

  console.log(SEPARATOR)
  console.log('✅ Smoke test concluído.')
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + `\n... [truncado — ${text.length - maxChars} chars]`
}

run().catch((err) => {
  console.error('💥 Fatal:', err)
  process.exit(1)
})
