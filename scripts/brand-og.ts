// Share images and the blinking symbol, into brand-out/: `npm run brand:og -- --site ../lowline.site`.
// The headline is read from the site's pages, so the image says what the page says.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { DARK, LIGHT, symbolSvg, wordmarkSvg } from '../src/brand/svg.ts'
import { pngSize, pretendard, textSvg, toPng } from './brand-render.ts'

const { values } = parseArgs({ options: { site: { type: 'string' } } })
if (!values.site) throw new Error('--site <path to the site repo> is required')
const OUT = 'brand-out'
mkdirSync(OUT, { recursive: true })

/** The page's <h1> as plain text: tags dropped, spaces collapsed. */
function headline(page: string) {
  const html = readFileSync(join(values.site!, 'src/wwwroot', page), 'utf8')
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]
  if (!h1) throw new Error(`no <h1> in ${page}`)
  return h1.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function card(width: number, height: number, text: string) {
  const c = LIGHT
  const margin = Math.round(width * 0.08)
  const markHeight = Math.round(height * 0.21)
  const top = Math.round(height * 0.24)
  const size = Math.round(height * 0.07)
  const line = textSvg(text, { font: pretendard('SemiBold'), size, x: margin, y: top + markHeight + size * 2, maxWidth: width - margin * 2, lineHeight: size * 1.35, fill: c.ink })
  const foot = textSvg('lowline.ai', { font: pretendard('Medium'), size: Math.round(size * 0.45), x: margin, y: height - margin * 0.75, maxWidth: width, lineHeight: 0, fill: '#6b6862' })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${c.paper}"/>` +
    wordmarkSvg({ colors: c, x: margin, y: top, height: markHeight }) +
    line.svg +
    foot.svg +
    `</svg>`
  )
}

const images: [file: string, w: number, h: number, text: string][] = [
  ['og-ko.png', 1200, 630, headline('index.html')],
  ['og-en.png', 1200, 630, headline('en/index.html')],
  ['social.png', 1280, 640, headline('en/index.html')],
]
for (const [file, w, h, text] of images) {
  const png = toPng(card(w, h, text), w)
  const size = pngSize(png)
  if (size.width !== w || size.height !== h) throw new Error(`${file}: ${size.width}×${size.height}, wanted ${w}×${h}`)
  writeFileSync(join(OUT, file), png)
  console.log(`wrote ${OUT}/${file}`)
}

// The symbol with a blinking caret, light or dark with the reader's system.
const blink =
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
  `<style>.dark { display: none } @media (prefers-color-scheme: dark) { .light { display: none } .dark { display: inline } }</style>` +
  `<g class="light">${symbolSvg({ colors: LIGHT, x: 0, y: 0, size: 64, blink: true })}</g>` +
  `<g class="dark">${symbolSvg({ colors: DARK, x: 0, y: 0, size: 64, blink: true })}</g>` +
  `</svg>`
writeFileSync(join(OUT, 'mark-blink.svg'), blink)
console.log(`wrote ${OUT}/mark-blink.svg`)
