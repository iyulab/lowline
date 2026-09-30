import { describe, expect, it } from 'vitest'
import { NEW_TEMPLATE, documentsOf, placeId, placeOf, sidebarEntries, templatesAfterRead, type TemplateItem } from '../template-scope.js'
import type { VaultEntry } from '../vault-client.js'

const intake: TemplateItem = { ref: 'intake@1', name: '접수', path: '서식/접수.fd.md' }
const bug: TemplateItem = { ref: 'bug-report@1', name: '버그 리포트', path: '서식/버그 리포트.fd.md' }
const labels = { templates: '서식', newTemplate: '새 서식', learning: '학습', orphans: '서식 없는 문서' }

const doc = (path: string, conflictOf?: string): VaultEntry => ({
  path,
  name: path.split('/').pop()!,
  modifiedMs: 1,
  ...(conflictOf ? { conflictOf } : {}),
})

describe('places', () => {
  it('round-trips each place through its sidebar id', () => {
    for (const place of [{ kind: 'template', ref: 'intake@1' }, { kind: 'learning' }, { kind: 'orphans' }] as const)
      expect(placeOf(placeId(place))).toEqual(place)
  })

  it('knows no place for the new-template action or an unknown id', () => {
    expect(placeOf(NEW_TEMPLATE)).toBeUndefined()
    expect(placeOf('something')).toBeUndefined()
  })
})

describe('sidebarEntries', () => {
  it('lists the templates under one group ending with a way to make one, then learning', () => {
    const entries = sidebarEntries([intake, bug], false, labels)
    expect(entries.map((e) => e.label)).toEqual(['서식', '학습'])
    const group = entries[0] as { items: { id: string; label: string }[] }
    expect(group.items.map((i) => i.label)).toEqual(['접수', '버그 리포트', '새 서식'])
    expect(group.items.map((i) => i.id)).toEqual([placeId({ kind: 'template', ref: 'intake@1' }), placeId({ kind: 'template', ref: 'bug-report@1' }), NEW_TEMPLATE])
  })

  it('shows documents without a template only when there are some', () => {
    expect(sidebarEntries([intake], true, labels).map((e) => e.label)).toEqual(['서식', '서식 없는 문서', '학습'])
  })
})

describe('documentsOf', () => {
  const templateOf = new Map([
    ['문서/a.md', 'intake@1'],
    ['문서/b.md', 'bug-report@1'],
    ['문서/c.md', 'gone@1'],
  ])
  const entries = [doc('문서/a.md'), doc('문서/a (충돌 사본).md', '문서/a.md'), doc('문서/b.md'), doc('문서/c.md'), doc('문서/메모.md')]
  const known = new Set(['intake@1', 'bug-report@1'])

  it("lists a template's documents with their conflict copies", () => {
    expect(documentsOf(entries, templateOf, 'intake@1', known).map((d) => d.path)).toEqual(['문서/a.md', '문서/a (충돌 사본).md'])
  })

  it('lists as without a template the documents naming none or one not in the vault', () => {
    expect(documentsOf(entries, templateOf, null, known).map((d) => d.path)).toEqual(['문서/c.md', '문서/메모.md'])
  })
})

describe('templatesAfterRead', () => {
  const v1: TemplateItem = { ref: 'intake@1', name: '접수', path: '서식/접수.fd.md' }
  const v2: TemplateItem = { ...v1, ref: 'intake@2' }

  it('lists what was read, and finds the one showing by its reference', () => {
    expect(templatesAfterRead([bug, intake], intake)).toEqual({ templates: [bug, intake], shown: intake })
    expect(templatesAfterRead([bug, intake], undefined)).toEqual({ templates: [bug, intake] })
  })

  it('keeps the one showing listed when its file was removed outside', () => {
    expect(templatesAfterRead([bug], intake)).toEqual({ templates: [bug, intake], shown: intake })
  })

  it('lists a template whose version was edited once, under the reference its file has now', () => {
    expect(templatesAfterRead([bug, v2], v1)).toEqual({ templates: [bug, v2], shown: v2 })
  })

  it('finds a renamed template by its reference, not its old file', () => {
    const renamed = { ...intake, name: '받기', path: '서식/받기.fd.md' }
    expect(templatesAfterRead([bug, renamed], intake)).toEqual({ templates: [bug, renamed], shown: renamed })
  })
})
