/**
 * Parsers puros (sem I/O) para identificadores e formatos do YouTube.
 * Usados pelas tools de dados (channel/playlist/video) — custo de quota zero.
 */

export const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/
export const CHANNEL_ID_REGEX = /^UC[a-zA-Z0-9_-]{22}$/
export const PLAYLIST_ID_REGEX = /^(PL|UU|LL|FL|OL|RD)[a-zA-Z0-9_-]{10,64}$/
// Handle: 3–30 chars, letras/números/._- (regra pública do YouTube)
export const HANDLE_REGEX = /^@[a-zA-Z0-9._-]{3,30}$/

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
])

export type ChannelRef =
  | { kind: 'id'; value: string }
  | { kind: 'handle'; value: string }

export type ParsedYouTubeUrl =
  | { type: 'video'; videoId: string; playlistId?: string; startSeconds?: number }
  | { type: 'short'; videoId: string }
  | { type: 'live'; videoId: string }
  | { type: 'playlist'; playlistId: string }
  | { type: 'channel'; channelId: string }
  | { type: 'handle'; handle: string }
  | { type: 'legacy_channel'; name: string }
  | { type: 'unknown'; reason: string }

/** Converte "1h2m3s", "90s" ou "123" em segundos. */
function parseTimeParam(raw: string | null): number | undefined {
  if (!raw) return undefined
  if (/^\d+$/.test(raw)) return parseInt(raw, 10)
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw)
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined
  return (parseInt(m[1] ?? '0', 10) * 3600) + (parseInt(m[2] ?? '0', 10) * 60) + parseInt(m[3] ?? '0', 10)
}

/**
 * Identifica o tipo de uma URL do YouTube e extrai os IDs.
 * Aceita também IDs/handles crus (UC..., @handle, ID de vídeo, ID de playlist).
 * Nunca faz requisição de rede.
 */
export function parseYouTubeUrl(input: string): ParsedYouTubeUrl {
  const raw = input.trim()

  if (CHANNEL_ID_REGEX.test(raw)) return { type: 'channel', channelId: raw }
  if (HANDLE_REGEX.test(raw)) return { type: 'handle', handle: raw }
  if (PLAYLIST_ID_REGEX.test(raw)) return { type: 'playlist', playlistId: raw }
  if (VIDEO_ID_REGEX.test(raw)) return { type: 'video', videoId: raw }

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return { type: 'unknown', reason: 'Texto não é uma URL nem um ID do YouTube' }
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { type: 'unknown', reason: 'Protocolo não suportado' }
  }
  const host = url.hostname.toLowerCase()
  if (!YOUTUBE_HOSTS.has(host)) {
    return { type: 'unknown', reason: `Domínio "${host}" não é do YouTube` }
  }

  const segments = url.pathname.split('/').filter(Boolean)
  const startSeconds = parseTimeParam(url.searchParams.get('t') ?? url.searchParams.get('start'))
  const listParam = url.searchParams.get('list')
  const playlistId = listParam && PLAYLIST_ID_REGEX.test(listParam) ? listParam : undefined

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const id = segments[0] ?? ''
    if (!VIDEO_ID_REGEX.test(id)) return { type: 'unknown', reason: 'ID de vídeo inválido no link curto' }
    return {
      type: 'video',
      videoId: id,
      ...(playlistId ? { playlistId } : {}),
      ...(startSeconds !== undefined ? { startSeconds } : {}),
    }
  }

  const [first, second] = segments

  if (first === 'watch') {
    const v = url.searchParams.get('v') ?? ''
    if (VIDEO_ID_REGEX.test(v)) {
      return {
        type: 'video',
        videoId: v,
        ...(playlistId ? { playlistId } : {}),
        ...(startSeconds !== undefined ? { startSeconds } : {}),
      }
    }
    if (playlistId) return { type: 'playlist', playlistId }
    return { type: 'unknown', reason: 'Parâmetro v ausente ou inválido' }
  }

  if (first === 'playlist') {
    if (playlistId) return { type: 'playlist', playlistId }
    return { type: 'unknown', reason: 'Parâmetro list ausente ou inválido' }
  }

  if ((first === 'shorts' || first === 'live' || first === 'embed' || first === 'v') && second) {
    if (!VIDEO_ID_REGEX.test(second)) return { type: 'unknown', reason: 'ID de vídeo inválido' }
    if (first === 'shorts') return { type: 'short', videoId: second }
    if (first === 'live') return { type: 'live', videoId: second }
    return { type: 'video', videoId: second }
  }

  if (first === 'channel' && second) {
    if (CHANNEL_ID_REGEX.test(second)) return { type: 'channel', channelId: second }
    return { type: 'unknown', reason: 'Channel ID inválido' }
  }

  if (first?.startsWith('@')) {
    const handle = decodeURIComponent(first)
    if (HANDLE_REGEX.test(handle)) return { type: 'handle', handle }
    return { type: 'unknown', reason: 'Handle inválido' }
  }

  if ((first === 'c' || first === 'user') && second && /^[a-zA-Z0-9._-]{1,100}$/.test(second)) {
    return { type: 'legacy_channel', name: second }
  }

  return { type: 'unknown', reason: 'Formato de URL do YouTube não reconhecido' }
}

/**
 * Normaliza a referência a um canal: aceita UC..., @handle ou URL de canal.
 * Retorna null se não for um canal reconhecível.
 */
export function toChannelRef(input: string): ChannelRef | null {
  const parsed = parseYouTubeUrl(input)
  if (parsed.type === 'channel') return { kind: 'id', value: parsed.channelId }
  if (parsed.type === 'handle') return { kind: 'handle', value: parsed.handle }
  return null
}

/** Duração ISO-8601 do YouTube (PT1H2M3S, P1DT2H) → segundos. */
export function parseIsoDuration(iso: string | null | undefined): number {
  if (!iso) return 0
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso)
  if (!m) return 0
  const [, d, h, min, s] = m
  return (parseInt(d ?? '0', 10) * 86400)
    + (parseInt(h ?? '0', 10) * 3600)
    + (parseInt(min ?? '0', 10) * 60)
    + parseInt(s ?? '0', 10)
}

/** Segundos → "1:02:03" ou "4:05". */
export function formatSeconds(total: number): string {
  const safe = Math.max(0, Math.floor(total))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export interface Chapter {
  readonly startSeconds: number
  readonly title: string
}

const CHAPTER_LINE_REGEX = /^\s*[([]?((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?\s*[-–—:|]?\s*(.+?)\s*$/

function timestampToSeconds(ts: string): number {
  return ts.split(':').reduce((acc, part) => acc * 60 + parseInt(part, 10), 0)
}

/**
 * Extrai capítulos da descrição seguindo a regra do YouTube:
 * primeiro capítulo em 0:00, no mínimo 3 capítulos, timestamps crescentes.
 * Retorna [] se a descrição não tiver capítulos válidos.
 */
export function parseChapters(description: string | null | undefined): Chapter[] {
  if (!description) return []
  const chapters: Chapter[] = []
  for (const line of description.split(/\r?\n/)) {
    const m = CHAPTER_LINE_REGEX.exec(line)
    if (!m || !m[1] || !m[2]) continue
    const startSeconds = timestampToSeconds(m[1])
    const last = chapters[chapters.length - 1]
    if (last && startSeconds <= last.startSeconds) continue
    chapters.push({ startSeconds, title: m[2].slice(0, 100) })
  }
  if (chapters.length < 3 || chapters[0]?.startSeconds !== 0) return []
  return chapters
}
