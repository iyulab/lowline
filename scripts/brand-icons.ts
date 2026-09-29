// Draws every app icon from the mark's geometry: `npm run brand:icons`.
// The mark sits on whole pixels (the 16-unit grid scaled by an integer); only the tile's rounded
// corners are antialiased. At 24 px and below the icon is flat paper with a one-color mark, as the
// element does, so the dashes stay visible.

import { writeFileSync } from 'node:fs'
import { deflateSync, crc32 } from 'node:zlib'
import { PALETTE, SYMBOL, type Rect } from '../src/brand/geometry.ts'

const ICONS = 'src-tauri/icons'
const MONO_AT = 24
/** Share of the tile the 16-unit grid spans, and the most it may span after rounding. */
const GRID_SHARE = 0.615
const GRID_SHARE_MAX = 0.75
const CORNER = 0.22
const EDGE = '#dcd9d1'

type RGBA = [number, number, number, number]
const rgba = (hex: string): RGBA => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(255) as RGBA

function draw(px: number): Uint8Array {
  const out = new Uint8Array(px * px * 4)
  const set = (x: number, y: number, c: RGBA, a = 1) => {
    const i = (y * px + x) * 4
    // Source over, straight alpha.
    const k = a * (c[3] / 255)
    const under = (out[i + 3] / 255) * (1 - k)
    const alpha = k + under
    if (alpha === 0) return
    for (let j = 0; j < 3; j++) out[i + j] = Math.round((c[j] * k + out[i + j] * under) / alpha)
    out[i + 3] = Math.round(255 * alpha)
  }
  const flat = px <= MONO_AT
  let unit: number
  if (flat) {
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) set(x, y, rgba(PALETTE.paper))
    unit = Math.max(1, Math.floor(px / 16))
  } else {
    tile(px, set)
    unit = Math.round((px * GRID_SHARE) / 16)
    if (unit * 16 > px * GRID_SHARE_MAX) unit--
    unit = Math.max(1, unit)
  }
  const offset = Math.floor((px - 16 * unit) / 2)
  const rect = (r: Rect, hex: string) => {
    for (let y = offset + r.y * unit; y < offset + (r.y + r.h) * unit; y++)
      for (let x = offset + r.x * unit; x < offset + (r.x + r.w) * unit; x++) set(x, y, rgba(hex))
  }
  rect(SYMBOL.line, PALETTE.ink)
  for (const d of SYMBOL.dashes) rect(d, flat ? PALETTE.ink : PALETTE.pending)
  rect(SYMBOL.caret, flat ? PALETTE.ink : PALETTE.caret)
  return out
}

/** A paper tile with rounded corners and a hairline edge, antialiased by 4 × 4 supersampling. */
function tile(px: number, set: (x: number, y: number, c: RGBA, a?: number) => void) {
  const r = px * CORNER
  const edge = Math.max(1, Math.round(px / 512))
  const inside = (x: number, y: number, inset: number) => {
    const lo = r
    const hi = px - r
    const cx = Math.min(Math.max(x, lo), hi)
    const cy = Math.min(Math.max(y, lo), hi)
    return Math.hypot(x - cx, y - cy) <= r - inset && x >= inset && y >= inset && x <= px - inset && y <= px - inset
  }
  const n = 4
  for (let y = 0; y < px; y++)
    for (let x = 0; x < px; x++) {
      let outer = 0
      let inner = 0
      for (let sy = 0; sy < n; sy++)
        for (let sx = 0; sx < n; sx++) {
          const fx = x + (sx + 0.5) / n
          const fy = y + (sy + 0.5) / n
          if (inside(fx, fy, 0)) outer++
          if (inside(fx, fy, edge)) inner++
        }
      if (outer) set(x, y, rgba(EDGE), outer / (n * n))
      if (inner) set(x, y, rgba(PALETTE.paper), inner / (n * n))
    }
}

function png(px: number): Buffer {
  const pixels = draw(px)
  const rows = Buffer.alloc(px * (px * 4 + 1))
  for (let y = 0; y < px; y++) rows.set(pixels.subarray(y * px * 4, (y + 1) * px * 4), y * (px * 4 + 1) + 1)
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const head = Buffer.alloc(4)
    head.writeUInt32BE(data.length)
    const tail = Buffer.alloc(4)
    tail.writeUInt32BE(crc32(body))
    return Buffer.concat([head, body, tail])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(px, 0)
  ihdr.writeUInt32BE(px, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Windows icon with PNG entries. */
function ico(sizes: number[]): Buffer {
  const images = sizes.map(png)
  const head = Buffer.alloc(6 + 16 * sizes.length)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(sizes.length, 4)
  let at = head.length
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i
    head[e] = s >= 256 ? 0 : s
    head[e + 1] = s >= 256 ? 0 : s
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(images[i].length, e + 8)
    head.writeUInt32LE(at, e + 12)
    at += images[i].length
  })
  return Buffer.concat([head, ...images])
}

/** macOS icon with PNG entries. */
function icns(entries: [type: string, px: number][]): Buffer {
  const parts = entries.map(([type, px]) => {
    const data = png(px)
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + parts.reduce((n, p) => n + p.length, 0), 4)
  return Buffer.concat([head, ...parts])
}

const pngs: Record<string, number> = {
  'app-icon.png': 1024,
  [`${ICONS}/icon.png`]: 512,
  [`${ICONS}/32x32.png`]: 32,
  [`${ICONS}/64x64.png`]: 64,
  [`${ICONS}/128x128.png`]: 128,
  [`${ICONS}/128x128@2x.png`]: 256,
  [`${ICONS}/StoreLogo.png`]: 50,
  ...Object.fromEntries([30, 44, 71, 89, 107, 142, 150, 284, 310].map((s) => [`${ICONS}/Square${s}x${s}Logo.png`, s])),
}
for (const [file, px] of Object.entries(pngs)) writeFileSync(file, png(px))
writeFileSync(`${ICONS}/icon.ico`, ico([16, 24, 32, 48, 64, 128, 256]))
writeFileSync(
  `${ICONS}/icon.icns`,
  icns([
    ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
    ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
  ]),
)
console.log(`wrote ${Object.keys(pngs).length} PNGs, icon.ico, icon.icns`)
