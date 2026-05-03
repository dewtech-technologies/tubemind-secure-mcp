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
): Promise<youtube_v3.Schema$Video[]> {
  const channelRes = await client.channels.list({
    part: ['id'],
    mine: true,
  })
  const channelId = channelRes.data.items?.[0]?.id
  if (!channelId) throw new Error('Canal não encontrado')

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
