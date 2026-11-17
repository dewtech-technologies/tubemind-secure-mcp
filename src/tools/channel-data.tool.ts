import {
  GetChannelDetailsSchema,
  ListChannelPlaylistsSchema,
  GetPlaylistItemsSchema,
  BatchLookupSchema,
  ResolveYouTubeUrlSchema,
} from '../schemas/input.schemas.js'
import { getYouTubeClient, getVideosByIdsBatched } from '../services/youtube.service.js'
import {
  getChannel,
  resolveChannelId,
  listChannelPlaylists as listPlaylistsService,
  getPlaylistWithItems,
  getChannelsByIdsBatched,
  type Ctx,
} from '../services/youtube-data.service.js'
import { checkRateLimit } from '../security/rate-limiter.service.js'
import { withAudit } from '../security/audit.service.js'
import { sanitizeBody } from '../security/prompt-sanitizer.service.js'
import { redactPII } from '../security/pii-filter.service.js'
import { sha256 } from '../utils/hash.js'
import {
  toChannelRef,
  parseYouTubeUrl,
  parseIsoDuration,
  formatSeconds,
} from '../utils/youtube-parsers.js'

const CHANNEL_INPUT_HELP = 'Canal: Channel ID (UC...), @handle ou URL do canal'

/** Texto de terceiros (descrições) → sem PII, escapado e truncado. */
function untrusted(text: string | null | undefined, max: number): string {
  return sanitizeBody(redactPII(text ?? ''), max)
}

function num(value: string | null | undefined): string {
  return parseInt(value ?? '0', 10).toLocaleString('pt-BR')
}

function ctxFor(accessToken: string, toolName: string): Ctx {
  return { tokenHash: sha256(accessToken), toolName }
}

function requireChannelRef(input: string) {
  const ref = toChannelRef(input)
  if (!ref) throw new Error(`Canal inválido: "${input}". Use UC..., @handle ou URL do canal.`)
  return ref
}

function nextPageLine(token: string | null): string[] {
  return token ? ['', `_Próxima página: \`pageToken: "${token}"\`_`] : []
}

// ─── get_channel_details ──────────────────────────────────────────────────────

export const getChannelDetailsDefinition = {
  name: 'get_channel_details',
  description:
    'Dados públicos de um canal: nome, @handle, inscritos, views totais, nº de vídeos, país, data de criação, descrição, links de playlist de uploads e tópicos. Aceita UC..., @handle ou URL. Custo: 1 unit.',
  inputSchema: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: CHANNEL_INPUT_HELP },
    },
    required: ['channel'],
  },
} as const

export async function getChannelDetails(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('GET_CHANNEL_DETAILS', 'get_channel_details', async () => {
    checkRateLimit('get_channel_details')
    const { channel } = GetChannelDetailsSchema.parse(rawInput)
    const ref = requireChannelRef(channel)

    const client = getYouTubeClient(accessToken)
    const ch = await getChannel(client, ref, ctxFor(accessToken, 'get_channel_details'))
    if (!ch) return `Canal "${channel}" não encontrado.`

    const s = ch.snippet
    const st = ch.statistics
    const topics = (ch.topicDetails?.topicCategories ?? [])
      .map((u) => decodeURIComponent(u.split('/').pop() ?? '').replace(/_/g, ' '))
      .filter(Boolean)

    return [
      `## ${untrusted(s?.title, 150)}`,
      '',
      `**Channel ID:** \`${ch.id ?? ''}\`${s?.customUrl ? ` | **Handle:** ${untrusted(s.customUrl, 60)}` : ''}`,
      `**Inscritos:** ${st?.hiddenSubscriberCount ? 'ocultos' : num(st?.subscriberCount)} | **Views totais:** ${num(st?.viewCount)} | **Vídeos:** ${num(st?.videoCount)}`,
      `**País:** ${s?.country ?? 'não informado'} | **Criado em:** ${s?.publishedAt?.split('T')[0] ?? '?'}`,
      `**Playlist de uploads:** \`${ch.contentDetails?.relatedPlaylists?.uploads ?? '-'}\``,
      ...(topics.length > 0 ? [`**Tópicos:** ${topics.join(', ')}`] : []),
      ...(ch.brandingSettings?.channel?.keywords
        ? [`**Keywords do canal:** ${untrusted(ch.brandingSettings.channel.keywords, 300)}`]
        : []),
      '',
      '### Descrição',
      untrusted(s?.description, 1500) || '_sem descrição_',
    ].join('\n')
  })
}

// ─── list_channel_playlists ───────────────────────────────────────────────────

export const listChannelPlaylistsDefinition = {
  name: 'list_channel_playlists',
  description:
    'Lista as playlists públicas de um canal com título, nº de vídeos e ID. Paginado via pageToken. Custo: 1 unit por página (+1 se usar @handle).',
  inputSchema: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: CHANNEL_INPUT_HELP },
      maxResults: { type: 'number', description: 'Playlists por página (1-50)', default: 25 },
      pageToken: { type: 'string', description: 'Token da próxima página (opcional)' },
    },
    required: ['channel'],
  },
} as const

export async function listChannelPlaylists(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('LIST_CHANNEL_PLAYLISTS', 'list_channel_playlists', async () => {
    checkRateLimit('list_channel_playlists')
    const input = ListChannelPlaylistsSchema.parse(rawInput)
    const ref = requireChannelRef(input.channel)

    const client = getYouTubeClient(accessToken)
    const ctx = ctxFor(accessToken, 'list_channel_playlists')
    const channelId = await resolveChannelId(client, ref, ctx)
    if (!channelId) return `Canal "${input.channel}" não encontrado.`

    const page = await listPlaylistsService(client, channelId, input.maxResults, input.pageToken, ctx)
    if (page.items.length === 0) return 'O canal não tem playlists públicas.'

    const lines = page.items.map((p, i) =>
      `${i + 1}. **${untrusted(p.snippet?.title, 150)}** — ${p.contentDetails?.itemCount ?? 0} vídeos\n   ID: \`${p.id ?? ''}\` | Criada: ${p.snippet?.publishedAt?.split('T')[0] ?? '?'}`,
    )

    return [
      `## Playlists do canal \`${channelId}\``,
      page.totalResults !== null ? `Total: ${page.totalResults}` : '',
      '',
      lines.join('\n\n'),
      ...nextPageLine(page.nextPageToken),
    ].join('\n')
  })
}

// ─── get_playlist_items ───────────────────────────────────────────────────────

export const getPlaylistItemsDefinition = {
  name: 'get_playlist_items',
  description:
    'Metadados de uma playlist e seus vídeos (título, posição, duração, views, likes, data). Funciona com a playlist de uploads do canal (UU...). Paginado. Custo: 3 units por página.',
  inputSchema: {
    type: 'object',
    properties: {
      playlistId: { type: 'string', description: 'ID da playlist (PL..., UU..., etc.)' },
      maxResults: { type: 'number', description: 'Vídeos por página (1-50)', default: 25 },
      pageToken: { type: 'string', description: 'Token da próxima página (opcional)' },
    },
    required: ['playlistId'],
  },
} as const

export async function getPlaylistItems(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('GET_PLAYLIST_ITEMS', 'get_playlist_items', async () => {
    checkRateLimit('get_playlist_items')
    const input = GetPlaylistItemsSchema.parse(rawInput)

    const client = getYouTubeClient(accessToken)
    const { playlist, items, videos } = await getPlaylistWithItems(
      client, input.playlistId, input.maxResults, input.pageToken,
      ctxFor(accessToken, 'get_playlist_items'),
    )
    if (!playlist && items.items.length === 0) return `Playlist "${input.playlistId}" não encontrada ou privada.`

    const statsById = new Map(videos.map((v) => [v.id ?? '', v]))
    const lines = items.items.map((it) => {
      const vid = it.contentDetails?.videoId ?? ''
      const v = statsById.get(vid)
      const pos = (it.snippet?.position ?? 0) + 1
      const dur = v ? formatSeconds(parseIsoDuration(v.contentDetails?.duration)) : '?'
      return `${pos}. **${untrusted(it.snippet?.title, 150)}** (${dur})\n   Views: ${num(v?.statistics?.viewCount)} | Likes: ${num(v?.statistics?.likeCount)} | Publicado: ${it.contentDetails?.videoPublishedAt?.split('T')[0] ?? '?'}\n   ID: \`${vid}\``
    })

    return [
      `## Playlist: ${untrusted(playlist?.snippet?.title, 150) || input.playlistId}`,
      `Canal: ${untrusted(playlist?.snippet?.channelTitle, 100)} | Vídeos: ${playlist?.contentDetails?.itemCount ?? items.totalResults ?? '?'}`,
      ...(playlist?.snippet?.description ? ['', untrusted(playlist.snippet.description, 500)] : []),
      '',
      lines.join('\n\n') || '_playlist vazia_',
      ...nextPageLine(items.nextPageToken),
    ].join('\n')
  })
}

// ─── batch_lookup ─────────────────────────────────────────────────────────────

export const batchLookupDefinition = {
  name: 'batch_lookup',
  description:
    'Consulta até 50 vídeos ou 50 canais de uma vez e devolve as métricas principais em tabela. Custo: 1 unit por chamada (não por ID).',
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['videos', 'channels'], description: 'Tipo dos IDs' },
      ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Lista de 1 a 50 IDs (vídeo: 11 chars; canal: UC...)',
      },
    },
    required: ['type', 'ids'],
  },
} as const

function cell(text: string): string {
  return text.replace(/\|/g, '/').replace(/\r?\n/g, ' ')
}

export async function batchLookup(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('BATCH_LOOKUP', 'batch_lookup', async () => {
    checkRateLimit('batch_lookup')
    const input = BatchLookupSchema.parse(rawInput)
    const client = getYouTubeClient(accessToken)
    const ctx = ctxFor(accessToken, 'batch_lookup')

    if (input.type === 'videos') {
      const videos = await getVideosByIdsBatched(client, input.ids, { tokenHash: ctx.tokenHash, toolName: ctx.toolName })
      const rows = input.ids.map((id, i) => {
        const v = videos[i]
        if (!v) return `| \`${id}\` | _não encontrado_ | - | - | - | - | - |`
        return `| \`${id}\` | ${cell(untrusted(v.snippet?.title, 80))} | ${cell(untrusted(v.snippet?.channelTitle, 40))} | ${num(v.statistics?.viewCount)} | ${num(v.statistics?.likeCount)} | ${formatSeconds(parseIsoDuration(v.contentDetails?.duration))} | ${v.snippet?.publishedAt?.split('T')[0] ?? '?'} |`
      })
      const found = videos.filter(Boolean).length
      return [
        `## Lote de vídeos — ${found}/${input.ids.length} encontrados`,
        '',
        '| ID | Título | Canal | Views | Likes | Duração | Publicado |',
        '|---|---|---|---|---|---|---|',
        ...rows,
      ].join('\n')
    }

    const channels = await getChannelsByIdsBatched(client, input.ids, ctx)
    const rows = input.ids.map((id, i) => {
      const c = channels[i]
      if (!c) return `| \`${id}\` | _não encontrado_ | - | - | - | - |`
      const subs = c.statistics?.hiddenSubscriberCount ? 'ocultos' : num(c.statistics?.subscriberCount)
      return `| \`${id}\` | ${cell(untrusted(c.snippet?.title, 60))} | ${subs} | ${num(c.statistics?.viewCount)} | ${num(c.statistics?.videoCount)} | ${c.snippet?.country ?? '-'} |`
    })
    const found = channels.filter(Boolean).length
    return [
      `## Lote de canais — ${found}/${input.ids.length} encontrados`,
      '',
      '| ID | Canal | Inscritos | Views | Vídeos | País |',
      '|---|---|---|---|---|---|',
      ...rows,
    ].join('\n')
  })
}

// ─── resolve_youtube_url ──────────────────────────────────────────────────────

export const resolveYouTubeUrlDefinition = {
  name: 'resolve_youtube_url',
  description:
    'Identifica o tipo de uma URL do YouTube (vídeo, Short, live, playlist, canal, @handle) e extrai os IDs, prontos para usar nas outras tools. Custo: 0 units (1 unit apenas se precisar converter @handle em Channel ID).',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL do YouTube, ID ou @handle' },
      resolveHandle: { type: 'boolean', description: 'Converter @handle em Channel ID (1 unit)', default: true },
    },
    required: ['url'],
  },
} as const

export async function resolveYouTubeUrl(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('RESOLVE_YOUTUBE_URL', 'resolve_youtube_url', async () => {
    checkRateLimit('resolve_youtube_url')
    const input = ResolveYouTubeUrlSchema.parse(rawInput)
    const parsed = parseYouTubeUrl(input.url)

    switch (parsed.type) {
      case 'video':
        return [
          '**Tipo:** vídeo',
          `**videoId:** \`${parsed.videoId}\``,
          ...(parsed.playlistId ? [`**playlistId:** \`${parsed.playlistId}\``] : []),
          ...(parsed.startSeconds !== undefined ? [`**Início em:** ${formatSeconds(parsed.startSeconds)}`] : []),
        ].join('\n')
      case 'short':
        return `**Tipo:** Short\n**videoId:** \`${parsed.videoId}\``
      case 'live':
        return `**Tipo:** live\n**videoId:** \`${parsed.videoId}\``
      case 'playlist':
        return `**Tipo:** playlist\n**playlistId:** \`${parsed.playlistId}\``
      case 'channel':
        return `**Tipo:** canal\n**channelId:** \`${parsed.channelId}\``
      case 'handle': {
        if (!input.resolveHandle) return `**Tipo:** canal (@handle)\n**handle:** ${parsed.handle}`
        const client = getYouTubeClient(accessToken)
        const id = await resolveChannelId(
          client, { kind: 'handle', value: parsed.handle }, ctxFor(accessToken, 'resolve_youtube_url'),
        )
        return id
          ? `**Tipo:** canal (@handle)\n**handle:** ${parsed.handle}\n**channelId:** \`${id}\``
          : `**Tipo:** canal (@handle)\n**handle:** ${parsed.handle}\nNenhum canal encontrado com esse handle.`
      }
      case 'legacy_channel':
        return `**Tipo:** canal (URL legada /c/ ou /user/)\n**nome:** ${parsed.name}\nURLs legadas não têm conversão direta na API. Abra o canal e use o @handle ou o Channel ID.`
      case 'unknown':
        return `Não foi possível identificar: ${parsed.reason}.`
    }
  })
}
