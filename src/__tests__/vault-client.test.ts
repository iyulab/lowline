import { describe, expect, it } from 'vitest'
import { removedBy, type VaultChanged } from '../vault-client.js'

const change = (c: Partial<VaultChanged>): VaultChanged => ({ rescan: false, written: [], removed: [], ...c })

describe('removedBy', () => {
  const path = '문서/a.md'

  it('is true when the change names the path as removed', () => {
    expect(removedBy(change({ removed: [path] }), path, [])).toBe(true)
  })

  it('is false when the path was written, or not touched', () => {
    expect(removedBy(change({ written: [path] }), path, [])).toBe(false)
    expect(removedBy(change({ removed: ['문서/b.md'] }), path, [])).toBe(false)
  })

  it('reads the listing when changes were lost', () => {
    expect(removedBy(change({ rescan: true }), path, ['문서/b.md'])).toBe(true)
    expect(removedBy(change({ rescan: true }), path, [path, '문서/b.md'])).toBe(false)
  })
})
