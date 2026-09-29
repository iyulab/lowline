import { describe, expect, it } from 'vitest'
import { reportOf } from '../reports.js'

describe('reportOf', () => {
  it("hands over an error's class name and stack, never its message", () => {
    // A message may run over several lines; none of them is a frame.
    const error = new TypeError('문서/회의록.md 를 열 수 없음\n    담당: 장비')
    const report = reportOf(error)
    expect(report.kind).toBe('TypeError')
    expect(report.stack.length).toBeGreaterThan(0)
    expect(report.stack.split('\n').every((line) => /^\s+at /.test(line))).toBe(true)
    expect(JSON.stringify(report)).not.toMatch(/회의록|장비/)
  })

  it('hands over the kind of a failure the shell reported, not its message', () => {
    expect(reportOf({ kind: 'outside-vault', message: 'C:\\Users\\홍길동\\볼트 밖' })).toEqual({ kind: 'outside-vault', stack: '' })
  })

  it('hands over nothing of a value that is not an error', () => {
    expect(reportOf('노트북 배터리')).toEqual({ kind: 'NonError', stack: '' })
    expect(reportOf(undefined)).toEqual({ kind: 'NonError', stack: '' })
  })
})
