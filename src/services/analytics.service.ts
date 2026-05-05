import { google, youtubeAnalytics_v2 } from 'googleapis'
import { assertAllowedDomain } from '../security/ssrf-guard.service.js'

assertAllowedDomain('youtubeanalytics.googleapis.com')

export type AnalyticsClient = youtubeAnalytics_v2.Youtubeanalytics

export function getAnalyticsClient(accessToken: string): AnalyticsClient {
  const auth = new google.auth.OAuth2(
    process.env['YOUTUBE_CLIENT_ID'],
    process.env['YOUTUBE_CLIENT_SECRET'],
    process.env['YOUTUBE_REDIRECT_URI'],
  )
  auth.setCredentials({ access_token: accessToken })
  return google.youtubeAnalytics({ version: 'v2', auth })
}

export interface AnalyticsRow {
  day: string
  [metric: string]: string | number
}

export interface AnalyticsReport {
  headers: string[]
  rows: AnalyticsRow[]
  totals: Record<string, number>
}

export async function queryChannelAnalytics(
  client: AnalyticsClient,
  startDate: string,
  endDate: string,
  metrics: string[],
): Promise<AnalyticsReport | null> {
  const res = await client.reports.query({
    ids: 'channel==MINE',
    startDate,
    endDate,
    metrics: metrics.join(','),
    dimensions: 'day',
    sort: 'day',
  })

  if (!res.data.rows || res.data.rows.length === 0) return null

  const headers = (res.data.columnHeaders ?? []).map(h => h.name ?? '')
  const dayIdx = headers.indexOf('day')

  const rows: AnalyticsRow[] = res.data.rows.map(raw => {
    const row: AnalyticsRow = { day: '' }
    headers.forEach((h, i) => {
      row[h] = h === 'day' ? String(raw[i]) : Number(raw[i])
    })
    return row
  })

  // Calcula totais (soma de cada métrica numérica)
  const totals: Record<string, number> = {}
  for (const metric of metrics) {
    totals[metric] = rows.reduce((sum, r) => sum + (Number(r[metric]) || 0), 0)
  }

  void dayIdx // used via headers mapping

  return { headers, rows, totals }
}
