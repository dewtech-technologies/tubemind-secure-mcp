/**
 * Parser SRT/VTT inline (sem dep externa).
 *
 * Suporta formato padrão:
 *   1
 *   00:00:01,000 --> 00:00:04,500
 *   Texto da legenda
 *
 *   2
 *   ...
 *
 * VTT também aceita `.` em vez de `,` no separador de ms.
 */

export interface SrtCue {
  startMs: number
  endMs: number
  text: string
}

const TIME_REGEX =
  /(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/

function toMs(h: string, m: string, s: string, ms: string): number {
  return (
    parseInt(h, 10) * 3_600_000 +
    parseInt(m, 10) * 60_000 +
    parseInt(s, 10) * 1_000 +
    parseInt(ms.padEnd(3, '0').slice(0, 3), 10)
  )
}

export function parseSRT(raw: string): SrtCue[] {
  // Remove BOM + linhas WEBVTT header se presente
  const cleaned = raw.replace(/^﻿/, '').replace(/^WEBVTT.*\n/i, '')
  // Splits por blocos vazios (\n\n)
  const blocks = cleaned.split(/\r?\n\r?\n/).filter((b) => b.trim())

  const cues: SrtCue[] = []
  for (const block of blocks) {
    const lines = block.split(/\r?\n/)
    // Linha de tempo pode estar na 1ª (VTT sem index) ou 2ª (SRT com index numérico)
    let timeLineIdx = lines.findIndex((l) => TIME_REGEX.test(l))
    if (timeLineIdx === -1) continue

    const timeLine = lines[timeLineIdx]
    if (!timeLine) continue
    const match = TIME_REGEX.exec(timeLine)
    if (!match) continue

    const textLines = lines.slice(timeLineIdx + 1).filter((l) => l.trim())
    if (textLines.length === 0) continue

    cues.push({
      startMs: toMs(match[1]!, match[2]!, match[3]!, match[4]!),
      endMs: toMs(match[5]!, match[6]!, match[7]!, match[8]!),
      text: textLines.join(' ').replace(/<[^>]+>/g, '').trim(),
    })
  }
  return cues
}

/**
 * Consolida cues em texto contínuo com markers de timestamp a cada N minutos.
 * Útil para enviar ao LLM mantendo referência temporal.
 */
export function cuesToAnnotatedText(cues: SrtCue[], intervalMinutes: number = 1): string {
  const out: string[] = []
  let nextMarker = 0
  for (const cue of cues) {
    if (cue.startMs >= nextMarker) {
      const mm = Math.floor(cue.startMs / 60_000)
      const ss = Math.floor((cue.startMs % 60_000) / 1000)
      out.push(`\n[${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}]`)
      nextMarker = cue.startMs + intervalMinutes * 60_000
    }
    out.push(cue.text)
  }
  return out.join(' ').trim()
}
