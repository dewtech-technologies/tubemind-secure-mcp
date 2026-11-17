// Gera um anel (ring) PNG transparente — pra usar como borda decorativa
// atrás de uma webcam circular no OBS.
//
// Uso:
//   node scripts/gen-circle-ring.mjs
//   node scripts/gen-circle-ring.mjs 1024 40 "#00C896"
//   node scripts/gen-circle-ring.mjs <size> <thickness> <hexColor> <outPath?>

import sharp from 'sharp'
import { join } from 'node:path'

const size = parseInt(process.argv[2] ?? '1024', 10)
const thickness = parseInt(process.argv[3] ?? '40', 10)
const color = process.argv[4] ?? '#00C896' // verde Claude
const outPath =
  process.argv[5] ?? join(process.cwd(), `circle-ring-${size}-${thickness}.png`)

const cx = size / 2
const cy = size / 2
// raio = metade da largura - metade da espessura (anel fica DENTRO do quadrado)
const r = size / 2 - thickness / 2 - 2 // -2 pra margem anti-clipping

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <circle
    cx="${cx}"
    cy="${cy}"
    r="${r}"
    fill="none"
    stroke="${color}"
    stroke-width="${thickness}"
  />
</svg>
`.trim()

await sharp(Buffer.from(svg))
  .png()
  .toFile(outPath)

console.log(`✅ Anel circular ${size}x${size} (espessura ${thickness}px, cor ${color}) salvo em:`)
console.log(`   ${outPath}`)
console.log('\n📋 Como usar no OBS:')
console.log('   1. Painel Fontes → + → Imagem')
console.log('   2. Criar nova fonte, nome: "Borda webcam"')
console.log(`   3. Procurar → selecionar: ${outPath}`)
console.log('   4. OK → arrastar pra MESMA posição+tamanho da webcam circular')
console.log('   5. No painel Fontes, arrastar "Borda webcam" para ABAIXO da webcam')
console.log('      (no OBS, fontes mais baixas ficam atrás visualmente)')
console.log('   6. Ajustar levemente — se o anel ficar maior que a webcam,')
console.log('      diminuir até encostar nas bordas do círculo da webcam')
