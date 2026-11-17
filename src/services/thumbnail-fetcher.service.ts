/**
 * Thumbnail Fetcher — download seguro de thumbnails YouTube com strip de EXIF.
 *
 * Controles aplicados (RS-2.1 a RS-2.4):
 * - SSRF guard: whitelist de hosts via ssrf-guard.service
 * - Limite de tamanho 5MB
 * - Content-Type validation (image/*)
 * - Strip de EXIF/metadata via sharp + re-encode JPEG quality 90
 * - Timeout 10s
 */

import sharp from 'sharp'
import { validateUrl, SsrfGuardError } from '../security/ssrf-guard.service.js'

export class ThumbnailFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ThumbnailFetchError'
  }
}

const MAX_BYTES = 5 * 1024 * 1024 // 5MB (RS-2.2)
const FETCH_TIMEOUT_MS = 10_000

export interface FetchedThumbnail {
  buffer: Buffer
  mediaType: 'image/jpeg'
  width: number
  height: number
  originalBytes: number
}

/**
 * Resolve URL canonical de uma thumbnail por videoId, tentando maxres → hq → mq → default.
 * Retorna o primeiro URL que retorna 200; null se todos falharem.
 */
export async function resolveThumbnailUrl(videoId: string): Promise<string | null> {
  const candidates = [
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/default.jpg`,
  ]

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (res.ok) return url
    } catch {
      // tenta próxima
    }
  }
  return null
}

/**
 * Baixa a thumbnail, valida tamanho/content-type, strip EXIF, retorna Buffer normalizado.
 *
 * Side effects: nenhum (não persiste no disco — RNF-2.5).
 */
export async function fetchThumbnail(rawUrl: string): Promise<FetchedThumbnail> {
  // Validação SSRF antes de qualquer rede
  let url: URL
  try {
    url = validateUrl(rawUrl)
  } catch (err) {
    if (err instanceof SsrfGuardError) throw err
    throw new ThumbnailFetchError('URL inválida')
  }

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new ThumbnailFetchError(`Falha ao baixar thumbnail (status ${response.status})`)
  }

  // Content-Type whitelist (RS-2.4)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) {
    throw new ThumbnailFetchError(`Content-Type não é imagem: ${contentType}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Tamanho max 5MB (RS-2.2)
  if (buffer.length > MAX_BYTES) {
    throw new ThumbnailFetchError(`Thumbnail > 5MB (${buffer.length} bytes)`)
  }

  // Strip EXIF + normalize para JPEG (RS-2.3 — EXIF pode vazar GPS/device info)
  // sharp().rotate() aplica orientation EXIF e depois descarta
  const processed = await sharp(buffer).rotate().jpeg({ quality: 90 }).toBuffer({
    resolveWithObject: true,
  })

  return {
    buffer: processed.data,
    mediaType: 'image/jpeg',
    width: processed.info.width,
    height: processed.info.height,
    originalBytes: buffer.length,
  }
}
