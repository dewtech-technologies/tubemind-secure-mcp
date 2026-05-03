import { z } from 'zod'

// Regex base: aceita letras (incluindo acentos), números, espaços e hífen
const safeTextRegex = /^[a-zA-Z0-9\s\-áéíóúâêîôûãõçàèìòùÁÉÍÓÚÂÊÎÔÛÃÕÇÀÈÌÒÙ.,!?]+$/

const SafeString = (maxLength: number) =>
  z.string()
    .min(1, 'Campo obrigatório')
    .max(maxLength, `Máximo ${maxLength} caracteres`)
    .regex(safeTextRegex, 'Caracteres não permitidos')
    .transform(s => s.trim())

// ─── Search ───────────────────────────────────────────────────────────────────

export const SearchTrendingSchema = z.object({
  query: SafeString(200),
  maxResults: z.number().int().min(1).max(50).default(10),
  regionCode: z.enum(['BR', 'US', 'PT', 'ES', 'AR']).default('BR'),
  order: z.enum(['relevance', 'viewCount', 'date', 'rating']).default('relevance'),
})

export const GetKeywordStatsSchema = z.object({
  keyword: SafeString(200),
  regionCode: z.enum(['BR', 'US', 'PT', 'ES', 'AR']).default('BR'),
  maxVideos: z.number().int().min(5).max(20).default(10),
})

// ─── Video ────────────────────────────────────────────────────────────────────

export const GetVideoTagsSchema = z.object({
  videoId: z.string()
    .min(11).max(11)
    .regex(/^[a-zA-Z0-9_-]{11}$/, 'ID de vídeo inválido'),
})

export const UpdateVideoMetadataSchema = z.object({
  videoId: z.string()
    .min(11).max(11)
    .regex(/^[a-zA-Z0-9_-]{11}$/, 'ID de vídeo inválido'),
  title: z.string().min(1).max(100).transform(s => s.trim()),
  description: z.string().max(5000).transform(s => s.trim()),
  tags: z.array(
    z.string().min(1).max(30).transform(s => s.trim())
  ).max(500),
  categoryId: z.string().regex(/^\d+$/).optional(),
})

export const SuggestTagsSchema = z.object({
  keyword: SafeString(200),
  videoCount: z.number().int().min(3).max(15).default(8),
  regionCode: z.enum(['BR', 'US', 'PT', 'ES', 'AR']).default('BR'),
})

export const ListChannelVideosSchema = z.object({
  maxResults: z.number().int().min(1).max(50).default(20),
  order: z.enum(['date', 'viewCount', 'rating', 'title']).default('date'),
})

// ─── Analytics ────────────────────────────────────────────────────────────────

const dateRegex = /^\d{4}-\d{2}-\d{2}$/

export const GetChannelAnalyticsSchema = z.object({
  startDate: z.string()
    .regex(dateRegex, 'Formato: YYYY-MM-DD')
    .refine(d => !isNaN(Date.parse(d)), 'Data inválida'),
  endDate: z.string()
    .regex(dateRegex, 'Formato: YYYY-MM-DD')
    .refine(d => !isNaN(Date.parse(d)), 'Data inválida'),
  metrics: z.array(
    z.enum(['views', 'likes', 'comments', 'subscribersGained', 'estimatedMinutesWatched', 'averageViewDuration'])
  ).min(1).max(6).default(['views', 'likes', 'subscribersGained']),
}).refine(
  data => new Date(data.startDate) <= new Date(data.endDate),
  { message: 'startDate deve ser anterior ou igual a endDate' }
)

// ─── Competitor ───────────────────────────────────────────────────────────────

export const GetCompetitorVideosSchema = z.object({
  channelId: z.string()
    .min(24).max(24)
    .regex(/^UC[a-zA-Z0-9_-]{22}$/, 'Channel ID inválido'),
  maxResults: z.number().int().min(1).max(50).default(10),
  order: z.enum(['date', 'viewCount', 'rating']).default('viewCount'),
})

export type SearchTrendingInput = z.infer<typeof SearchTrendingSchema>
export type GetKeywordStatsInput = z.infer<typeof GetKeywordStatsSchema>
export type GetVideoTagsInput = z.infer<typeof GetVideoTagsSchema>
export type UpdateVideoMetadataInput = z.infer<typeof UpdateVideoMetadataSchema>
export type SuggestTagsInput = z.infer<typeof SuggestTagsSchema>
export type ListChannelVideosInput = z.infer<typeof ListChannelVideosSchema>
export type GetChannelAnalyticsInput = z.infer<typeof GetChannelAnalyticsSchema>
export type GetCompetitorVideosInput = z.infer<typeof GetCompetitorVideosSchema>
