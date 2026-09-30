import { describe, expect, it } from 'vitest'
import { found, matchingLine } from '../cases.js'
import type { CaseHit } from '../projection.js'
import type { VaultEntry } from '../vault-client.js'

const entry = (name: string): VaultEntry => ({ path: `문서/${name}`, name }) as VaultEntry
const hit = (name: string, text: string, score = 1): CaseHit => ({ path: `문서/${name}`, template: 'intake@1', text, conflicted: false, score })

describe('found', () => {
  const documents = [entry('2026-01-15 노트북 배터리.md'), entry('2026-01-16 휴가 문의.md'), entry('2026-01-17 회의실.md')]

  it('lists every document while nothing is looked for', () => {
    expect(found(documents, '  ', []).map((f) => f.entry.name)).toEqual(documents.map((d) => d.name))
  })

  it('lists the documents whose names hold the text first, then those whose values do, each once', () => {
    const hits = [hit('2026-01-17 회의실.md', '회의실 에어컨이 고장났어요\n총무', 2), hit('2026-01-15 노트북 배터리.md', '노트북 에어컨 옆', 1)]
    expect(found(documents, '에어컨', hits)).toEqual([
      { entry: documents[2], line: '회의실 에어컨이 고장났어요' },
      { entry: documents[0], line: '노트북 에어컨 옆' },
    ])
    // A name match is listed by its name alone, even when its values match too.
    expect(found(documents, '배터리', [hit('2026-01-15 노트북 배터리.md', '배터리가 닳아요')])).toEqual([{ entry: documents[0] }])
  })

  it('leaves out what the index found that the list does not hold', () => {
    expect(found(documents, '토너', [hit('다른 서식 문서.md', '토너')])).toEqual([])
  })
})

describe('matchingLine', () => {
  it('shows the line holding a word of the query, ignoring case', () => {
    expect(matchingLine('노트북이 느려요\nWi-Fi가 끊겨요\n장비', 'wi-fi 끊김')).toBe('Wi-Fi가 끊겨요')
  })

  it('shows the first line when no line holds a whole word', () => {
    expect(matchingLine('충전이 안 돼요\n장비', '충전기')).toBe('충전이 안 돼요')
    expect(matchingLine('', '무엇')).toBe('')
  })
})
