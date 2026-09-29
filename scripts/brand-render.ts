// Rendering helpers for the brand scripts: SVG to PNG or BMP, and text set as outlines so no
// renderer needs the font.
import { readFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import opentype from 'opentype.js'

export function toPng(svg: string, width: number): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render().asPng()
}

/** 24-bit bottom-up BMP, the format the NSIS installer takes; transparency is flattened onto `paper`. */
export function toBmp24(svg: string, width: number, height: number, paper: string): Buffer {
  const img = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: paper, font: { loadSystemFonts: false } }).render()
  if (img.width !== width || img.height !== height) throw new Error(`rendered ${img.width}×${img.height}, wanted ${width}×${height}`)
  const rgba = img.pixels
  const row = Math.ceil((width * 3) / 4) * 4
  const out = Buffer.alloc(54 + row * height)
  out.write('BM', 0, 'ascii')
  out.writeUInt32LE(out.length, 2)
  out.writeUInt32LE(54, 10)
  out.writeUInt32LE(40, 14)
  out.writeInt32LE(width, 18)
  out.writeInt32LE(height, 22)
  out.writeUInt16LE(1, 26)
  out.writeUInt16LE(24, 28)
  out.writeUInt32LE(row * height, 34)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4
      const d = 54 + (height - 1 - y) * row + x * 3
      out[d] = rgba[s + 2]
      out[d + 1] = rgba[s + 1]
      out[d + 2] = rgba[s]
    }
  return out
}

const fonts = new Map<string, any>()
/** Pretendard at a weight, from the installed package. */
export function pretendard(weight: 'Medium' | 'SemiBold') {
  const file = `node_modules/pretendard/dist/public/static/Pretendard-${weight}.otf`
  if (!fonts.has(file)) {
    const buf = readFileSync(file)
    fonts.set(file, opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)))
  }
  return fonts.get(file)
}

/**
 * Sets `text` as outlines, wrapping at spaces to `maxWidth`. Letters are placed one by one:
 * the texts here need no shaping, and the fonts' substitution tables are not all readable.
 */
export function textSvg(text: string, o: { font: any; size: number; x: number; y: number; maxWidth: number; lineHeight: number; fill: string }) {
  const advance = (s: string) => [...s].reduce((w, ch) => w + (o.font.charToGlyph(ch).advanceWidth * o.size) / o.font.unitsPerEm, 0)
  const lines: string[] = []
  for (const word of text.split(' ')) {
    const last = lines[lines.length - 1]
    if (last !== undefined && advance(`${last} ${word}`) <= o.maxWidth) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  const paths = lines.map((line, i) => {
    let x = o.x
    const baseline = o.y + i * o.lineHeight
    return [...line]
      .map((ch) => {
        const glyph = o.font.charToGlyph(ch)
        const d = glyph.getPath(x, baseline, o.size).toPathData(2)
        x += (glyph.advanceWidth * o.size) / o.font.unitsPerEm
        return d ? `<path d="${d}" fill="${o.fill}"/>` : ''
      })
      .join('')
  })
  return { svg: paths.join(''), lines: lines.length, width: Math.max(...lines.map(advance)) }
}

/** Width and height of a PNG, from its header. */
export function pngSize(png: Buffer) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}
