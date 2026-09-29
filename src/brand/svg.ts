// The mark as SVG markup, for scripts that render files (share images, videos, the installer).
// The app and the site draw into the DOM instead; all three read the same geometry and motion.
import { PALETTE, SYMBOL, WORDMARK, type Rect } from './geometry.ts'
import { WORDMARK_GLYPHS } from './wordmark-glyphs.ts'
import { BLINK_MS, KEYFRAMES_CSS, type IntroState } from './motion.ts'

export interface Colors {
  paper: string
  ink: string
  caret: string
  pending: string
}
export const LIGHT: Colors = PALETTE
/** Paper and ink swap; the caret turns to ink, as on the site. */
export const DARK: Colors = { paper: '#1a1a1a', ink: '#f7f5f0', caret: '#f7f5f0', pending: '#6b6964' }

const [VX, VY, VW, VH] = WORDMARK.viewBox.split(' ').map(Number)
/** Width of a wordmark drawn `height` tall. */
export const wordmarkWidth = (height: number) => (height * VW) / VH

/** `a` → `b` by `t` (0..1), both `#rrggbb`. */
export function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return '#' + [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, '0')).join('')
}

const rect = (r: Rect, fill: string, extra = '') => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${fill}"${extra}/>`

/** The wordmark, `height` tall with its top-left at (x, y); `state` draws a moment of the intro. */
export function wordmarkSvg(o: { colors: Colors; x: number; y: number; height: number; state?: IntroState }): string {
  const { colors: c, state: s } = o
  const glyphs = WORDMARK_GLYPHS.slice(0, s ? s.glyphs : undefined)
  const caret = s ? { ...WORDMARK.caret, x: s.caretX } : WORDMARK.caret
  return (
    `<g transform="translate(${o.x} ${o.y}) scale(${o.height / VH}) translate(${-VX} ${-VY})">` +
    glyphs.map((g) => `<path transform="translate(${g.x} 0)" d="${g.d}" fill="${c.ink}"/>`).join('') +
    rect(WORDMARK.line, c.ink) +
    WORDMARK.dashes.map((d, i) => rect(d, mix(c.pending, c.ink, s ? s.dashInk[i] : 0))).join('') +
    (s && !s.caretOn ? '' : rect(caret, c.caret)) +
    `</g>`
  )
}

/** The symbol, `size` square with its top-left at (x, y). `blink` adds a blinking caret that honours reduced motion. */
export function symbolSvg(o: { colors: Colors; x: number; y: number; size: number; blink?: boolean }): string {
  const c = o.colors
  const style = o.blink
    ? `<style>${KEYFRAMES_CSS} .ll-caret { animation: ll-blink ${BLINK_MS * 2}ms steps(1, end) infinite } @media (prefers-reduced-motion: reduce) { .ll-caret { animation: none } }</style>`
    : ''
  return (
    style +
    `<g transform="translate(${o.x} ${o.y}) scale(${o.size / 16})" shape-rendering="crispEdges">` +
    rect(SYMBOL.line, c.ink) +
    SYMBOL.dashes.map((d) => rect(d, c.pending)).join('') +
    rect(SYMBOL.caret, c.caret, ' class="ll-caret"') +
    `</g>`
  )
}
