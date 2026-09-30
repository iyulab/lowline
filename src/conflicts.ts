// Sync clients' conflict copies as the lists show them: both files stay visible, and which to keep
// is the person's to decide — by keeping the copy in the original's place, or deleting the copy.

import { html, nothing, type TemplateResult } from 'lit'
import { strings } from './strings.js'
import type { VaultEntry } from './vault-client.js'

/** A vault path's file name without `suffix`. */
export function shownName(path: string, suffix: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name
}

/** Where an open file stands in a conflict: a copy of `original`, or an original with `copies`. */
export type Conflict = { copyOf: string } | { copies: string[] }

/** The open file's conflict, if it is in one. */
export function conflictOf(path: string, entries: readonly VaultEntry[]): Conflict | undefined {
  const entry = entries.find((e) => e.path === path)
  if (entry?.conflictOf !== undefined) return { copyOf: entry.conflictOf }
  const copies = entries.filter((e) => e.conflictOf === path).map((e) => e.path)
  return copies.length > 0 ? { copies } : undefined
}

/** Whether the file is a sync conflict copy. */
export function isCopy(path: string, entries: readonly VaultEntry[]): boolean {
  return entries.some((e) => e.path === path && e.conflictOf !== undefined)
}

/** What a listed file's conflict copy state says in the list, if anything. */
export function conflictLabel(entry: VaultEntry, entries: readonly VaultEntry[], suffix: string): string | undefined {
  if (entry.conflictOf !== undefined) return strings.conflictCopyOf(shownName(entry.conflictOf, suffix))
  return entries.some((e) => e.conflictOf === entry.path) ? strings.hasConflictCopy : undefined
}

/** What to say about an open file's conflict copy state, if anything. */
export function conflictNotice(path: string, entries: readonly VaultEntry[], suffix: string, original: string): string | undefined {
  const conflict = conflictOf(path, entries)
  if (conflict === undefined) return undefined
  return 'copyOf' in conflict ? strings.conflictCopy(shownName(conflict.copyOf, suffix)) : original
}

/** A list item's conflict label, under its name. */
export function noteFor(label: string | undefined) {
  return label === undefined ? nothing : html`<span class="note">${label}</span>`
}

/**
 * An open file's conflict notice, with what settles it from here: on an original, a way to each copy
 * (`view`) — the person keeps one after seeing it; on a copy, `keep` (an `ll-keep-copy`), given the
 * original's shown name.
 */
export function conflictNoticeFor(
  path: string,
  entries: readonly VaultEntry[],
  suffix: string,
  original: string,
  actions: { view: (copy: string) => void; keep: (original: string) => TemplateResult },
) {
  const conflict = conflictOf(path, entries)
  if (conflict === undefined) return nothing
  const notice = conflictNotice(path, entries, suffix, original)
  const buttons =
    'copyOf' in conflict
      ? actions.keep(shownName(conflict.copyOf, suffix))
      : conflict.copies.map(
          (copy) =>
            html`<dc-button size="sm" variant="secondary" @click=${() => actions.view(copy)}
              >${strings.viewCopy(conflict.copies.length > 1 ? shownName(copy, suffix) : undefined)}</dc-button
            >`,
        )
  return html`<p class="message conflict">${notice}</p>
    <div class="bar">${buttons}</div>`
}
