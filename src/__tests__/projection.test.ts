import { describe, expect, it } from 'vitest'
import { cellText, documentSnapshot, referenceTargets, templateSnapshot } from '../projection.js'
import { newDocument } from '../documents.js'

const template = `---
id: bug-report
version: 2
lowline:
  suggest: [심각도, 없는칸]
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
        { name: '제목', label: '제목', type: 'text', multiple: false, options: [] },
        { name: '심각도', label: '심각도', type: 'select', multiple: false, options: ['낮음', '높음'] },
        { name: '재현됨', label: '재현됨', type: 'checkbox', multiple: false, options: [] },
        { name: '재현_절차', label: '재현 절차', type: 'textarea', multiple: false, options: [] },
        { name: '태그', label: '태그', type: 'checkbox', multiple: true, options: ['UI', '저장'] },
      ],
      suggest: ['심각도'],
    })
  })

  it('lists a field whose name is used twice once, as it first appears — a document holds one value per name', () => {
    const twice = template.replace('@재현됨: [checkbox]', '@심각도: [text]')
    const fields = templateSnapshot(twice).fields
    expect(fields.map((f) => f.name)).toEqual(['제목', '심각도', '재현_절차', '태그'])
    expect(fields[1].type).toBe('select')
    expect(templateSnapshot(twice).suggest).toEqual(['심각도'])
  })

  it("carries the template a field refers to by its id, and only for a field that refers to one", () => {
    const inquiry = '---\nid: inquiry\nversion: 1\n---\n# 문의\n\n@고객 -> customer: [select]\n@태그 <-> tag: [checkbox]\n@제목: [text]\n'
    const fields = templateSnapshot(inquiry).fields
    expect(fields.map((f) => [f.name, f.reference])).toEqual([
      ['고객', 'customer'],
      // Many to many is not read yet: its field is the type it is written as.
      ['태그', undefined],
      ['제목', undefined],
    ])
  })

  it('turns suggestions on only for fields the author names', () => {
    expect(templateSnapshot(template.replace(/lowline:\n  suggest: .*\n/, '')).suggest).toEqual([])
    expect(templateSnapshot(template.replace('suggest: [심각도, 없는칸]', 'suggest: 심각도')).suggest).toEqual([])
  })
})

describe('documentSnapshot', () => {
  it('carries the template reference and typed values', () => {
    const doc = newDocument(template, { 제목: '멈춤', 재현됨: true, 태그: ['UI'] }, 'id-a')
    expect(documentSnapshot('문서/a.md', doc)).toEqual({
      path: '문서/a.md',
      id: 'id-a',
      template: 'bug-report@2',
      values: { 제목: '멈춤', 재현됨: true, 태그: ['UI'] },
    })
  })

  it('knows a document without an id by its path', () => {
    expect(documentSnapshot('문서/old.md', '---\ntemplate: bug-report@2\n제목: 멈춤\n---\n')).toMatchObject({ id: '문서/old.md', values: { 제목: '멈춤' } })
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
      '✗',
      'x, y',
      '',
    ])
  })

  it('tells a box left unchecked apart from a value never given', () => {
    expect(cellText(false)).not.toBe(cellText(undefined))
    expect(cellText(undefined)).toBe('')
  })
})

describe('referenceTargets', () => {
  const field = (name: string, reference?: string) => ({ name, label: name, type: 'select', multiple: false, options: [], ...(reference ? { reference } : {}) })
  const customer = { ref: 'customer@2', fields: [field('이름')], suggest: [] }
  const inquiry = { ref: 'inquiry@1', fields: [field('고객', 'customer'), field('담당', 'staff')], suggest: [] }

  it('is the templates in the vault some field refers to, by id whatever their revision', () => {
    expect([...referenceTargets([customer, inquiry])]).toEqual(['customer'])
  })

  it('has none without a field that refers to a template', () => {
    expect([...referenceTargets([customer])]).toEqual([])
  })
})
