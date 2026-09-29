/**
 * The Lowline mark: a caret, a solid line and dashes on one baseline. The solid line is where
 * writing goes, the caret is where it goes next, and the dashes are what is not yet written.
 * In the wordmark the word sits on its line and the caret follows it; the symbol has nothing
 * written, so the caret stands at the start of an empty line, like the caret in an empty field.
 *
 * Geometry is built from units, not traced: on the 16-unit symbol grid the caret is 1u wide
 * and 10u tall, the line 7u long and 2u thick, each dash 2u with 1u gaps.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Geometry {
  viewBox: string
  line: Rect
  caret: Rect
  dashes: Rect[]
}

/**
 * Lays out caret, line and dashes left to right on one baseline; the caret meets the line with
 * no gap, before it (`start`) or after it (`end`), and the dashes follow the pair.
 */
function layout(o: {
  x: number
  baseline: number
  thickness: number
  line: number
  caret: 'start' | 'end'
  caretWidth: number
  caretHeight: number
  dash: number
  gap: number
  dashes: number
}): Omit<Geometry, 'viewBox'> {
  const top = o.baseline - o.thickness
  const caretX = o.caret === 'start' ? o.x : o.x + o.line
  const lineX = o.caret === 'start' ? o.x + o.caretWidth : o.x
  const line = { x: lineX, y: top, w: o.line, h: o.thickness }
  const caret = { x: caretX, y: o.baseline - o.caretHeight, w: o.caretWidth, h: o.caretHeight }
  const dashesX = o.x + o.line + o.caretWidth + o.gap
  const dashes = Array.from({ length: o.dashes }, (_, i) => ({
    x: dashesX + i * (o.dash + o.gap),
    y: top,
    w: o.dash,
    h: o.thickness,
  }))
  return { line, caret, dashes }
}

/** 16 × 16 grid; nothing is written yet, so the caret leads. Together caret and line read as an L. */
export const SYMBOL: Geometry = {
  viewBox: '0 0 16 16',
  ...layout({ x: 1, baseline: 13, thickness: 2, line: 7, caret: 'start', caretWidth: 1, caretHeight: 10, dash: 2, gap: 1, dashes: 2 }),
}

/** The word rests directly on its line ("lowline" has no descenders); the caret follows it. */
export const WORD = { x: 0, baseline: 100, size: 100, length: 322 }
export const WORDMARK: Geometry = {
  viewBox: '4 16 424 110',
  ...layout({ x: 6, baseline: 122, thickness: 10, line: 326, caret: 'end', caretWidth: 5, caretHeight: 98, dash: 20, gap: 10, dashes: 3 }),
}

/** Ink on paper; ink blue is the only accent and belongs to the caret. */
export const PALETTE = { paper: '#f7f5f0', ink: '#1a1a1a', caret: '#2f4a6d', pending: '#b4b1aa' }
