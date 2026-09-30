import { describe, expect, it } from 'vitest'
import { csvCell, tableCsv } from '../export.js'

describe('csvCell', () => {
  it('writes values the way spreadsheets read them back', () => {
    expect([csvCell('a'), csvCell(3), csvCell(true), csvCell(false), csvCell(['x', 'y']), csvCell(null), csvCell(undefined)]).toEqual([
      'a',
      '3',
      'TRUE',
      'FALSE',
      '"x, y"',
      '',
      '',
    ])
  })

  it('quotes a value holding a comma, a quote or a line break, doubling its quotes', () => {
    expect(csvCell('말하길 "안녕"')).toBe('"말하길 ""안녕"""')
    expect(csvCell('첫 줄\n둘째 줄')).toBe('"첫 줄\n둘째 줄"')
  })

  it('keeps a spreadsheet from running a value as a formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+1 담당')).toBe("'+1 담당")
    expect(csvCell('@sum')).toBe("'@sum")
    // A negative number is a number.
    expect(csvCell('-3')).toBe('-3')
    expect(csvCell('-x')).toBe("'-x")
  })
})

describe('tableCsv', () => {
  it('writes a heading row of labels, the document each row is, and one line per row', () => {
    const csv = tableCsv(
      {
        template: 'intake@1',
        columns: [
          { name: '요청', type: 'text' },
          { name: '재현됨', type: 'checkbox' },
        ],
        rows: [
          { path: '문서/접수-1.md', values: { 요청: '토너', 재현됨: false } },
          { path: '문서/접수-2.md', values: { 요청: '프로젝터, 회의실' } },
        ],
      },
      (field) => (field === '요청' ? '요청 내용' : field),
      '문서',
    )
    expect(csv).toBe('﻿문서,요청 내용,재현됨\r\n접수-1,토너,FALSE\r\n접수-2,"프로젝터, 회의실",\r\n')
  })
})
