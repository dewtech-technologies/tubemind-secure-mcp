#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { getAccessToken } from './services/oauth.service.js'
import { RateLimitError } from './security/rate-limiter.service.js'
import { SsrfGuardError } from './security/ssrf-guard.service.js'

// Tools — Search
import {
  searchTrendingTopicsDefinition,
  searchTrendingTopics,
  getKeywordStatsDefinition,
  getKeywordStats,
  suggestTagsDefinition,
  suggestTags,
} from './tools/search.tool.js'

// Tools — Video
import {
  getVideoTagsDefinition,
  getVideoTags,
  updateVideoMetadataDefinition,
  updateVideoMetadata,
  listChannelVideosDefinition,
  listChannelVideos,
} from './tools/video.tool.js'

// Tools — Analytics
import {
  getChannelAnalyticsDefinition,
  getChannelAnalytics,
  scoreBestPublishWindowDefinition,
  scoreBestPublishWindow,
} from './tools/analytics.tool.js'

// Tools — Benchmark
import {
  benchmarkChannelDefinition,
  benchmarkChannel,
} from './tools/benchmark.tool.js'

// Tools — Heuristics Advanced
import {
  estimateCtrPotentialDefinition,
  estimateCtrPotential,
  suggestHookAnglesDefinition,
  suggestHookAngles,
  findTrendingKeywordsDefinition,
  findTrendingKeywords,
  analyzeRetentionSignalsDefinition,
  analyzeRetentionSignals,
  generateContentCalendarDefinition,
  generateContentCalendar,
} from './tools/heuristic-advanced.tool.js'

// Tools — Competitor
import {
  getCompetitorVideosDefinition,
  getCompetitorVideos,
} from './tools/competitor.tool.js'

// Tools — Heuristics
import {
  estimateKeywordDifficultyDefinition,
  estimateKeywordDifficulty,
  analyzeTitlePatternsDefinition,
  analyzeTitlePatterns,
  detectContentGapsDefinition,
  detectContentGaps,
} from './tools/heuristic.tool.js'

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: 'tubemind-secure-mcp',
    version: '0.1.0',
  },
  {
    capabilities: { tools: {} },
  },
)

// ─── List Tools ───────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    searchTrendingTopicsDefinition,
    getKeywordStatsDefinition,
    suggestTagsDefinition,
    getVideoTagsDefinition,
    updateVideoMetadataDefinition,
    listChannelVideosDefinition,
    getChannelAnalyticsDefinition,
    getCompetitorVideosDefinition,
    estimateKeywordDifficultyDefinition,
    analyzeTitlePatternsDefinition,
    detectContentGapsDefinition,
    scoreBestPublishWindowDefinition,
    benchmarkChannelDefinition,
    estimateCtrPotentialDefinition,
    suggestHookAnglesDefinition,
    findTrendingKeywordsDefinition,
    analyzeRetentionSignalsDefinition,
    generateContentCalendarDefinition,
  ],
}))

// ─── Call Tool ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — SDK 1.26 deep type instantiation (TS2589); runtime is safe
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = (request as { params: { name: string; arguments?: Record<string, unknown> } }).params

  let accessToken: string
  try {
    accessToken = await getAccessToken()
  } catch (err) {
    return {
      content: [{
        type: 'text',
        text: `❌ Autenticação necessária: ${err instanceof Error ? err.message : 'erro desconhecido'}\n\nExecute "pnpm auth" para conectar seu canal YouTube.`,
      }],
      isError: true,
    }
  }

  try {
    let result: string

    switch (name) {
      case 'search_trending_topics':
        result = await searchTrendingTopics(args, accessToken)
        break
      case 'get_keyword_stats':
        result = await getKeywordStats(args, accessToken)
        break
      case 'suggest_tags':
        result = await suggestTags(args, accessToken)
        break
      case 'get_video_tags':
        result = await getVideoTags(args, accessToken)
        break
      case 'update_video_metadata':
        result = await updateVideoMetadata(args, accessToken)
        break
      case 'list_channel_videos':
        result = await listChannelVideos(args, accessToken)
        break
      case 'get_channel_analytics':
        result = await getChannelAnalytics(args, accessToken)
        break
      case 'get_competitor_videos':
        result = await getCompetitorVideos(args, accessToken)
        break
      case 'estimate_keyword_difficulty':
        result = await estimateKeywordDifficulty(args, accessToken)
        break
      case 'analyze_title_patterns':
        result = await analyzeTitlePatterns(args, accessToken)
        break
      case 'detect_content_gaps':
        result = await detectContentGaps(args, accessToken)
        break
      case 'score_best_publish_window':
        result = await scoreBestPublishWindow(args, accessToken)
        break
      case 'benchmark_channel':
        result = await benchmarkChannel(args, accessToken)
        break
      case 'estimate_ctr_potential':
        result = await estimateCtrPotential(args, accessToken)
        break
      case 'suggest_hook_angles':
        result = await suggestHookAngles(args, accessToken)
        break
      case 'find_trending_keywords':
        result = await findTrendingKeywords(args, accessToken)
        break
      case 'analyze_retention_signals':
        result = await analyzeRetentionSignals(args, accessToken)
        break
      case 'generate_content_calendar':
        result = await generateContentCalendar(args, accessToken)
        break
      default:
        return {
          content: [{ type: 'text', text: `❌ Tool desconhecida: "${name}"` }],
          isError: true,
        }
    }

    return { content: [{ type: 'text', text: result }] }
  } catch (err) {
    // A09 — Erros sem stack trace para o cliente
    const isDev = process.env['NODE_ENV'] === 'development'

    if (err instanceof RateLimitError) {
      return {
        content: [{ type: 'text', text: `⏳ ${err.message}` }],
        isError: true,
      }
    }

    if (err instanceof SsrfGuardError) {
      return {
        content: [{ type: 'text', text: `🚫 Requisição bloqueada por segurança.` }],
        isError: true,
      }
    }

    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    const detail = isDev && err instanceof Error ? `\n\n${err.stack}` : ''

    return {
      content: [{ type: 'text', text: `❌ Erro: ${message}${detail}` }],
      isError: true,
    }
  }
})

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // Log vai para stderr para não poluir o protocolo MCP (stdout)
  console.error('🧠 tubemind-secure-mcp iniciado')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
