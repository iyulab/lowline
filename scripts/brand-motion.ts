// The intro as an animated SVG and as videos, into brand-out/: `npm run brand:motion`.
// Both come from introState, the timeline the app and the site play, so all of them agree.
// Videos need ffmpeg on the PATH; without it only the SVGs are written.
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORDMARK } from '../src/brand/geometry.ts'
import { WORDMARK_GLYPHS } from '../src/brand/wordmark-glyphs.ts'
import { BLINK_MS, CONFIRM_MS, CONFIRM_STAGGER_MS, INTRO_MS, KEYFRAMES_CSS, TYPE_MS, introState } from '../src/brand/motion.ts'
import { DARK, LIGHT, wordmarkSvg, wordmarkWidth, type Colors } from '../src/brand/svg.ts'
import { toPng } from './brand-render.ts'

const OUT = 'brand-out'
mkdirSync(OUT, { recursive: true })

const LEAD_MS = 2 * BLINK_MS
const TYPED_MS = LEAD_MS + WORDMARK_GLYPHS.length * TYPE_MS
const pct = (ms: number) => `${((ms / INTRO_MS) * 100).toFixed(3)}%`
/** A step from `from` to `to` at `ms`: CSS keyframes change at an instant only between two close stops. */
const step = (ms: number, from: string, to: string) => `${pct(ms)} { ${from} } ${pct(ms + 1)} { ${to} }`

/**
 * One wordmark whose default styles are the finished state; keyframes run from the empty line to
 * it once, then the caret keeps blinking. Reduced motion turns the keyframes off, which leaves
 * the finished wordmark.
 */
function animatedSvg(c: Colors) {
  const [vx, vy, vw, vh] = WORDMARK.viewBox.split(' ').map(Number)
  const glyphRules = WORDMARK_GLYPHS.map((_, i) => {
    const shown = LEAD_MS + (i + 1) * TYPE_MS
    return `@keyframes g${i} { 0% { opacity: 0 } ${step(shown, 'opacity: 0', 'opacity: 1')} 100% { opacity: 1 } }
.g${i} { animation: g${i} ${INTRO_MS}ms linear both }`
  })
  const caretAt = (k: number) => (k < WORDMARK_GLYPHS.length ? WORDMARK_GLYPHS[k].x : WORDMARK.caret.x) - WORDMARK.caret.x
  const moves = WORDMARK_GLYPHS.map((_, k) => step(LEAD_MS + (k + 1) * TYPE_MS, `transform: translateX(${caretAt(k)}px)`, `transform: translateX(${caretAt(k + 1)}px)`))
  const css = `${KEYFRAMES_CSS}
svg { --ll-k-ink: ${c.ink}; --ll-k-pending: ${c.pending} }
${glyphRules.join('\n')}
@keyframes caret-move { 0% { transform: translateX(${caretAt(0)}px) } ${moves.join(' ')} 100% { transform: translateX(0px) } }
@keyframes caret-lead { 0% { opacity: 1 } ${step(BLINK_MS, 'opacity: 1', 'opacity: 0')} ${step(LEAD_MS, 'opacity: 0', 'opacity: 1')} 100% { opacity: 1 } }
.caret { animation: caret-move ${INTRO_MS}ms linear both, caret-lead ${INTRO_MS}ms linear both, ll-blink ${BLINK_MS * 2}ms steps(1, end) ${INTRO_MS}ms infinite }
.dash { animation: ll-confirm ${CONFIRM_MS}ms linear both; animation-delay: calc(${TYPED_MS}ms + var(--i) * ${CONFIRM_STAGGER_MS}ms) }
@media (prefers-reduced-motion: reduce) { .g0, .g1, .g2, .g3, .g4, .g5, .g6, .caret, .dash { animation: none } }`
  const r = (o: { x: number; y: number; w: number; h: number }, attrs: string) => `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" ${attrs}/>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}" role="img" aria-label="Lowline">` +
    `<style>${css}</style>` +
    WORDMARK_GLYPHS.map((g, i) => `<path class="g${i}" transform="translate(${g.x} 0)" d="${g.d}" fill="${c.ink}"/>`).join('') +
    r(WORDMARK.line, `fill="${c.ink}"`) +
    WORDMARK.dashes.map((d, i) => r(d, `class="dash" style="--i:${i}" fill="${c.pending}"`)).join('') +
    r(WORDMARK.caret, `class="caret" fill="${c.caret}"`) +
    `</svg>`
  )
}

for (const [name, c] of [['light', LIGHT], ['dark', DARK]] as const) {
  writeFileSync(join(OUT, `lowline-intro-${name}.svg`), animatedSvg(c))
  console.log(`wrote ${OUT}/lowline-intro-${name}.svg`)
}

// Videos: the intro, then a second and a half of the caret resting and blinking.
const FPS = 30
const TAIL_MS = 1500
const frames = Math.ceil(((INTRO_MS + TAIL_MS) / 1000) * FPS)
if (spawnSync('ffmpeg', ['-version']).status !== 0) {
  console.log('ffmpeg not found — videos skipped')
  process.exit(0)
}
const ffmpeg = (args: string[]) => {
  const run = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`)
}
const shapes = { wide: [1920, 1080, 220], square: [1080, 1080, 170] } as const
for (const [shape, [w, h, markHeight]] of Object.entries(shapes))
  for (const [theme, c] of [['light', LIGHT], ['dark', DARK]] as const) {
    const name = `lowline-intro-${shape}-${theme}`
    const dir = join(tmpdir(), 'lowline-frames', name)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    for (let f = 0; f < frames; f++) {
      const t = (f * 1000) / FPS
      const state = introState(t)
      if (t > INTRO_MS) state.caretOn = Math.floor((t - INTRO_MS) / BLINK_MS) % 2 === 0
      const mark = wordmarkSvg({ colors: c, x: (w - wordmarkWidth(markHeight)) / 2, y: (h - markHeight) / 2, height: markHeight, state })
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${c.paper}"/>${mark}</svg>`
      writeFileSync(join(dir, `${String(f).padStart(5, '0')}.png`), toPng(svg, w))
    }
    const input = ['-framerate', String(FPS), '-i', join(dir, '%05d.png')]
    ffmpeg([...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', join(OUT, `${name}.mp4`)])
    ffmpeg([...input, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', join(OUT, `${name}.webm`)])
    ffmpeg([...input, '-vf', 'scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none', join(OUT, `${name}.gif`)])
    rmSync(dir, { recursive: true, force: true })
    console.log(`wrote ${OUT}/${name}.{mp4,webm,gif} (${frames} frames)`)
  }
