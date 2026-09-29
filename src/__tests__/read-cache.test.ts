import { describe, expect, it } from 'vitest'
import { ReadCache } from '../read-cache.js'
import type { VaultChanged, VaultEntry } from '../vault-client.js'

const entry = (path: string, modifiedMs: number): VaultEntry => ({ path, name: path.split('/').pop()!, modifiedMs })
const change = (c: Partial<VaultChanged>): VaultChanged => ({ rescan: false, written: [], removed: [], ...c })

/** A vault of file sources that counts what was read. */
function files(sources: Record<string, string | null>) {
  const read: string[][] = []
  return {
    read,
    readMany: async (paths: string[]) => {
      read.push(paths)
      return paths.map((p) => sources[p] ?? null)
    },
    sources,
  }
}

const upper = () => new ReadCache((_entry: VaultEntry, source: string) => source.toUpperCase())

describe('ReadCache', () => {
  it('reads and parses every file the first time', async () => {
    const vault = files({ 'a.md': 'a', 'b.md': 'b' })
    const cache = upper()
    expect(await cache.read([entry('a.md', 1), entry('b.md', 1)], vault.readMany)).toEqual(['A', 'B'])
    expect(vault.read).toEqual([['a.md', 'b.md']])
  })

  it('does not read a file again while its modification time stays', async () => {
    const vault = files({ 'a.md': 'a', 'b.md': 'b' })
    const cache = upper()
    await cache.read([entry('a.md', 1), entry('b.md', 1)], vault.readMany)
    vault.sources['a.md'] = 'changed'

    expect(await cache.read([entry('a.md', 1), entry('b.md', 1)], vault.readMany)).toEqual(['A', 'B'])
    expect(vault.read).toHaveLength(1)
  })

  it('reads only the files whose modification time moved', async () => {
    const vault = files({ 'a.md': 'a', 'b.md': 'b' })
    const cache = upper()
    await cache.read([entry('a.md', 1), entry('b.md', 1)], vault.readMany)
    vault.sources['a.md'] = 'changed'

    expect(await cache.read([entry('a.md', 2), entry('b.md', 1)], vault.readMany)).toEqual(['CHANGED', 'B'])
    expect(vault.read[1]).toEqual(['a.md'])
  })

  it('reads a file announced as written again, though its modification time did not move', async () => {
    const vault = files({ 'a.md': 'a' })
    const cache = upper()
    await cache.read([entry('a.md', 1)], vault.readMany)
    vault.sources['a.md'] = 'same time'

    cache.forget(change({ written: ['a.md'] }))

    expect(await cache.read([entry('a.md', 1)], vault.readMany)).toEqual(['SAME TIME'])
  })

  it('reads everything again when changes were lost', async () => {
    const vault = files({ 'a.md': 'a', 'b.md': 'b' })
    const cache = upper()
    await cache.read([entry('a.md', 1), entry('b.md', 1)], vault.readMany)

    cache.forget(change({ rescan: true }))
    await cache.read([entry('a.md', 1), entry('b.md', 1)], vault.readMany)

    expect(vault.read[1]).toEqual(['a.md', 'b.md'])
  })

  it('forgets a file that is no longer listed', async () => {
    const vault = files({ 'a.md': 'a', 'b.md': 'b' })
    const cache = upper()
    await cache.read([entry('a.md', 1), entry('b.md', 1)], vault.readMany)
    await cache.read([entry('b.md', 1)], vault.readMany)
    vault.sources['a.md'] = 'back'

    expect(await cache.read([entry('a.md', 1)], vault.readMany)).toEqual(['BACK'])
  })

  it('has nothing for a file removed between listing and reading', async () => {
    const vault = files({ 'a.md': null })
    expect(await upper().read([entry('a.md', 1)], vault.readMany)).toEqual([undefined])
  })

  it('starts over when cleared', async () => {
    const vault = files({ 'a.md': 'a' })
    const cache = upper()
    await cache.read([entry('a.md', 1)], vault.readMany)

    cache.clear()
    await cache.read([entry('a.md', 1)], vault.readMany)

    expect(vault.read).toHaveLength(2)
  })
})
