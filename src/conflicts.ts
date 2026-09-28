// Sync clients' conflict copies as the lists show them: both files stay visible, and which to keep
// is the person's to decide, by keeping one file.

import { html, nothing } from 'lit'
import { strings } from './strings.js'
import type { VaultEntry } from './vault-client.js'

/** A vault path's file name without `suffix`. */
export function shownName(path: string, suffix: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name
}

/** What a listed file's conflict copy state says in the list, if anything. */
export function conflictLabel(entry: VaultEntry, entries: readonly VaultEntry[], suffix: string): string | undefined {
  if (entry.conflictOf !== undefined) return strings.conflictCopyOf(shownName(entry.conflictOf, suffix))
  return entries.some((e) => e.conflictOf === entry.path) ? strings.hasConflictCopy : undefined
}

/** What to say about an open file's conflict copy state, if anything. */
export function conflictNotice(path: string, entries: readonly VaultEntry[], suffix: string, original: string): string | undefined {
  const entry = entries.find((e) => e.path === path)
  if (entry?.conflictOf !== undefined) return strings.conflictCopy(shownName(entry.conflictOf, suffix))
  return entries.some((e) => e.conflictOf === path) ? original : undefined
}

/** A list item's conflict label, under its name. */
export function noteFor(label: string | undefined) {
  return label === undefined ? nothing : html`<span class="note">${label}</span>`
}

/** An open file's conflict notice. */
export function noticeFor(notice: string | undefined) {
  return notice === undefined ? nothing : html`<p class="message conflict">${notice}</p>`
}
