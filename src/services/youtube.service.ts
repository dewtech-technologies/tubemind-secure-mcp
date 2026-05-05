import { google, youtube_v3 } from 'googleapis'
import { assertAllowedDomain } from '../security/ssrf-guard.service.js'

assertAllowedDomain('www.googleapis.com')
assertAllowedDomain('youtube.googleapis.com')

export type YouTubeClient = youtube_v3.Youtube

type SearchOrder = 'date' | 'rating' | 'relevance' | 'title' | 'videoCount' | 'viewCount'

export function getYouTubeClient(accessToken: string): YouTubeClient {
  const auth = new google.auth.OAuth2(
    process.env['YOUTUBE_CLIENT_ID'],
    process.env['YOUTUBE_CLIENT_SECRET'],
    process.env['YOUTUBE_REDIRECT_URI'],
  )
  auth.setCredentials({ access_token: accessToken })
  return google.youtube({ version: 'v3', auth })
}

// ─── Search ───────────────────────────────────────────────────────────────────

export async function searchVideos(
  client: YouTubeClient,
  query: string,
  maxResults: number,
  regionCode: string,
  order: SearchOrder,
): Promise<youtube_v3.Schema$SearchResult[]> {
  const res = await client.search.list({
    part: ['snippet'],
    q: query,
    maxResults,
    regionCode,
    order,
    type: ['video'],
    safeSearch: 'none',
  })
  return res.data.items ?? []
}

// ─── Videos ───────────────────────────────────────────────────────────────────

export async function getVideoById(
  client: YouTubeClient,
  videoId: string,
): Promise<youtube_v3.Schema$Video | null> {
  const res = await client.videos.list({
    part: ['snippet', 'statistics', 'contentDetails'],
    id: [videoId],
  })
  return res.data.items?.[0] ?? null
}

export async function updateVideoMetadata(
  client: YouTubeClient,
  videoId: string,
  title: string,
  description: string,
  tags: string[],
  categoryId?: string,
): Promise<youtube_v3.Schema$Video> {
  const res = await client.videos.update({
    part: ['snippet'],
    requestBody: {
      id: videoId,
      snippet: {
        title,
        description,
        tags,
        ...(categoryId !== undefined ? { categoryId } : {}),
      },
    },
  })

  if (!res.data) throw new Error('Falha ao atualizar metadados do vídeo')
  return res.data
}

export async function listChannelVideos(
  client: YouTubeClient,
  maxResults: number,
  order: string,
  channelIdParam?: string,
): Promise<youtube_v3.Schema$Video[]> {
  let channelId = channelIdParam

  if (!channelId) {
    // Sem channelId → usa YOUTUBE_CHANNEL_ID (env) ou mine: true como fallback
    channelId = await getOwnChannelId(client)
  }

  const safeOrder = (['date', 'rating', 'relevance', 'title', 'viewCount'] as SearchOrder[])
    .includes(order as SearchOrder)
    ? (order as SearchOrder)
    : 'date'

  const searchRes = await client.search.list({
    part: ['id'],
    channelId,
    maxResults,
    order: safeOrder,
    type: ['video'],
  })

  const videoIds = (searchRes.data.items ?? [])
    .map(i => i.id?.videoId)
    .filter((id): id is string => !!id)

  if (videoIds.length === 0) return []

  const videosRes = await client.videos.list({
    part: ['snippet', 'statistics'],
    id: videoIds,
  })

  return videosRes.data.items ?? []
}

// ─── Competitor ───────────────────────────────────────────────────────────────

export async function getCompetitorChannelVideos(
  client: YouTubeClient,
  channelId: string,
  maxResults: number,
  order: 'date' | 'viewCount' | 'rating',
): Promise<youtube_v3.Schema$Video[]> {
  const searchRes = await client.search.list({
    part: ['id'],
    channelId,
    maxResults,
    order,
    type: ['video'],
  })

  const videoIds = (searchRes.data.items ?? [])
    .map(i => i.id?.videoId)
    .filter((id): id is string => !!id)

  if (videoIds.length === 0) return []

  const videosRes = await client.videos.list({
    part: ['snippet', 'statistics', 'contentDetails'],
    id: videoIds,
  })

  return videosRes.data.items ?? []
}

// ─── Own channel ID (respects Brand Account via env var) ─────────────────────

/**
 * Retorna o Channel ID do canal principal.
 * Prioridade: YOUTUBE_CHANNEL_ID (env) → channels.list(mine: true)
 * Use sempre que precisar do "meu canal" para evitar pegar canal pessoal
 * em vez de Brand Account.
 */
export async function getOwnChannelId(client: YouTubeClient): Promise<string> {
  const envChannelId = process.env['YOUTUBE_CHANNEL_ID']
  if (envChannelId) return envChannelId

  const res = await client.channels.list({ part: ['id'], mine: true })
  const id = res.data.items?.[0]?.id
  if (!id) throw new Error('Canal não encontrado para a conta autenticada.')
  return id
}

// ─── Channel stats (for heuristics) ──────────────────────────────────────────

export async function getChannelStats(
  client: YouTubeClient,
  channelId: string,
): Promise<youtube_v3.Schema$ChannelStatistics | null> {
  const res = await client.channels.list({
    part: ['statistics'],
    id: [channelId],
  })
  return res.data.items?.[0]?.statistics ?? null
}
