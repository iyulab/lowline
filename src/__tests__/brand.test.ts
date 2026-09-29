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
