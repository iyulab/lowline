// The installer's header and sidebar images, from the mark: `npm run brand:installer`.
// NSIS takes 24-bit BMPs at fixed sizes (header 150 × 57, sidebar 164 × 314).
import { mkdirSync, writeFileSync } from 'node:fs'
import { LIGHT, symbolSvg, wordmarkSvg } from '../src/brand/svg.ts'
import { toBmp24 } from './brand-render.ts'

const DIR = 'src-tauri/installer'
mkdirSync(DIR, { recursive: true })
const c = LIGHT
const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${c.paper}"/>${body}</svg>`

/** A confirmed stretch, then what is not yet: the mark's line on its own. */
function rule(x: number, y: number) {
  const dashes = [0, 1, 2].map((i) => `<rect x="${x + 52 + i * 12}" y="${y}" width="8" height="4" fill="${c.pending}"/>`).join('')
  return `<rect x="${x}" y="${y}" width="48" height="4" fill="${c.ink}"/>${dashes}`
}

const images: [file: string, w: number, h: number, body: string][] = [
  ['header.bmp', 150, 57, symbolSvg({ colors: c, x: 150 - 12 - 32, y: 12, size: 32 })],
  ['sidebar.bmp', 164, 314, wordmarkSvg({ colors: c, x: 22, y: 40, height: 31 }) + rule(22, 274)],
]
for (const [file, w, h, body] of images) {
  const bmp = toBmp24(svg(w, h, body), w, h, c.paper)
  if (bmp.toString('ascii', 0, 2) !== 'BM' || bmp.readInt32LE(18) !== w || bmp.readInt32LE(22) !== h || bmp.readUInt16LE(28) !== 24)
    throw new Error(`${file}: not a ${w}×${h} 24-bit BMP`)
  writeFileSync(`${DIR}/${file}`, bmp)
  console.log(`wrote ${DIR}/${file}`)
}
