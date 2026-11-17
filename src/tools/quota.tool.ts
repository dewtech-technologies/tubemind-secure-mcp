/**
 * Tool MCP: get_quota_usage — relatório de consumo da YouTube API e custo Anthropic.
 *
 * Retorna markdown rico mostrando totais + breakdown por tool/endpoint.
 */

import { z } from 'zod'
import { getUsage, type Period, type UsageReport } from '../services/quota.service.js'
import { sha256 } from '../utils/hash.js'
import { withAudit } from '../security/audit.service.js'

// ─── Schema + tool definition ─────────────────────────────────────────────────

export const GetQuotaUsageSchema = z.object({
  period: z.enum(['today', 'week', 'month']).default('today'),
})

export const getQuotaUsageDefinition = {
  name: 'get_quota_usage',
  description:
    'Retorna o consumo de quota da YouTube Data API + custo monetário da Anthropic API no período. Útil para monitorar uso antes que ative thresholds de bloqueio.',
  inputSchema: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: ['today', 'week', 'month'],
        description: 'Período do relatório',
        default: 'today',
      },
    },
  },
} as const

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function getQuotaUsage(
  rawInput: unknown,
  accessToken: string,
): Promise<string> {
  return withAudit('GET_QUOTA_USAGE', 'get_quota_usage', async () => {
    const input = GetQuotaUsageSchema.parse(rawInput)
    const tokenHash = sha256(accessToken)
    const report = getUsage(input.period as Period, tokenHash)

    return renderUsageReport(report)
  })
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderUsageReport(r: UsageReport): string {
  const lines: string[] = []
  const periodLabel = r.period === 'today' ? 'Hoje' : r.period === 'week' ? 'Últimos 7 dias' : 'Últimos 30 dias'

  lines.push(`## Uso de Quota — ${periodLabel} (${r.startDate} → ${r.endDate})`)
  lines.push('')

  // Resumo
  lines.push('### Resumo')
  const ytStatus =
    r.youtubePercent >= 90 ? '🔴 CRÍTICO' : r.youtubePercent >= 70 ? '🟡 ALERTA' : '🟢 OK'
  lines.push(
    `- **YouTube API:** ${r.totalYouTubeUnits.toLocaleString('pt-BR')} / ${r.youtubeLimit.toLocaleString('pt-BR')} units (${r.youtubePercent.toFixed(1)}%) ${ytStatus}`,
  )
  lines.push(`- **Anthropic API:** $${r.totalAnthropicCostUsd.toFixed(4)} acumulado`)

  if (r.totalYouTubeUnits === 0 && r.totalAnthropicCostUsd === 0) {
    lines.push('')
    lines.push('> Sem dados para o período. Use as tools normalmente — o tracking começa agora.')
    return lines.join('\n')
  }

  // By tool
  if (r.byTool.length > 0) {
    lines.push('')
    lines.push('### Top tools por consumo')
    lines.push('| Tool | Chamadas | YouTube units | Anthropic USD |')
    lines.push('|------|----------|---------------|---------------|')
    for (const t of r.byTool.slice(0, 10)) {
      lines.push(
        `| \`${t.toolName}\` | ${t.calls} | ${t.units.toLocaleString('pt-BR')} | $${t.costUsd.toFixed(4)} |`,
      )
    }
  }

  // By endpoint
  if (r.byEndpoint.length > 0) {
    lines.push('')
    lines.push('### Por endpoint de API')
    lines.push('| Endpoint | Chamadas | Units | USD |')
    lines.push('|----------|----------|-------|-----|')
    for (const e of r.byEndpoint.slice(0, 15)) {
      lines.push(
        `| \`${e.endpoint}\` | ${e.calls} | ${e.units.toLocaleString('pt-BR')} | $${e.costUsd.toFixed(4)} |`,
      )
    }
  }

  // Reset note
  lines.push('')
  lines.push('> Reset diário à meia-noite UTC. Configurável via env `YOUTUBE_DAILY_QUOTA`.')

  return lines.join('\n')
}
