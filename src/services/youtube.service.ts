import { google, youtube_v3 } from 'googleapis'
import { assertAllowedDomain } from '../security/ssrf-guard.service.js'
import { recordQuota } from './quota.service.js'
import { withCache } from './cache.service.js'

assertAllowedDomain('www.googleapis.com')
assertAllowedDomain('youtube.googleapis.com')

// videoId YouTube: 11 chars de [A-Za-z0-9_-] (RS-3.6 aplicado preventivamente)
const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/
const VIDEOS_LIST_CHUNK_SIZE = 50 // limite oficial da API

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

// ─── Captions (v0.2 task-010 — Camada 3 NLP) ──────────────────────────────────

/**
 * Lista as captions disponíveis para um vídeo. Registra 50 quota units.
 * Retorna array (possivelmente vazio se vídeo não tem captions habilitadas).
 */
export async function listCaptions(
  client: YouTubeClient,
  videoId: string,
  tokenHash: string,
  toolName: string,
): Promise<youtube_v3.Schema$Caption[]> {
  const res = await client.captions.list({ part: ['snippet'], videoId })
  recordQuota('youtube:captions.list', tokenHash, toolName)
  return res.data.items ?? []
}

/**
 * Baixa o conteúdo da caption no formato SRT. Registra 200 quota units (CARO).
 * Cache externo OBRIGATÓRIO para evitar repetições.
 */
export async function downloadCaption(
  client: YouTubeClient,
  captionId: string,
  tokenHash: string,
  toolName: string,
): Promise<string> {
  const res = await client.captions.download({ id: captionId, tfmt: 'srt' })
  recordQuota('youtube:captions.download', tokenHash, toolName)
  // res.data pode ser string OU Blob/Buffer dependendo do client; normalizamos para string
  if (typeof res.data === 'string') return res.data
  if (res.data instanceof Buffer) return res.data.toString('utf-8')
  // Última opção: stringify (raro)
  return String(res.data ?? '')
}

// ─── Batch fetch (v0.2 task-004 — RF-1.7, RF-1.8) ─────────────────────────────

/**
 * Busca múltiplos vídeos por ID em lotes de até 50 (limite oficial videos.list).
 *
 * Vantagem: 50 IDs = 1 chamada API = 1 quota unit (vs 50 chamadas = 50 units no
 * padrão antigo `Promise.all(ids.map(getVideoById))`).
 *
 * - Filtra IDs inválidos via regex preventivamente (segurança + economia).
 * - Preserva a ordem dos IDs de entrada (positions com `null` para não-encontrados).
 * - Registra 1 quota unit por chunk no quota_log (se tokenHash + toolName providos).
 * - Cacheável: dado o conjunto ordenado de IDs, cache hit no 2º call (TTL 6h).
 */
export async function getVideosByIdsBatched(
  client: YouTubeClient,
  ids: readonly string[],
  options: { tokenHash?: string; toolName?: string; useCache?: boolean } = {},
): Promise<Array<youtube_v3.Schema$Video | null>> {
  const validIds = ids.filter((id) => VIDEO_ID_REGEX.test(id))
  if (validIds.length === 0) return ids.map(() => null)

  const fetcher = async (): Promise<youtube_v3.Schema$Video[]> => {
    const all: youtube_v3.Schema$Video[] = []
    for (let i = 0; i < validIds.length; i += VIDEOS_LIST_CHUNK_SIZE) {
      const chunk = validIds.slice(i, i + VIDEOS_LIST_CHUNK_SIZE)
      const res = await client.videos.list({
        part: ['snippet', 'statistics', 'contentDetails'],
        id: chunk,
      })
      all.push(...(res.data.items ?? []))

      if (options.tokenHash && options.toolName) {
        recordQuota('youtube:videos.list', options.tokenHash, options.toolName)
      }
    }
    return all
  }

  const allVideos =
    options.useCache !== false && options.tokenHash
      ? await withCache(
          'videos_batch',
          { ids: [...validIds].sort() }, // chave determinística independente de ordem
          options.tokenHash,
          fetcher,
        )
      : await fetcher()

  // Preserva ordem dos IDs de entrada
  const byId = new Map<string, youtube_v3.Schema$Video>()
  for (const v of allVideos) {
    if (v.id) byId.set(v.id, v)
  }
  return ids.map((id) => byId.get(id) ?? null)
}
