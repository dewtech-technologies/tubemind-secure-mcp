import {
  GetVideoTagsSchema,
  UpdateVideoMetadataSchema,
  ListChannelVideosSchema,
} from '../schemas/input.schemas.js'
import {
  getYouTubeClient,
  getVideoById,
  updateVideoMetadata as updateMetadataService,
  listChannelVideos as listVideosService,
} from '../services/youtube.service.js'
import { checkRateLimit } from '../security/rate-limiter.service.js'
import { withAudit } from '../security/audit.service.js'

// ─── get_video_tags ───────────────────────────────────────────────────────────

export const getVideoTagsDefinition = {
  name: 'get_video_tags',
  description: 'Extrai as tags de qualquer vídeo público do YouTube pelo ID do vídeo.',
  inputSchema: {
    type: 'object',
    properties: {
      videoId: { type: 'string', description: 'ID do vídeo (11 caracteres, ex: dQw4w9WgXcQ)' },
    },
    required: ['videoId'],
  },
} as const

export async function getVideoTags(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('GET_VIDEO_TAGS', 'get_video_tags', async () => {
    checkRateLimit('get_video_tags')

    const { videoId } = GetVideoTagsSchema.parse(rawInput)
    const client = getYouTubeClient(accessToken)
    const video = await getVideoById(client, videoId)

    if (!video) return `Vídeo "${videoId}" não encontrado ou é privado.`

    const tags = video.snippet?.tags ?? []
    const title = video.snippet?.title ?? 'Sem título'
    const views = parseInt(video.statistics?.viewCount ?? '0', 10).toLocaleString('pt-BR')

    if (tags.length === 0) {
      return `O vídeo **"${title}"** não possui tags públicas.\nViews: ${views}`
    }

    return [
      `## Tags do vídeo: "${title}"`,
      `Views: ${views} | Total de tags: ${tags.length}`,
      '',
      tags.map((t, i) => `${i + 1}. \`${t}\``).join('\n'),
    ].join('\n')
  })
}

// ─── update_video_metadata ────────────────────────────────────────────────────

export const updateVideoMetadataDefinition = {
  name: 'update_video_metadata',
  description:
    'Aplica título, descrição e tags otimizados em um vídeo já publicado no canal autenticado.',
  inputSchema: {
    type: 'object',
    properties: {
      videoId: { type: 'string', description: 'ID do vídeo a atualizar' },
      title: { type: 'string', description: 'Novo título (máx. 100 chars)' },
      description: { type: 'string', description: 'Nova descrição (máx. 5000 chars)' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Lista de tags' },
      categoryId: { type: 'string', description: 'ID da categoria (opcional)' },
    },
    required: ['videoId', 'title', 'description', 'tags'],
  },
} as const

export async function updateVideoMetadata(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('UPDATE_VIDEO_METADATA', 'update_video_metadata', async () => {
    checkRateLimit('update_video_metadata')

    const input = UpdateVideoMetadataSchema.parse(rawInput)
    const client = getYouTubeClient(accessToken)

    // Verifica se o vídeo pertence ao canal autenticado
    const channelRes = await client.channels.list({ part: ['id'], mine: true })
    const myChannelId = channelRes.data.items?.[0]?.id

    const video = await getVideoById(client, input.videoId)
    if (!video) throw new Error(`Vídeo "${input.videoId}" não encontrado.`)

    if (video.snippet?.channelId !== myChannelId) {
      throw new Error('[auth] Você não tem permissão para editar este vídeo.')
    }

    await updateMetadataService(
      client,
      input.videoId,
      input.title,
      input.description,
      input.tags,
      input.categoryId,
    )

    return [
      `## ✅ Metadados atualizados com sucesso`,
      '',
      `**Vídeo:** ${input.videoId}`,
      `**Título:** ${input.title}`,
      `**Tags:** ${input.tags.length} tags aplicadas`,
      `**Descrição:** ${input.description.length} caracteres`,
    ].join('\n')
  })
}

// ─── list_channel_videos ──────────────────────────────────────────────────────

export const listChannelVideosDefinition = {
  name: 'list_channel_videos',
  description: 'Lista os vídeos do canal autenticado com título, views, likes e data de publicação.',
  inputSchema: {
    type: 'object',
    properties: {
      maxResults: { type: 'number', description: 'Número de vídeos (1-50)', default: 20 },
      order: { type: 'string', description: 'Ordenação: date, viewCount, rating, title', default: 'date' },
    },
  },
} as const

export async function listChannelVideos(rawInput: unknown, accessToken: string): Promise<string> {
  return withAudit('LIST_CHANNEL_VIDEOS', 'list_channel_videos', async () => {
    checkRateLimit('list_channel_videos')

    const input = ListChannelVideosSchema.parse(rawInput ?? {})
    const client = getYouTubeClient(accessToken)
    const videos = await listVideosService(client, input.maxResults, input.order)

    if (videos.length === 0) return 'Nenhum vídeo encontrado no canal.'

    const formatted = videos.map((v, i) => {
      const title = v.snippet?.title ?? 'Sem título'
      const views = parseInt(v.statistics?.viewCount ?? '0', 10).toLocaleString('pt-BR')
      const likes = parseInt(v.statistics?.likeCount ?? '0', 10).toLocaleString('pt-BR')
      const date = v.snippet?.publishedAt?.split('T')[0] ?? ''
      const id = v.id ?? ''
      return `${i + 1}. **${title}**\n   Views: ${views} | Likes: ${likes} | Data: ${date}\n   ID: \`${id}\``
    })

    return `## Vídeos do Canal (${input.order})\n\n${formatted.join('\n\n')}`
  })
}
