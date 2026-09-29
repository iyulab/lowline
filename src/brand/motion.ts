// How the mark moves: only the way writing moves. The caret blinks while waiting, holds while
// typing and jumps (never glides); a confirmation fills the dashes in one after another.
// The intro types the word onto the empty line, so the symbol's empty field becomes the wordmark.
import { WORDMARK } from './geometry.ts'
import { WORDMARK_GLYPHS } from './wordmark-glyphs.ts'

/** Caret blink half-period — the common desktop default. */
export const BLINK_MS = 530
/** Like a system caret, stop blinking after a while without input, and rest visible. */
export const REST_AFTER_MS = 5000
export const TYPE_MS = 70
export const SPACE_EXTRA_MS = 60
export const CONFIRM_MS = 900
export const CONFIRM_STAGGER_MS = 70

/** "Not yet" briefly becomes "confirmed", then waits for the next one. Linear, so CSS and renders agree. */
const CONFIRM_STOPS: [at: number, ink: number][] = [
  [0, 0],
  [0.25, 1],
  [0.6, 1],
  [1, 0],
]

/**
 * Keyframes shared by every surface. `ll-confirm` fills between `--ll-k-pending` and
 * `--ll-k-ink`, which each surface maps to its own colors.
 */
export const KEYFRAMES_CSS = `
@keyframes ll-blink { 0% { opacity: 1 } 50% { opacity: 0 } }
@keyframes ll-confirm { ${CONFIRM_STOPS.map(([at, ink]) => `${at * 100}% { fill: var(${ink ? '--ll-k-ink' : '--ll-k-pending'}) }`).join(' ')} }
`

/** How much ink dash `index` has, `t` ms into a confirmation: 0 is pending, 1 is ink. */
export function confirmInk(t: number, index: number): number {
  const p = (t - index * CONFIRM_STAGGER_MS) / CONFIRM_MS
  if (p <= 0 || p >= 1) return 0
  for (let i = 1; i < CONFIRM_STOPS.length; i++) {
    const [a, va] = CONFIRM_STOPS[i - 1]
    const [b, vb] = CONFIRM_STOPS[i]
    if (p <= b) return va + ((vb - va) * (p - a)) / (b - a)
  }
  return 0
}

export interface IntroState {
  /** How many glyphs of the word are written. */
  glyphs: number
  /** Caret x in wordmark units. */
  caretX: number
  caretOn: boolean
  /** Ink per dash, 0 to 1. */
  dashInk: number[]
}

/** One blink (on, off) on the empty line, then the word is typed, then confirmed. */
const LEAD_MS = 2 * BLINK_MS
const TYPED_MS = LEAD_MS + WORDMARK_GLYPHS.length * TYPE_MS
export const INTRO_MS = TYPED_MS + CONFIRM_MS + (WORDMARK.dashes.length - 1) * CONFIRM_STAGGER_MS

/** The caret sits where the next glyph goes; after the last, where the wordmark keeps it. */
const caretAt = (typed: number) => (typed < WORDMARK_GLYPHS.length ? WORDMARK_GLYPHS[typed].x : WORDMARK.caret.x)

/** The intro at `t` ms. With reduced motion there is no process to show, only the end. */
export function introState(t: number, o: { reduced?: boolean } = {}): IntroState {
  const time = o.reduced ? INTRO_MS : Math.min(Math.max(t, 0), INTRO_MS)
  const typed = time < LEAD_MS ? 0 : Math.min(WORDMARK_GLYPHS.length, Math.floor((time - LEAD_MS) / TYPE_MS))
  return {
    glyphs: typed,
    caretX: caretAt(typed),
    caretOn: time >= LEAD_MS || Math.floor(time / BLINK_MS) % 2 === 0,
    dashInk: WORDMARK.dashes.map((_, i) => (time >= TYPED_MS ? confirmInk(time - TYPED_MS, i) : 0)),
  }
}
