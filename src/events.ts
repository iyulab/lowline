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
  /** The document's template, so the event still says where it belongs if the document is renamed. */
  template?: string
  field: string
  kind: EventKind
  suggested: string
  /** The value saved; null when the field was left empty after a rejection. */
  value: FieldValue | null
  /**
   * Where the suggestion came from (`memory`: a similar record · `key`: a value settled alongside one this
   * record has), what it rests on (that record, or that value), and how close the record was.
   */
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
  template?: string,
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
      ...(template ? { template } : {}),
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

const KINDS: readonly string[] = ['accept', 'correct', 'reject']

/**
 * The events in one device's event file. A line that is not an event — cut short by a sync
 * conflict, or written by a later version — is skipped rather than failing the whole file.
 */
export function parseEvents(text: string): SuggestionEvent[] {
  const events: SuggestionEvent[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (isEvent(event)) events.push(event)
  }
  return events
}

function isEvent(e: unknown): e is SuggestionEvent {
  if (typeof e !== 'object' || e === null) return false
  const { at, doc, field, kind, suggested } = e as Record<string, unknown>
  return (
    typeof at === 'string' &&
    typeof doc === 'string' &&
    typeof field === 'string' &&
    typeof kind === 'string' &&
    KINDS.includes(kind) &&
    typeof suggested === 'string'
  )
}
