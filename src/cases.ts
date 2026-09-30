// Finding documents: by the name of their file, here, and by the words of their values, through the
// sidecar's text index (see `host.search`). One list answers both.

import type { CaseHit } from './projection.js'
import type { VaultEntry } from './vault-client.js'

/** A document the list shows while something is being looked for, and the line of its values that matched. */
export interface Found {
  entry: VaultEntry
  line?: string
}

/** A document's name as the list shows it. */
export function shownName(entry: VaultEntry): string {
  return entry.name.replace(/\.md$/, '')
}

/**
 * The documents to list for `text`: those whose names hold it, in the list's order, then those whose
 * values hold its words, best first — each once, with the line of its values that matched. Documents
 * the index knows but the list does not (another template, gone since) are not listed.
 */
export function found(documents: readonly VaultEntry[], text: string, hits: readonly CaseHit[]): Found[] {
  const query = text.trim().toLocaleLowerCase()
  if (!query) return documents.map((entry) => ({ entry }))
  const byName = documents.filter((d) => shownName(d).toLocaleLowerCase().includes(query))
  const listed = new Map(documents.map((d) => [d.path, d]))
  const seen = new Set(byName.map((d) => d.path))
  const byValue: Found[] = []
  for (const hit of hits) {
    const entry = listed.get(hit.path)
    if (!entry || seen.has(hit.path)) continue
    seen.add(hit.path)
    byValue.push({ entry, line: matchingLine(hit.text, text) })
  }
  return [...byName.map((entry) => ({ entry })), ...byValue]
}

/**
 * The line of a document's values that holds a word of `query` (ignoring case) — the one to show beside it —
 * or its first line when none holds one whole (the index also matches parts of Korean words).
 */
export function matchingLine(text: string, query: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return lines.find((l) => words.some((w) => l.toLocaleLowerCase().includes(w))) ?? lines[0] ?? ''
}
