// Gera uma máscara PNG circular para usar no OBS (filtro Máscara de imagem/blend).
// Uso:
//   node scripts/gen-circle-mask.mjs
//   node scripts/gen-circle-mask.mjs 512
//   node scripts/gen-circle-mask.mjs 1024 C:/Users/wande/Pictures/mask.png

import sharp from 'sharp'
import { homedir } from 'node:os'
import { join } from 'node:path'

const size = parseInt(process.argv[2] ?? '1024', 10)
const defaultPath = join(homedir(), 'Desktop', `circle-mask-${size}.png`)
const outPath = process.argv[3] ?? defaultPath

const radius = size / 2 - 4

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="white"/>
</svg>
`.trim()

await sharp(Buffer.from(svg))
  .png()
  .toFile(outPath)

console.log(`✅ Máscara circular ${size}x${size} salva em:\n   ${outPath}`)
console.log('\n📋 Como usar no OBS:')
console.log('   1. Fontes → botão direito na sua webcam → Filtros')
console.log('   2. Filtros de efeito → + → Máscara de imagem/blend')
console.log('   3. Tipo: Máscara alpha (canal alpha)')
console.log(`   4. Caminho: ${outPath}`)
console.log('   5. Cor: branco | Opacidade: 100% | Fechar')
