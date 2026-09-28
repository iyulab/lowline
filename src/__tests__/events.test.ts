import { describe, expect, it } from 'vitest'
import { parseEvents, suggestionEvents } from '../events.js'
import type { Suggestion } from '../projection.js'

const offer = (value: string): Suggestion => ({ value, mode: 'memory', source: '문서/접수-1.md', similarity: 0.8 })
const at = new Date('2026-09-28T12:00:00Z')

describe('suggestionEvents', () => {
  const offered = new Map([
    ['담당', offer('장비')],
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
    })
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
