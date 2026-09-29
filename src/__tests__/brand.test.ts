import { describe, expect, it } from 'vitest'
import { SYMBOL, WORD, WORDMARK } from '../brand/geometry.ts'
import { WORDMARK_GLYPHS } from '../brand/wordmark-glyphs.ts'

describe('wordmark glyphs', () => {
  it('spell lowline across the word length', () => {
    expect(WORDMARK_GLYPHS.map((g) => g.char).join('')).toBe('lowline')
    const last = WORDMARK_GLYPHS[WORDMARK_GLYPHS.length - 1]
    expect(last.x + last.advance).toBeCloseTo(WORD.x + WORD.length, 3)
    for (let i = 1; i < WORDMARK_GLYPHS.length; i++) expect(WORDMARK_GLYPHS[i].x).toBeGreaterThan(WORDMARK_GLYPHS[i - 1].x)
    for (const g of WORDMARK_GLYPHS) expect(g.d).toMatch(/^M/)
  })
  it('end at the wordmark caret', () => {
    expect(WORDMARK.caret.x).toBe(WORDMARK.line.x + WORDMARK.line.w)
  })
  it('lead the symbol with the caret', () => {
    expect(SYMBOL.caret.x).toBe(1)
    expect(SYMBOL.line.x).toBe(SYMBOL.caret.x + SYMBOL.caret.w)
  })
})

import { BLINK_MS, CONFIRM_MS, CONFIRM_STAGGER_MS, INTRO_MS, TYPE_MS, confirmInk, introState } from '../brand/motion.ts'

describe('intro', () => {
  const typed = 2 * BLINK_MS + WORDMARK_GLYPHS.length * TYPE_MS
  it('starts as an empty line with the caret at its start', () => {
    const s = introState(0)
    expect(s.glyphs).toBe(0)
    expect(s.caretX).toBe(WORDMARK_GLYPHS[0].x)
    expect(s.caretOn).toBe(true)
    expect(s.dashInk.every((v) => v === 0)).toBe(true)
  })
  it('blinks once before typing', () => {
    expect(introState(BLINK_MS + 1).caretOn).toBe(false)
    expect(introState(2 * BLINK_MS - 1).glyphs).toBe(0)
  })
  it('types one glyph per step and never goes back', () => {
    let prev = 0
    for (let t = 0; t <= INTRO_MS; t += 10) {
      const g = introState(t).glyphs
      expect(g).toBeGreaterThanOrEqual(prev)
      prev = g
    }
    expect(introState(2 * BLINK_MS + TYPE_MS).glyphs).toBe(1)
  })
  it('ends exactly as the still wordmark', () => {
    const s = introState(INTRO_MS)
    expect(s.glyphs).toBe(WORDMARK_GLYPHS.length)
    expect(s.caretX).toBe(WORDMARK.caret.x)
    expect(s.dashInk.every((v) => v === 0)).toBe(true)
    expect(INTRO_MS).toBe(typed + CONFIRM_MS + (WORDMARK.dashes.length - 1) * CONFIRM_STAGGER_MS)
  })
  it('fills each dash in turn during the confirmation', () => {
    expect(introState(typed + CONFIRM_MS * 0.4).dashInk[0]).toBe(1)
    expect(introState(typed + CONFIRM_MS * 0.4).dashInk[2]).toBeLessThan(1)
  })
  it('skips to the end when motion is reduced', () => {
    expect(introState(0, { reduced: true })).toEqual(introState(INTRO_MS))
  })
  it('confirm ink follows the keyframes', () => {
    expect(confirmInk(0, 0)).toBe(0)
    expect(confirmInk(CONFIRM_MS * 0.25, 0)).toBe(1)
    expect(confirmInk(CONFIRM_MS * 0.6, 0)).toBe(1)
    expect(confirmInk(CONFIRM_MS, 0)).toBe(0)
    expect(confirmInk(CONFIRM_STAGGER_MS, 1)).toBe(0)
  })
})

import { LIGHT, mix, symbolSvg, wordmarkSvg } from '../brand/svg.ts'

describe('svg', () => {
  it('draws the still wordmark with every glyph and the caret at the end', () => {
    const s = wordmarkSvg({ colors: LIGHT, x: 0, y: 0, height: 110 })
    expect(s.match(/<path /g)?.length).toBe(WORDMARK_GLYPHS.length)
    expect(s).toContain(`x="${WORDMARK.caret.x}"`)
  })
  it('draws a moment of the intro with only the typed glyphs', () => {
    const s = wordmarkSvg({ colors: LIGHT, x: 0, y: 0, height: 110, state: introState(2 * BLINK_MS + 3 * TYPE_MS) })
    expect(s.match(/<path /g)?.length).toBe(3)
  })
  it('draws a blinking symbol that honours reduced motion', () => {
    expect(symbolSvg({ colors: LIGHT, x: 0, y: 0, size: 64, blink: true })).toContain('prefers-reduced-motion')
  })
  it('mixes colors', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mix(LIGHT.pending, LIGHT.ink, 0)).toBe(LIGHT.pending)
  })
})
