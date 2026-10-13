import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
const failures = new Map<string, { kind: string; message: string }>()

vi.mock('../vault-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../vault-client.js')>()
  const step = (name: string) => async (...args: string[]) => {
    calls.push(`${name} ${args.join(' → ')}`)
    const failure = failures.get(name)
    if (failure) throw failure
  }
  return { ...actual, vault: { ...actual.vault, trash: step('trash'), remove: step('remove'), rename: step('rename') } }
})

const { deleteFile, keepConflictCopy } = await import('../file-lifecycle.js')
const { strings } = await import('../strings.js')

beforeEach(() => {
  calls.length = 0
  failures.clear()
})

describe('deleteFile', () => {
  it('moves a file to the trash, or deletes it for good when asked', async () => {
    expect(await deleteFile('문서/a.md', false)).toBe('deleted')
    expect(await deleteFile('문서/a.md', true)).toBe('deleted')
    expect(calls).toEqual(['trash 문서/a.md', 'remove 문서/a.md'])
  })

  it('says when the trash would not take a file, so the person can be asked about deleting it for good', async () => {
    failures.set('trash', { kind: 'not-trashed', message: 'no trash here' })
    expect(await deleteFile('문서/a.md', false)).toBe('untrashable')
  })

  it('says why any other failure happened', async () => {
    failures.set('remove', { kind: 'io', message: 'denied' })
    expect(await deleteFile('문서/a.md', true)).toEqual({ error: expect.any(String) })
  })
})

describe('keepConflictCopy', () => {
  const copy = '문서/a (충돌된 사본).md'

  it('deletes the original and gives the copy its name', async () => {
    expect(await keepConflictCopy(copy, '문서/a.md', false)).toBe('kept')
    expect(calls).toEqual(['trash 문서/a.md', `rename ${copy} → 문서/a.md`])
  })

  it('leaves both as they are when the trash would not take the original', async () => {
    failures.set('trash', { kind: 'not-trashed', message: 'no trash here' })
    expect(await keepConflictCopy(copy, '문서/a.md', false)).toBe('untrashable')
    expect(calls).toEqual(['trash 문서/a.md'])
  })

  it('says the original is gone when only the copy could not take its name', async () => {
    failures.set('rename', { kind: 'already-exists', message: 'taken' })
    expect(await keepConflictCopy(copy, '문서/a.md', true)).toEqual({ error: strings.keptCopyNameTaken(true), originalGone: true })
  })

  it('says the original is still there when deleting it failed', async () => {
    failures.set('trash', { kind: 'io', message: 'denied' })
    expect(await keepConflictCopy(copy, '문서/a.md', false)).toMatchObject({ originalGone: false })
    expect(calls).toEqual(['trash 문서/a.md'])
  })
})
