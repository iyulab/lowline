import { describe, expect, it } from 'vitest'
import { cellText, documentSnapshot, templateSnapshot } from '../projection.js'
import { newDocument } from '../documents.js'

const template = `---
id: bug-report
version: 2
---
# 버그 리포트

제목: ___@제목

@심각도: [select options="낮음,높음"]

@재현됨: [checkbox]

@재현_절차: [textarea]

@태그: [checkbox options="UI,저장"]
`

describe('templateSnapshot', () => {
  it('lists the fields in template order with their types', () => {
    expect(templateSnapshot(template)).toEqual({
      ref: 'bug-report@2',
      fields: [
        { name: '제목', label: '제목', type: 'text', multiple: false },
        { name: '심각도', label: '심각도', type: 'select', multiple: false },
        { name: '재현됨', label: '재현됨', type: 'checkbox', multiple: false },
        { name: '재현_절차', label: '재현 절차', type: 'textarea', multiple: false },
        { name: '태그', label: '태그', type: 'checkbox', multiple: true },
      ],
    })
  })
})

describe('documentSnapshot', () => {
  it('carries the template reference and typed values', () => {
    const doc = newDocument(template, { 제목: '멈춤', 재현됨: true, 태그: ['UI'] })
    expect(documentSnapshot('문서/a.md', doc)).toEqual({
      path: '문서/a.md',
      template: 'bug-report@2',
      values: { 제목: '멈춤', 재현됨: true, 태그: ['UI'] },
    })
  })

  it('skips a file that names no template', () => {
    expect(documentSnapshot('문서/note.md', '# just a note\n')).toBeUndefined()
  })
})

describe('cellText', () => {
  it('shows values as text', () => {
    expect([cellText('a'), cellText(3), cellText(true), cellText(false), cellText(['x', 'y']), cellText(null)]).toEqual([
      'a',
      '3',
      '✓',
      '',
      'x, y',
      '',
    ])
  })
})
