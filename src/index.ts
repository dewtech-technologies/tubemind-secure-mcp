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
  ],
}))

// ─── Call Tool ────────────────────────────────────────────────────────────────

const USER_ID = 'default' // Em produção: identificar usuário via sessão

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  let accessToken: string
  try {
    accessToken = getAccessToken(USER_ID)
  } catch (err) {
    return {
      content: [{
        type: 'text',
        text: `❌ Autenticação necessária: ${err instanceof Error ? err.message : 'erro desconhecido'}\n\nExecute o fluxo OAuth para conectar seu canal YouTube.`,
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
