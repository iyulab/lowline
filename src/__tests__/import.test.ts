import { describe, expect, it } from 'vitest'
import { cellValue, importFields, matchColumns, parseRecordDate, planImport } from '../import.js'

const template = `---
id: bug-report
version: 1
---
# 버그 리포트

제목: ___@제목

@심각도: [select options="낮음,보통,높음"]

@재현_절차: [textarea rows=3]

@재현됨: [checkbox content="다시 해도 재현된다"]

@태그: [checkbox options="UI,저장,성능"]
`
const fields = importFields(template)
const field = (name: string) => fields.find((f) => f.name === name)!

describe('matchColumns', () => {
  it('matches headings to fields by label or name, loosely, each field once', () => {
    expect(matchColumns([' 제목 ', '재현 절차', '재현_절차', '담당자', ''], fields)).toEqual([
      { heading: ' 제목 ', field: '제목' },
      { heading: '재현 절차', field: '재현_절차' },
      { heading: '재현_절차' },
      { heading: '담당자' },
      { heading: '' },
    ])
  })
})

describe('cellValue', () => {
  it('reads check marks the ways spreadsheets write them', () => {
    expect(cellValue(field('재현됨'), '예')).toEqual({ value: true, fits: true })
    expect(cellValue(field('재현됨'), 'TRUE')).toEqual({ value: true, fits: true })
    expect(cellValue(field('재현됨'), 'x')).toEqual({ value: false, fits: true })
    expect(cellValue(field('재현됨'), '가끔')).toEqual({ value: '가끔', fits: false })
  })

  it('keeps an option the field does not offer, and says so', () => {
    expect(cellValue(field('심각도'), '높음')).toEqual({ value: '높음', fits: true })
    expect(cellValue(field('심각도'), '치명')).toEqual({ value: '치명', fits: false })
  })

  it('splits a list for a checkbox group', () => {
    expect(cellValue(field('태그'), 'UI, 저장')).toEqual({ value: ['UI', '저장'], fits: true })
    expect(cellValue(field('태그'), 'UI; 보안')).toEqual({ value: ['UI', '보안'], fits: false })
  })

  it('takes an option by the text shown for it, and keeps its value', () => {
    const [kind, kinds] = importFields('@분류: [select options="hw=하드웨어,sw=소프트웨어"]\n@분류들: [checkbox options="hw=하드웨어,sw=소프트웨어"]\n')
    expect(cellValue(kind, '하드웨어')).toEqual({ value: 'hw', fits: true })
    expect(cellValue(kind, 'sw')).toEqual({ value: 'sw', fits: true })
    expect(cellValue(kinds, '하드웨어, sw')).toEqual({ value: ['hw', 'sw'], fits: true })
  })

  it('fills nothing from an empty cell', () => {
    expect(cellValue(field('제목'), '  ')).toEqual({ fits: true })
  })
})

describe('planImport', () => {
  it('makes one document per row that fills a field, and reports what does not fit', () => {
    const plan = planImport(
      [
        ['제목', '심각도', '비고'],
        ['저장 후 멈춤', '높음', '무시되는 칸'],
        ['', '', '제목도 심각도도 없음'],
        ['느린 열기', '치명'],
      ],
      fields,
    )
    expect(plan.columns.map((c) => c.field)).toEqual(['제목', '심각도', undefined])
    expect(plan.documents.map((d) => d.values)).toEqual([
      { 제목: '저장 후 멈춤', 심각도: '높음' },
      { 제목: '느린 열기', 심각도: '치명' },
    ])
    // A column that is not on every record names none of them.
    expect(plan.columns[2].use).toBeUndefined()
    expect(plan.skipped).toBe(1)
    expect(plan.problems).toEqual([{ row: 4, field: '심각도', value: '치명' }])
  })

  it('has nothing to create from a heading row alone', () => {
    expect(planImport([['제목']], fields)).toMatchObject({ documents: [], skipped: 0 })
    expect(planImport([], fields).documents).toEqual([])
  })
})

describe('keeping who the imported records were', () => {
  const rows = [
    ['번호', '접수일', '제목', '심각도'],
    ['C-1001', '2026-01-15', '저장 후 멈춤', '높음'],
    ['C-1002', '2026.01.16', '저장 후 멈춤', '보통'],
    ['C-1003', '2026년 2월 3일', '느린 열기', '낮음'],
  ]

  it('takes a column of dates as when each record was made, and a column of unique codes as its name', () => {
    const plan = planImport(rows, fields)
    expect(plan.columns.map((c) => [c.heading, c.field, c.use])).toEqual([
      ['번호', undefined, 'name'],
      ['접수일', undefined, 'date'],
      ['제목', '제목', undefined],
      ['심각도', '심각도', undefined],
    ])
    expect(plan.documents.map((d) => [d.name, d.date && [d.date.getFullYear(), d.date.getMonth() + 1, d.date.getDate()]])).toEqual([
      ['C-1001', [2026, 1, 15]],
      ['C-1002', [2026, 1, 16]],
      ['C-1003', [2026, 2, 3]],
    ])
  })

  it('follows the uses the person chose instead', () => {
    const plan = planImport(rows, fields, [undefined, undefined, undefined, undefined])
    expect(plan.columns.map((c) => c.use)).toEqual([undefined, undefined, undefined, undefined])
    expect(plan.documents.every((d) => d.name === undefined && d.date === undefined)).toBe(true)
  })

  it('reports a date it cannot read, and makes that record today', () => {
    const plan = planImport([['접수일', '제목'], ['2026-01-15', 'a'], ['어제', 'b']], fields, ['date', undefined])
    expect(plan.documents[1].date).toBeUndefined()
    expect(plan.problems).toEqual([{ row: 3, field: '접수일', value: '어제' }])
  })

  it('does not take a column for dates when any of its values is not one', () => {
    expect(planImport([['접수일', '제목'], ['2026-01-15', 'a'], ['어제', 'b']], fields).columns[0].use).toBeUndefined()
  })

  it('reads the ways a spreadsheet writes a day, and nothing that is not a real one', () => {
    const day = (text: string) => {
      const d = parseRecordDate(text)
      return d && [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    }
    expect(day('2026-01-15')).toEqual([2026, 1, 15])
    expect(day('2026/1/5 14:30')).toEqual([2026, 1, 5])
    expect(day('2026. 1. 5.')).toEqual([2026, 1, 5])
    expect(day('2026년 1월 5일')).toEqual([2026, 1, 5])
    expect(day('2026-02-30')).toBeUndefined()
    expect(day('C-1001')).toBeUndefined()
    expect(day('')).toBeUndefined()
  })
})
