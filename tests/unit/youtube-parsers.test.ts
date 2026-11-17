import { describe, it, expect } from 'vitest'
import {
  parseYouTubeUrl,
  toChannelRef,
  parseIsoDuration,
  formatSeconds,
  parseChapters,
} from '../../src/utils/youtube-parsers.js'

const VID = 'dQw4w9WgXcQ'
const UC = 'UC_x33Gz4LvnOZuC_4v7Qucg'
const PL = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'

describe('parseYouTubeUrl', () => {
  it('should_parse_watch_url_with_playlist_and_time', () => {
    expect(parseYouTubeUrl(`https://www.youtube.com/watch?v=${VID}&list=${PL}&t=1m30s`)).toEqual({
      type: 'video', videoId: VID, playlistId: PL, startSeconds: 90,
    })
  })

  it('should_parse_short_link_youtu_be', () => {
    expect(parseYouTubeUrl(`https://youtu.be/${VID}?t=42`)).toEqual({ type: 'video', videoId: VID, startSeconds: 42 })
  })

  it('should_parse_shorts_live_and_embed', () => {
    expect(parseYouTubeUrl(`youtube.com/shorts/${VID}`)).toEqual({ type: 'short', videoId: VID })
    expect(parseYouTubeUrl(`https://www.youtube.com/live/${VID}`)).toEqual({ type: 'live', videoId: VID })
    expect(parseYouTubeUrl(`https://www.youtube.com/embed/${VID}`)).toEqual({ type: 'video', videoId: VID })
  })

  it('should_parse_playlist_channel_and_handle_urls', () => {
    expect(parseYouTubeUrl(`https://www.youtube.com/playlist?list=${PL}`)).toEqual({ type: 'playlist', playlistId: PL })
    expect(parseYouTubeUrl(`https://www.youtube.com/channel/${UC}`)).toEqual({ type: 'channel', channelId: UC })
    expect(parseYouTubeUrl('https://www.youtube.com/@dewtech/videos')).toEqual({ type: 'handle', handle: '@dewtech' })
  })

  it('should_accept_raw_ids_and_handles', () => {
    expect(parseYouTubeUrl(VID)).toEqual({ type: 'video', videoId: VID })
    expect(parseYouTubeUrl(UC)).toEqual({ type: 'channel', channelId: UC })
    expect(parseYouTubeUrl('@dewtech')).toEqual({ type: 'handle', handle: '@dewtech' })
    expect(parseYouTubeUrl(PL)).toEqual({ type: 'playlist', playlistId: PL })
  })

  it('should_flag_legacy_channel_urls', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/user/somebody')).toEqual({ type: 'legacy_channel', name: 'somebody' })
  })

  it('should_reject_non_youtube_domains_and_bad_protocols', () => {
    expect(parseYouTubeUrl(`https://evil.com/watch?v=${VID}`).type).toBe('unknown')
    expect(parseYouTubeUrl(`https://youtube.com.evil.com/watch?v=${VID}`).type).toBe('unknown')
    expect(parseYouTubeUrl('javascript:alert(1)').type).toBe('unknown')
    expect(parseYouTubeUrl('ftp://youtube.com/x').type).toBe('unknown')
  })

  it('should_reject_invalid_video_ids', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=short').type).toBe('unknown')
    expect(parseYouTubeUrl('https://youtu.be/../../etc').type).toBe('unknown')
  })
})

describe('toChannelRef', () => {
  it('should_return_id_or_handle_and_null_for_videos', () => {
    expect(toChannelRef(UC)).toEqual({ kind: 'id', value: UC })
    expect(toChannelRef('https://youtube.com/@dewtech')).toEqual({ kind: 'handle', value: '@dewtech' })
    expect(toChannelRef(VID)).toBeNull()
  })
})

describe('parseIsoDuration / formatSeconds', () => {
  it('should_convert_iso_durations', () => {
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723)
    expect(parseIsoDuration('PT45S')).toBe(45)
    expect(parseIsoDuration('P1DT1M')).toBe(86460)
    expect(parseIsoDuration('P0D')).toBe(0)
    expect(parseIsoDuration('garbage')).toBe(0)
    expect(parseIsoDuration(undefined)).toBe(0)
  })

  it('should_format_seconds', () => {
    expect(formatSeconds(3723)).toBe('1:02:03')
    expect(formatSeconds(245)).toBe('4:05')
    expect(formatSeconds(-5)).toBe('0:00')
  })
})

describe('parseChapters', () => {
  it('should_extract_valid_chapters', () => {
    const desc = 'Intro do vídeo\n\n0:00 Abertura\n1:30 - Setup\n(12:05) Demo\n1:02:00 | Conclusão'
    expect(parseChapters(desc)).toEqual([
      { startSeconds: 0, title: 'Abertura' },
      { startSeconds: 90, title: 'Setup' },
      { startSeconds: 725, title: 'Demo' },
      { startSeconds: 3720, title: 'Conclusão' },
    ])
  })

  it('should_require_start_at_zero_and_at_least_three', () => {
    expect(parseChapters('0:30 A\n1:00 B\n2:00 C')).toEqual([])
    expect(parseChapters('0:00 A\n1:00 B')).toEqual([])
    expect(parseChapters(null)).toEqual([])
  })

  it('should_skip_non_increasing_timestamps', () => {
    expect(parseChapters('0:00 A\n2:00 B\n1:00 X\n3:00 C')).toEqual([
      { startSeconds: 0, title: 'A' },
      { startSeconds: 120, title: 'B' },
      { startSeconds: 180, title: 'C' },
    ])
  })
})
