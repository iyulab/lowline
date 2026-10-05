// What the sidecar gets to see of the vault: templates as field lists, documents as values.
// The UI parses (Formdown lives here); the sidecar projects. Neither re-reads the other's work.

import { parseFormdown } from '@formdown/core'
import { documentFrontMatter, templateInfo } from './documents.js'
import { documentId } from './identity.js'
import { templateId } from './template-revision.js'
import type { SuggestionEvent } from './events.js'

export interface TemplateField {
  name: string
  /** What the form shows for the field; the table's column heading. */
  label: string
  /** The Formdown field type (`text`, `select`, `checkbox`, …). */
  type: string
  /** A checkbox with options: its value is a list. */
  multiple: boolean
  /** A choice field's option values (select, radio, checkbox group) — what a document holds; empty for any other field. */
  options: string[]
  /** What the form shows for an option whose text differs from its value (`value=Label`), by value. */
  optionLabels?: Record<string, string>
  /**
   * The id of the template whose documents the field's value names (`@고객 -> customer: [select]`): its value
   * is one of those documents' ids. Absent for a field that refers to none.
   */
  reference?: string
}

export interface TemplateSnapshot {
  ref: string
  fields: TemplateField[]
  /** Judgment fields the template's author turned suggestions on for (front matter `lowline.suggest`). */
  suggest: string[]
}

export interface DocumentSnapshot {
  path: string
  /** What the document is known by (`identity.ts`): what suggestions learned and events recorded are about. */
  id: string
  template: string
  values: Record<string, unknown>
  /** When the file was last saved (ms since the epoch): its values were last confirmed then. */
  modified?: number
  /**
   * A sync client left a conflict copy of it: its values are not confirmed until the person settles
   * which to keep. It stays in the table; suggestions do not learn from it.
   */
  conflicted?: boolean
}

export interface VaultSnapshot {
  templates: TemplateSnapshot[]
  documents: DocumentSnapshot[]
  /** What people did with suggestions, from every device's event file. */
  events: SuggestionEvent[]
}

/** A template's reference and fields in template order. Throws `TemplateError` if it has no identity. */
export function templateSnapshot(source: string): TemplateSnapshot {
  const { ref } = templateInfo(source)
  const parsed = parseFormdown(source)
  // A document holds one value per field name, so a name used twice in the source is one field — as it
  // first appears. The template page says the name is used twice; the projection and suggestions go on.
  const seen = new Set<string>()
  const unique = parsed.forms.filter((f) => !seen.has(f.name) && seen.add(f.name))
  const fields = unique.map((f) => {
    const choices = ['select', 'radio', 'checkbox'].includes(f.type) ? (f.options ?? []) : []
    const labelled = choices.filter((o) => o.label !== undefined)
    return {
    name: f.name,
    label: f.label ?? f.name,
    type: f.type,
    multiple: f.type === 'checkbox' && choices.length > 0,
    options: choices.map((o) => o.value),
    ...(labelled.length > 0 ? { optionLabels: Object.fromEntries(labelled.map((o) => [o.value, o.label!])) } : {}),
    // One document of another template (`->`); many to many (`<->`) is not read yet.
    ...(f.relation?.type === 'fk' ? { reference: f.relation.target } : {}),
    }
  })
  return { ref, fields, suggest: suggestFields(parsed.frontMatter?.data, fields) }
}

/**
 * The templates the vault's fields refer to, by id: a template is one whose documents are what other
 * documents are about (a customer, an item) because a field says so — nothing marks it otherwise. Only
 * templates in the vault count.
 */
export function referenceTargets(templates: readonly TemplateSnapshot[]): Set<string> {
  const present = new Set(templates.map((t) => templateId(t.ref)))
  return new Set(templates.flatMap((t) => t.fields.flatMap((f) => (f.reference && present.has(f.reference) ? [f.reference] : []))))
}

/**
 * The fields a template turns suggestions on for. Off unless the author names them: under the
 * front matter's `lowline` key, so a tool that only knows Formdown reads the template unchanged.
 * Names that are not fields of the template are ignored.
 */
function suggestFields(data: Record<string, unknown> | undefined, fields: TemplateField[]): string[] {
  const lowline = data?.lowline
  const named = typeof lowline === 'object' && lowline !== null ? (lowline as { suggest?: unknown }).suggest : undefined
  if (!Array.isArray(named)) return []
  const known = new Set(fields.map((f) => f.name))
  return named.filter((n): n is string => typeof n === 'string' && known.has(n))
}

/** A document's template and values, or undefined when it names no template. */
export function documentSnapshot(path: string, source: string, modified?: number): DocumentSnapshot | undefined {
  const { template, id, values } = documentFrontMatter(source)
  if (!template) return undefined
  return { path, id: documentId(path, id), template, values, ...(modified ? { modified } : {}) }
}

export interface ProjectionTable {
  template: string
  columns: { name: string; type: string }[]
  rows: { path: string; values: Record<string, unknown> }[]
}

/** What an ingest changed in the sidecar's projection cache. */
export interface IngestResult {
  appended: number
  retired: number
  projections: string[]
  skipped: { path: string; reason: string }[]
  /** Fields a row leaves empty because their value could not be read as the field's type. */
  skippedFields: { template: string; path: string; field: string; reason: string }[]
}

/**
 * A cell as text: lists joined, booleans as a check or a cross, missing values empty — a box someone
 * left unchecked is an answer, and reads differently from a field nobody has filled in.
 */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

/**
 * One condition on a template's table, answered by the sidecar from the projection: `column` is a field's
 * name, or `$path` for the document's vault path (its name); `contains` matches text ignoring case, and
 * `atLeast`/`atMost` bound a number or date field, both included.
 */
export interface ColumnFilter {
  column: string
  op: 'contains' | 'equal' | 'atLeast' | 'atMost'
  value: string
}

/** Field types the projection keeps as dates: their filters are ranges, not text. */
export const DATE_TYPES: readonly string[] = ['date', 'datetime-local']

/** The column that carries a document's vault path. */
export const PATH_COLUMN = '$path'

/** How a judgment field's suggestions have fared, decision by decision. */
export interface FieldCurve {
  template: string
  field: string
  accepted: number
  corrected: number
  rejected: number
  /** After the nth decision, the share of the latest ones (up to a window) that were right. */
  points: { n: number; at: string; rate: number }[]
  /**
   * The decisions split by where each suggestion came from (`key` · `memory`, as {@link Suggestion.mode}), in that
   * order — each source promises the target on its own, so each is read apart. `memory` (similar records) is
   * history only: similar records are no longer offered as suggestions, so it no longer grows. Decisions recorded
   * without a source are only in the totals.
   */
  bySource?: { source: string; decided: number; accepted: number }[] | null
  /**
   * The field's saved documents replayed in the order they were saved, each asked of the ones before it for a
   * value settled alongside its observed values: the share of lookups that got a suggestion and the share of those
   * that were right, at the strength the replay chose. Absent until the history is long enough to choose one from.
   */
  replay?: { threshold: number; precision: number; answerRate: number; answered: number; lookups: number } | null
  /**
   * Why there is no replay: `few` confirmed documents to choose a strength from, the replay still `pending`, or
   * `below-target` — no strength was right often enough, so nothing is offered for the field.
   */
  whyNoReplay?: 'few' | 'pending' | 'below-target' | null
  /**
   * With `below-target`, how close the replay came: at the most precise strength that still gathered enough
   * answers, the share of them that were right, against the target. It can reach the target and the field still
   * not be offered, when a band of answers within it falls short.
   */
  closest?: { precision: number; answerRate: number; answered: number; lookups: number; target: number } | null
}

/**
 * Why a judgment field got no suggestion: `no-history` — nothing confirmed yet; `below-target` — the values settled
 * alongside the observed ones have not yet shown, replaying its history, that they are right often enough;
 * `undecided` — they have, and this document's observed values settle none.
 */
export type Abstention = 'no-history' | 'below-target' | 'undecided'

/** A document found by the words of its values: where it is, its template, its matching text, how well it matched. */
export interface CaseHit {
  path: string
  template: string
  /** The document's values, one per line, as the index holds them. */
  text: string
  /** A sync client kept another device's edit of it as a copy beside it. */
  conflicted: boolean
  score: number
}

export interface Suggestion {
  /** The suggested value; null when there is none to offer. */
  value: string | null
  /**
   * `key`: settled alongside a value this document has · `abstain` · `rejected`. Similar documents are never offered
   * as a suggestion — they are shown, with the values they confirmed, only when the person opens "비슷한 사례".
   */
  mode: 'key' | 'abstain' | 'rejected'
  /** What it rests on: the other field's value (`부서: 영업`). */
  source: string | null
  /** Why there is none, when `value` is null and the field was asked (`abstain`). */
  reason?: Abstention | null
}
