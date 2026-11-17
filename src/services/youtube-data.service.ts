/**
 * YouTube Data Service — leituras baratas (1 quota unit por chamada) usadas pelas
 * tools de dados brutos: canal, playlist, vídeo, trending, comentários e lote.
 *
 * Todas as funções:
 * - registram o consumo de quota no quota_log (recordQuota)
 * - usam cache por token (withCache) com TTL definido em cache.config.ts
 */

import type { youtube_v3 } from 'googleapis'
import type { YouTubeClient } from './youtube.service.js'
import { recordQuota } from './quota.service.js'
import { withCache } from './cache.service.js'
import { CHANNEL_ID_REGEX, type ChannelRef } from '../utils/youtube-parsers.js'

const LIST_CHUNK_SIZE = 50 // limite oficial de IDs por chamada

export interface Ctx {
  readonly tokenHash: string
  readonly toolName: string
}

export interface Page<T> {
  readonly items: T[]
  readonly nextPageToken: string | null
  readonly totalResults: number | null
}

function toPage<T>(
  data: { items?: T[]; nextPageToken?: string | null; pageInfo?: youtube_v3.Schema$PageInfo },
): Page<T> {
  return {
    items: data.items ?? [],
    nextPageToken: data.nextPageToken ?? null,
    totalResults: data.pageInfo?.totalResults ?? null,
  }
}

// ─── Canal ────────────────────────────────────────────────────────────────────

const CHANNEL_PARTS = ['snippet', 'statistics', 'contentDetails', 'brandingSettings', 'topicDetails']

/** Busca um canal por UC... ou @handle (channels.list, 1 unit). */
export async function getChannel(
  client: YouTubeClient,
  ref: ChannelRef,
  ctx: Ctx,
): Promise<youtube_v3.Schema$Channel | null> {
  return withCache(ctx.toolName, { ref }, ctx.tokenHash, async () => {
    const res = await client.channels.list({
      part: CHANNEL_PARTS,
      ...(ref.kind === 'id' ? { id: [ref.value] } : { forHandle: ref.value }),
    })
    recordQuota('youtube:channels.list', ctx.tokenHash, ctx.toolName)
    return res.data.items?.[0] ?? null
  })
}

/** Resolve @handle → UC... (1 unit). IDs UC... retornam direto, sem chamada. */
export async function resolveChannelId(
  client: YouTubeClient,
  ref: ChannelRef,
  ctx: Ctx,
): Promise<string | null> {
  if (ref.kind === 'id') return ref.value
  return withCache('resolve_handle', { handle: ref.value.toLowerCase() }, ctx.tokenHash, async () => {
    const res = await client.channels.list({ part: ['id'], forHandle: ref.value })
    recordQuota('youtube:channels.list', ctx.tokenHash, ctx.toolName)
    return res.data.items?.[0]?.id ?? null
  })
}

export async function listChannelPlaylists(
  client: YouTubeClient,
  channelId: string,
  maxResults: number,
  pageToken: string | undefined,
  ctx: Ctx,
): Promise<Page<youtube_v3.Schema$Playlist>> {
  return withCache(ctx.toolName, { channelId, maxResults, pageToken }, ctx.tokenHash, async () => {
    const res = await client.playlists.list({
      part: ['snippet', 'contentDetails'],
      channelId,
      maxResults,
      ...(pageToken ? { pageToken } : {}),
    })
    recordQuota('youtube:playlists.list', ctx.tokenHash, ctx.toolName)
    return toPage(res.data)
  })
}

// ─── Playlist ─────────────────────────────────────────────────────────────────

export interface PlaylistWithItems {
  readonly playlist: youtube_v3.Schema$Playlist | null
  readonly items: Page<youtube_v3.Schema$PlaylistItem>
  readonly videos: youtube_v3.Schema$Video[]
}

/**
 * Metadados da playlist + uma página de itens + estatísticas dos vídeos.
 * Custo: playlists.list (1) + playlistItems.list (1) + videos.list (1) = 3 units.
 */
export async function getPlaylistWithItems(
  client: YouTubeClient,
  playlistId: string,
  maxResults: number,
  pageToken: string | undefined,
  ctx: Ctx,
): Promise<PlaylistWithItems> {
  return withCache(ctx.toolName, { playlistId, maxResults, pageToken }, ctx.tokenHash, async () => {
    const meta = await client.playlists.list({ part: ['snippet', 'contentDetails'], id: [playlistId] })
    recordQuota('youtube:playlists.list', ctx.tokenHash, ctx.toolName)
    const playlist = meta.data.items?.[0] ?? null

    const itemsRes = await client.playlistItems.list({
      part: ['snippet', 'contentDetails'],
      playlistId,
      maxResults,
      ...(pageToken ? { pageToken } : {}),
    })
    recordQuota('youtube:playlistItems.list', ctx.tokenHash, ctx.toolName)
    const items = toPage(itemsRes.data)

    const videoIds = items.items
      .map((i) => i.contentDetails?.videoId)
      .filter((id): id is string => !!id)

    let videos: youtube_v3.Schema$Video[] = []
    if (videoIds.length > 0) {
      const vRes = await client.videos.list({ part: ['statistics', 'contentDetails'], id: videoIds })
      recordQuota('youtube:videos.list', ctx.tokenHash, ctx.toolName)
      videos = vRes.data.items ?? []
    }

    return { playlist, items, videos }
  })
}

// ─── Vídeo ────────────────────────────────────────────────────────────────────

export async function getVideoDetails(
  client: YouTubeClient,
  videoId: string,
  ctx: Ctx,
): Promise<youtube_v3.Schema$Video | null> {
  return withCache(ctx.toolName, { videoId }, ctx.tokenHash, async () => {
    const res = await client.videos.list({
      part: ['snippet', 'statistics', 'contentDetails', 'status', 'topicDetails', 'liveStreamingDetails'],
      id: [videoId],
    })
    recordQuota('youtube:videos.list', ctx.tokenHash, ctx.toolName)
    return res.data.items?.[0] ?? null
  })
}

/** Vídeos em alta (chart=mostPopular) por região e categoria — 1 unit. */
export async function getTrendingVideos(
  client: YouTubeClient,
  regionCode: string,
  categoryId: string | undefined,
  maxResults: number,
  pageToken: string | undefined,
  ctx: Ctx,
): Promise<Page<youtube_v3.Schema$Video>> {
  return withCache(ctx.toolName, { regionCode, categoryId, maxResults, pageToken }, ctx.tokenHash, async () => {
    const res = await client.videos.list({
      part: ['snippet', 'statistics', 'contentDetails'],
      chart: 'mostPopular',
      regionCode,
      maxResults,
      ...(categoryId ? { videoCategoryId: categoryId } : {}),
      ...(pageToken ? { pageToken } : {}),
    })
    recordQuota('youtube:videos.list', ctx.tokenHash, ctx.toolName)
    return toPage(res.data)
  })
}

// ─── Comentários ──────────────────────────────────────────────────────────────

export async function listCommentThreads(
  client: YouTubeClient,
  params: {
    videoId: string
    maxResults: number
    order: 'relevance' | 'time'
    pageToken?: string
    searchTerms?: string
  },
  ctx: Ctx,
): Promise<Page<youtube_v3.Schema$CommentThread>> {
  return withCache(ctx.toolName, params, ctx.tokenHash, async () => {
    const res = await client.commentThreads.list({
      part: ['snippet', 'replies'],
      videoId: params.videoId,
      maxResults: params.maxResults,
      order: params.order,
      textFormat: 'plainText',
      ...(params.pageToken ? { pageToken: params.pageToken } : {}),
      ...(params.searchTerms ? { searchTerms: params.searchTerms } : {}),
    })
    recordQuota('youtube:commentThreads.list', ctx.tokenHash, ctx.toolName)
    return toPage(res.data)
  })
}

export async function listCommentReplies(
  client: YouTubeClient,
  parentId: string,
  maxResults: number,
  pageToken: string | undefined,
  ctx: Ctx,
): Promise<Page<youtube_v3.Schema$Comment>> {
  return withCache(ctx.toolName, { parentId, maxResults, pageToken }, ctx.tokenHash, async () => {
    const res = await client.comments.list({
      part: ['snippet'],
      parentId,
      maxResults,
      textFormat: 'plainText',
      ...(pageToken ? { pageToken } : {}),
    })
    recordQuota('youtube:comments.list', ctx.tokenHash, ctx.toolName)
    return toPage(res.data)
  })
}

// ─── Lote de canais ───────────────────────────────────────────────────────────

/**
 * Busca até N canais por UC... em lotes de 50 (1 unit por lote).
 * Preserva a ordem de entrada; posições não encontradas viram null.
 */
export async function getChannelsByIdsBatched(
  client: YouTubeClient,
  ids: readonly string[],
  ctx: Ctx,
): Promise<Array<youtube_v3.Schema$Channel | null>> {
  const validIds = ids.filter((id) => CHANNEL_ID_REGEX.test(id))
  if (validIds.length === 0) return ids.map(() => null)

  const all = await withCache('channels_batch', { ids: [...validIds].sort() }, ctx.tokenHash, async () => {
    const out: youtube_v3.Schema$Channel[] = []
    for (let i = 0; i < validIds.length; i += LIST_CHUNK_SIZE) {
      const chunk = validIds.slice(i, i + LIST_CHUNK_SIZE)
      const res = await client.channels.list({ part: ['snippet', 'statistics'], id: chunk })
      recordQuota('youtube:channels.list', ctx.tokenHash, ctx.toolName)
      out.push(...(res.data.items ?? []))
    }
    return out
  })

  const byId = new Map<string, youtube_v3.Schema$Channel>()
  for (const c of all) if (c.id) byId.set(c.id, c)
  return ids.map((id) => byId.get(id) ?? null)
}
