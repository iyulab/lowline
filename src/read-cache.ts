// What the UI last read of each file, so a vault of thousands of files is not read and parsed again
// whole for one outside edit.

import type { VaultChanged, VaultEntry } from './vault-client.js'

/**
 * Files as parsed, by path, kept while their modification time stays. A file the watch reports as
 * written is read again even if its time did not move, and everything is read again when the watch
 * lost changes — a sync client may keep a file's time, so the time alone does not decide.
 */
export class ReadCache<T> {
  readonly #known = new Map<string, { modifiedMs: number; value: T }>()

  constructor(private readonly parse: (entry: VaultEntry, source: string) => T) {}

  /**
   * The parsed files of a listing, in order — reading through `readMany` only the ones not known at
   * their listed time; `undefined` for a file removed since it was listed.
   */
  async read(
    entries: readonly VaultEntry[],
    readMany: (paths: string[]) => Promise<(string | null)[]>,
  ): Promise<(T | undefined)[]> {
    const listed = new Set(entries.map((e) => e.path))
    for (const path of this.#known.keys()) if (!listed.has(path)) this.#known.delete(path)
    const stale = entries.filter((e) => this.#known.get(e.path)?.modifiedMs !== e.modifiedMs)
    const sources = stale.length > 0 ? await readMany(stale.map((e) => e.path)) : []
    stale.forEach((entry, i) => {
      const source = sources[i]
      if (source === null || source === undefined) this.#known.delete(entry.path)
      else this.#known.set(entry.path, { modifiedMs: entry.modifiedMs, value: this.parse(entry, source) })
    })
    return entries.map((e) => this.#known.get(e.path)?.value)
  }

  /** Drops what a change outside the app may have made stale. */
  forget(change: VaultChanged) {
    if (change.rescan) return this.clear()
    for (const path of [...change.written, ...change.removed]) this.#known.delete(path)
  }

  clear() {
    this.#known.clear()
  }
}
