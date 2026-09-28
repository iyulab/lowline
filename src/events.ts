// Suggestion events: what a person did with a suggestion, recorded when the document is saved —
// saving is when a value is confirmed. The only learning signals are these explicit ones (D-28).

import type { FieldValue, FieldValues } from './documents.js'
import type { Suggestion } from './projection.js'

export type EventKind = 'accept' | 'correct' | 'reject'

/** One line of `.lowline/events/<device>.jsonl`. */
export interface SuggestionEvent {
  at: string
  /** The document, relative to the vault. */
  doc: string
  field: string
  kind: EventKind
  suggested: string
  /** The value saved; null when the field was left empty after a rejection. */
  value: FieldValue | null
  /** Where the suggestion came from (`memory`), the record it recalled, and how close it was. */
  source: string
  recall: string | null
  similarity: number | null
}

function isEmpty(value: FieldValue | undefined): boolean {
  return value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

function same(value: FieldValue, suggested: string): boolean {
  return (Array.isArray(value) ? value.join(', ') : String(value)) === suggested
}

/**
 * The events a save confirms, one per field a suggestion was offered for:
 * saved as suggested → accept; saved with another value → correct; rejected and left empty →
 * reject. A suggestion neither taken nor rejected, on a field left empty, says nothing.
 */
export function suggestionEvents(
  offered: ReadonlyMap<string, Suggestion>,
  rejected: ReadonlySet<string>,
  saved: FieldValues,
  doc: string,
  at: Date,
): SuggestionEvent[] {
  const events: SuggestionEvent[] = []
  for (const [field, suggestion] of offered) {
    if (suggestion.value === null) continue
    const value = saved[field]
    let kind: EventKind | undefined
    if (!isEmpty(value)) kind = same(value!, suggestion.value) ? 'accept' : 'correct'
    else if (rejected.has(field)) kind = 'reject'
    if (!kind) continue
    events.push({
      at: at.toISOString(),
      doc,
      field,
      kind,
      suggested: suggestion.value,
      value: isEmpty(value) ? null : value!,
      source: suggestion.mode,
      recall: suggestion.source,
      similarity: suggestion.similarity,
    })
  }
  return events
}
