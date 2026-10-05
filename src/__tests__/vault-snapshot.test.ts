// A change outside the app reaches whoever reads the vault on hearing it: the read they start, or join, has it.
import { describe, expect, it, vi } from 'vitest'
import type { VaultChanged, VaultEntry } from '../vault-client.js'

/** The shell's change handlers — called newest first here, the worst order for a cache registered after a view. */
const handlers = vi.hoisted(() => [] as ((change: VaultChanged) => void)[])
/** Each listing of the templates folder, answered when the test says so. */
const listings = vi.hoisted(() => [] as { resolve: (entries: VaultEntry[]) => void }[])

vi.mock('../vault-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../vault-client.js')>()
  return {
    ...actual,
    onVaultChanged: async (onChange: (change: VaultChanged) => void) => {
      handlers.unshift(onChange)
      return () => {}
    },
    vault: {
      ...actual.vault,
      listTemplates: () => new Promise<VaultEntry[]>((resolve) => listings.push({ resolve })),
      listDocuments: async () => [],
      listEvents: async () => [],
      readMany: async (paths: string[]) => paths.map((path) => `---\nid: ${path.slice(3, 4)}\nversion: 1\n---\n@a: [text]`),
    },
  }
})

const { onVaultChanged, readVault } = await import('../vault-snapshot.js')

const entry = (name: string): VaultEntry => ({ path: `서식/${name}`, name, modifiedMs: 1 })

describe('a change outside the app', () => {
  it('is in the read a listener starts on hearing it, though a read begun before it is still under way', async () => {
    const reads: Promise<{ templateItems: unknown[] }>[] = []
    await onVaultChanged(() => reads.push(readVault()))
    const before = readVault() // under way, listing the folder as it was
    await vi.waitFor(() => expect(listings).toHaveLength(1))

    for (const handler of handlers) handler({ rescan: false, written: [], removed: ['서식/b.fd.md'] })
    expect(reads).toHaveLength(1)
    expect(reads[0]).not.toBe(before)

    listings[0].resolve([entry('a.fd.md'), entry('b.fd.md')])
    await vi.waitFor(() => expect(listings).toHaveLength(2))
    listings[1].resolve([entry('a.fd.md')])
    expect((await before).templateItems).toHaveLength(2)
    expect((await reads[0]).templateItems).toHaveLength(1)
  })
})
