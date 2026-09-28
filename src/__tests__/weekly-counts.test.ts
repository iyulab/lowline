import { describe, expect, it } from 'vitest'
import type { SuggestionEvent } from '../events.js'
import type { DocumentSnapshot, TemplateSnapshot } from '../projection.js'
import { weekOf, weeklyCounts } from '../weekly-counts.js'

const template = (ref: string, suggest: string[]): TemplateSnapshot => ({
  ref,
  fields: [{ name: '요청', type: 'textarea', label: '요청', multiple: false }, ...suggest.map((name) => ({ name, type: 'select', label: name, multiple: false }))],
  suggest,
})

const intake = template('intake@1', ['담당', '긴급'])
const bug = template('bug@2', ['원인'])
const notes = template('note@1', [])

const event = (at: string, doc: string, field: string, kind: SuggestionEvent['kind'], similarity: number | null, tpl?: string): SuggestionEvent => ({
  at,
  doc,
  ...(tpl ? { template: tpl } : {}),
  field,
  kind,
  suggested: '장비',
  value: kind === 'reject' ? null : '장비',
  source: 'memory',
  recall: '문서/비밀-경로.md',
  similarity,
})

const doc = (path: string, tpl: string, values: Record<string, unknown>, modified?: number): DocumentSnapshot => ({
  path,
  template: tpl,
  values,
  ...(modified ? { modified } : {}),
})

describe('weekOf', () => {
  it('is the Monday the week starts on', () => {
    expect(weekOf(Date.parse('2026-09-28T00:00:00Z'))).toBe('2026-09-28') // a Monday
    expect(weekOf(Date.parse('2026-10-04T23:59:59Z'))).toBe('2026-09-28') // the Sunday after
    expect(weekOf(Date.parse('2026-10-05T00:00:00Z'))).toBe('2026-10-05')
  })
})

describe('weeklyCounts', () => {
  const documents = [
    doc('문서/환자-김철수.md', 'intake@1', { 요청: '비밀', 담당: '장비' }, Date.parse('2026-09-29T10:00:00Z')),
    doc('문서/2.md', 'intake@1', { 요청: '다른 비밀' }, Date.parse('2026-09-30T10:00:00Z')),
    doc('문서/3.md', 'intake@1', { 긴급: '예' }, Date.parse('2026-10-13T10:00:00Z')),
  ]
  const events = [
    event('2026-09-29T10:00:00.000Z', '문서/환자-김철수.md', '담당', 'accept', 0.83, 'intake@1'),
    event('2026-09-30T10:00:00.000Z', '문서/2.md', '담당', 'reject', 0.61),
    event('2026-10-01T10:00:00.000Z', '문서/3.md', '긴급', 'correct', 0.66, 'intake@1'),
    event('2026-10-06T10:00:00.000Z', '문서/3.md', '담당', 'accept', null, 'intake@1'),
    event('2026-10-06T10:00:00.000Z', '문서/없음.md', '담당', 'accept', 0.9), // template unknown: left out
    event('2026-10-06T10:00:00.000Z', '문서/3.md', '요청', 'accept', 0.9, 'intake@1'), // not a judgment field
  ]
  const counts = weeklyCounts([notes, intake, bug], documents, events)

  it('counts decisions by week, form and judgment field, by number', () => {
    expect(counts.counts.map(({ week, form, field, accepted, corrected, rejected }) => [week, form, field, accepted, corrected, rejected])).toEqual([
      ['2026-09-28', 2, 1, 1, 0, 1],
      ['2026-09-28', 2, 2, 0, 1, 0],
      ['2026-10-05', 2, 1, 1, 0, 0],
    ])
  })

  it('buckets decisions by the similarity the suggestion was made at', () => {
    expect(counts.counts[0].bySimilarity).toEqual({ '0.8': { decided: 1, accepted: 1 }, '0.6': { decided: 1, accepted: 0 } })
    expect(counts.counts[2].bySimilarity).toEqual({})
  })

  it('numbers only forms with judgment fields, in the order of their references', () => {
    // bug@2 is 1, intake@1 is 2; a form without judgment fields is not counted.
    expect(counts.forms).toEqual([
      { form: 1, confirmed: 0, weeks: 0, perWeek: 0 },
      { form: 2, confirmed: 2, weeks: 3, perWeek: 0.67 },
    ])
  })

  it('carries no name, value or path', () => {
    const text = JSON.stringify(counts)
    for (const secret of ['intake', 'bug', '담당', '긴급', '장비', '비밀', '환자', '문서', '.md']) expect(text).not.toContain(secret)
  })
})
