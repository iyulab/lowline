import { describe, expect, it } from 'vitest'
import { conflictLabel, conflictNotice, shownName } from '../conflicts.js'
import { strings } from '../strings.js'
import { withoutConflictCopies, type VaultEntry } from '../vault-client.js'

const entry = (path: string, conflictOf?: string): VaultEntry => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  modifiedMs: 1,
  ...(conflictOf ? { conflictOf } : {}),
})

const original = entry('문서/보고서.md')
const copy = entry('문서/보고서 (김의 충돌된 사본 2026-09-29).md', '문서/보고서.md')
const other = entry('문서/회의.md')
const listing = [copy, original, other]

describe('withoutConflictCopies', () => {
  it('leaves copies out and names the files they copy', () => {
    const { files, conflicted } = withoutConflictCopies(listing)
    expect(files).toEqual([original, other])
    expect([...conflicted]).toEqual(['문서/보고서.md'])
  })
})

describe('conflict labels', () => {
  it('shows a copy with its original, and the original as having a copy', () => {
    expect(conflictLabel(copy, listing, '.md')).toBe(strings.conflictCopyOf('보고서'))
    expect(conflictLabel(original, listing, '.md')).toBe(strings.hasConflictCopy)
    expect(conflictLabel(other, listing, '.md')).toBeUndefined()
  })

  it('says what to do about an open copy or original', () => {
    expect(conflictNotice(copy.path, listing, '.md', strings.conflictedOriginal)).toBe(strings.conflictCopy('보고서'))
    expect(conflictNotice(original.path, listing, '.md', strings.conflictedOriginal)).toBe(strings.conflictedOriginal)
    expect(conflictNotice(other.path, listing, '.md', strings.conflictedOriginal)).toBeUndefined()
  })

  it('names a template without its suffix', () => {
    expect(shownName('서식/회의.fd.md', '.fd.md')).toBe('회의')
  })
})
