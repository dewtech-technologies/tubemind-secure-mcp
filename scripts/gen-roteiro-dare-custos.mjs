// Gera roteiro de 15 min sobre custo de Claude Code/Cursor/Antigravity
// Usa Sonnet 4.6 via tool generateFullScript. Custo ~$0.025.
import { getAccessToken } from '../dist/services/oauth.service.js'
import { generateFullScript } from '../dist/tools/pipeline.tool.js'

const token = await getAccessToken()

const out = await generateFullScript(
  {
    topic:
      'O custo real do vibe coding em 2026 - Claude Code, Cursor e Antigravity comparados em reais por mes com calculo honesto de tokens, perfis de uso e ROI para devs brasileiros',
    niche: 'desenvolvimento de software com ia',
    durationMinutes: 15,
    tone: 'tecnico',
    audience:
      'devs brasileiros pleno/senior que usam ou querem adotar IDEs com IA e precisam justificar custo mensal pro time ou cliente',
  },
  token,
)

console.log(out)
