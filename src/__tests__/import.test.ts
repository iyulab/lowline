import { describe, expect, it } from 'vitest'
import { cellValue, importFields, matchColumns, planImport } from '../import.js'

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
    expect(plan.documents).toEqual([
      { 제목: '저장 후 멈춤', 심각도: '높음' },
      { 제목: '느린 열기', 심각도: '치명' },
    ])
    expect(plan.skipped).toBe(1)
    expect(plan.problems).toEqual([{ row: 4, field: '심각도', value: '치명' }])
  })

  it('has nothing to create from a heading row alone', () => {
    expect(planImport([['제목']], fields)).toMatchObject({ documents: [], skipped: 0 })
    expect(planImport([], fields).documents).toEqual([])
  })
})
