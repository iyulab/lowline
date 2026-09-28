import { describe, expect, it } from 'vitest'
import { parseFormdown } from '@formdown/core'
import {
  TemplateError,
  documentFileName,
  documentTitle,
  documentTemplateRef,
  documentValues,
  fieldValues,
  newDocument,
  templateBody,
  templateInfo,
  updateDocument,
} from '../documents.js'
import { starterTemplate } from '../strings.js'

const template = `---
id: bug-report
version: 1
---
# Bug report

**Title**: ___@title

@severity: [select options="low,medium,high,critical" required]

@steps: [textarea rows=6]

Expected result: ___@expected
`

describe('templateInfo', () => {
  it('reads id and version from front matter', () => {
    expect(templateInfo(template)).toEqual({ id: 'bug-report', version: '1', ref: 'bug-report@1' })
  })

  it('refuses a template without an id or version', () => {
    expect(() => templateInfo('# No front matter\n')).toThrow(TemplateError)
    expect(() => templateInfo('---\nid: a\n---\nx')).toThrow('missing-version')
    expect(() => templateInfo('---\nid: "a b"\nversion: 1\n---\nx')).toThrow('invalid-id')
  })
})

describe('newDocument', () => {
  const values = {
    title: 'Editor freezes when saving: 10 MB',
    severity: 'high',
    steps: '1. Open a large file.\n2. Press Ctrl+S.',
    expected: '',
  }

  it('copies the template body and records the template and values in front matter', () => {
    const doc = newDocument(template, values)
    const parsed = parseFormdown(doc)
    expect(parsed.frontMatter?.data).toEqual({
      template: 'bug-report@1',
      title: values.title,
      severity: 'high',
      steps: values.steps,
    })
    expect(doc.endsWith(templateBody(template))).toBe(true)
    expect(parsed.forms.map((f) => f.name)).toEqual(['title', 'severity', 'steps', 'expected'])
  })

  it('binds the recorded values to the fields', () => {
    const parsed = parseFormdown(newDocument(template, values))
    const title = parsed.forms.find((f) => f.name === 'title')
    expect(title?.value).toBe(values.title)
  })

  it('keeps values that YAML would read as another type as strings', () => {
    const doc = newDocument(template, { title: 'true', severity: '007' })
    expect(documentValues(doc)).toEqual({ title: 'true', severity: '007' })
  })
})

describe('checkbox values', () => {
  const withCheckbox = template.replace('Expected result', '@reproduced: [checkbox]\n\nExpected result')

  it('records a checkbox as a boolean, false included, and reads it back as one', () => {
    const doc = newDocument(withCheckbox, { title: 'A', reproduced: true })
    expect(documentValues(doc)).toEqual({ title: 'A', reproduced: true })
    const unchecked = updateDocument(doc, { reproduced: false })
    expect(documentValues(unchecked)).toEqual({ title: 'A', reproduced: false })
    expect(fieldValues(documentValues(unchecked))).toEqual({ title: 'A', reproduced: false })
  })
})

describe('fieldValues', () => {
  it('keeps text, lists and booleans as they are', () => {
    expect(fieldValues({ a: 'x', b: ['p', 'q'], c: true, d: false })).toEqual({ a: 'x', b: ['p', 'q'], c: true, d: false })
  })

  it('reads other scalars as text and drops missing values', () => {
    expect(fieldValues({ n: 7, when: null, gone: undefined, list: [1, 'two'] })).toEqual({ n: '7', list: ['1', 'two'] })
  })
})

describe('updateDocument', () => {
  it('changes values and leaves the body byte for byte', () => {
    const doc = newDocument(template, { title: 'First', severity: 'low' })
    const updated = updateDocument(doc, { title: 'Second', severity: '' })
    expect(documentValues(updated)).toEqual({ title: 'Second' })
    expect(documentTemplateRef(updated)).toBe('bug-report@1')
    expect(updated.endsWith(templateBody(template))).toBe(true)
  })

  it('keeps CRLF line endings', () => {
    const crlf = newDocument(template.replace(/\n/g, '\r\n'), { title: 'A' })
    const updated = updateDocument(crlf, { title: 'B' })
    expect(updated.includes('\n') && !/[^\r]\n/.test(updated)).toBe(true)
  })
})

describe('documentFileName', () => {
  const day = new Date(2026, 8, 28)

  it('starts with the date and uses the title', () => {
    expect(documentFileName(day, 'Editor freezes')).toBe('2026-09-28-Editor freezes.md')
    expect(documentFileName(day, undefined)).toBe('2026-09-28.md')
    expect(documentFileName(day, 'A', 3)).toBe('2026-09-28-A-3.md')
  })

  it('replaces characters that are not allowed in file names', () => {
    expect(documentFileName(day, 'a/b:c*?"<>|d. ')).toBe('2026-09-28-a b c d.md')
  })
})

describe('documentTitle', () => {
  it('uses the first text field in template order and skips choices', () => {
    expect(documentTitle(template, { severity: 'high', expected: 'Saves', title: 'Freeze' })).toBe('Freeze')
    expect(documentTitle(template, { severity: 'high', expected: 'Saves' })).toBe('Saves')
    expect(documentTitle(template, { severity: 'high' })).toBeUndefined()
  })
})

describe('starterTemplate', () => {
  it('is a template whose fields are labelled in Korean', () => {
    const source = starterTemplate('t1')
    expect(templateInfo(source).ref).toBe('t1@1')
    expect(parseFormdown(source).forms.map((f) => [f.name, f.label])).toEqual([
      ['제목', '제목'],
      ['상태', '상태'],
      ['메모', '메모'],
    ])
  })

  it('names new documents after its title field', () => {
    const source = starterTemplate('t1')
    expect(documentTitle(source, { 상태: '열림', 제목: '첫 기록' })).toBe('첫 기록')
  })
})
