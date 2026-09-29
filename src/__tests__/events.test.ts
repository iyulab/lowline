import { describe, expect, it } from 'vitest'
import { fillOrder, parseEvents, parsePresentations, presentation, suggestionEvents, type Offer } from '../events.js'
import type { Suggestion } from '../projection.js'

const suggestion = (value: string): Suggestion => ({ value, mode: 'memory', source: '문서/접수-1.md', similarity: 0.8 })
const shown = new Date('2026-09-28T11:59:00Z')
const offer = (value: string, decided?: Date): Offer => ({ suggestion: suggestion(value), shown, filled: ['요청'], ...(decided ? { decided } : {}) })
const at = new Date('2026-09-28T12:00:00Z')

describe('suggestionEvents', () => {
  const offered = new Map([
    ['담당', offer('장비', new Date('2026-09-28T11:59:30Z'))],
    ['긴급', offer('예')],
    ['분류', offer('하드웨어')],
    ['무시', offer('아무거나')],
  ])

  it('reads accept, correct and reject off what was saved', () => {
    const events = suggestionEvents(offered, new Set(['분류']), { 담당: '장비', 긴급: '아니오' }, '문서/a.md', at)
    expect(events.map((e) => [e.field, e.kind, e.value])).toEqual([
      ['담당', 'accept', '장비'],
      ['긴급', 'correct', '아니오'],
      ['분류', 'reject', null],
    ])
    expect(events[0]).toEqual({
      at: '2026-09-28T12:00:00.000Z',
      doc: '문서/a.md',
      field: '담당',
      kind: 'accept',
      suggested: '장비',
      value: '장비',
      source: 'memory',
      recall: '문서/접수-1.md',
      similarity: 0.8,
      filled: ['요청'],
      shownAt: '2026-09-28T11:59:00.000Z',
      decidedAt: '2026-09-28T11:59:30.000Z',
    })
    expect(events[1]).not.toHaveProperty('decidedAt') // changed by hand, neither taken nor rejected
  })

  it('treats a rejected suggestion that was later filled in as a correction', () => {
    const [event] = suggestionEvents(new Map([['담당', offer('장비')]]), new Set(['담당']), { 담당: '총무' }, 'd', at)
    expect(event.kind).toBe('correct')
  })

  it('says nothing about a suggestion that was neither taken nor rejected', () => {
    expect(suggestionEvents(offered, new Set(), {}, 'd', at)).toEqual([])
  })
})

describe('parseEvents', () => {
  it('reads one event per line and skips lines that are not events', () => {
    const [event] = suggestionEvents(new Map([['담당', offer('장비')]]), new Set(['담당']), {}, '문서/a.md', at)
    const text = [
      JSON.stringify(event),
      '',
      '{"at":"2026-09-28T12:00:00.000Z","doc":"문서/a.md","fi', // cut short
      JSON.stringify({ ...event, kind: 'ignored' }),
      '[1, 2]',
      `${JSON.stringify(event)}\r`,
    ].join('\n')
    expect(parseEvents(text)).toEqual([event, event])
  })
})

describe('fillOrder', () => {
  it('keeps the order fields were filled in, and drops emptied ones', () => {
    let order = fillOrder([], { 요청: '프린터', 담당: '' })
    expect(order).toEqual(['요청'])
    order = fillOrder(order, { 긴급: '예', 요청: '프린터' })
    expect(order).toEqual(['요청', '긴급'])
    order = fillOrder(order, { 담당: '장비', 긴급: '예', 요청: '' })
    expect(order).toEqual(['긴급', '담당'])
    expect(fillOrder(order, { 긴급: [], 담당: '장비' })).toEqual(['담당'])
  })
})

describe('presentations', () => {
  it('keep where a suggestion was shown and nothing of its value', () => {
    const p = presentation('intake@1', '담당', offer('장비'))
    expect(p).toEqual({ at: '2026-09-28T11:59:00.000Z', template: 'intake@1', field: '담당', source: 'memory' })
    const text = [JSON.stringify(p), '{"at":"x","templ', '[1]', JSON.stringify({ ...p, field: 3 }), ''].join('\n')
    expect(parsePresentations(text)).toEqual([p])
  })
})
