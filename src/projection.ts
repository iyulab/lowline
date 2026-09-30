// What the sidecar gets to see of the vault: templates as field lists, documents as values.
// The UI parses (Formdown lives here); the sidecar projects. Neither re-reads the other's work.

import { parseFormdown } from '@formdown/core'
import { documentFrontMatter, templateInfo } from './documents.js'
import { documentId } from './identity.js'
import type { SuggestionEvent } from './events.js'

export interface TemplateField {
  name: string
  /** What the form shows for the field; the table's column heading. */
  label: string
  /** The Formdown field type (`text`, `select`, `checkbox`, …). */
  type: string
  /** A checkbox with options: its value is a list. */
  multiple: boolean
  /** A choice field's options (select, radio, checkbox group); empty for any other field. */
  options: string[]
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
  const fields = parsed.forms.map((f) => ({
    name: f.name,
    label: f.label ?? f.name,
    type: f.type,
    multiple: f.type === 'checkbox' && Array.isArray(f.options) && f.options.length > 0,
    options: ['select', 'radio', 'checkbox'].includes(f.type) && Array.isArray(f.options) ? f.options.map(String) : [],
  }))
  return { ref, fields, suggest: suggestFields(parsed.frontMatter?.data, fields) }
}

/**
 * The fields a template turns suggestions on for. Off unless the author names them (D-46): under the
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
 * `atLeast`/`atMost` bound a number field, both included.
 */
export interface ColumnFilter {
  column: string
  op: 'contains' | 'equal' | 'atLeast' | 'atMost'
  value: string
}

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
   * The field's saved documents replayed in the order they were saved, each asked of the ones before it:
   * the share of lookups that got a suggestion and the share of those that were right. Absent until
   * the history is long enough to choose a threshold from.
   */
  replay?: { threshold: number; precision: number; answerRate: number; answered: number; lookups: number } | null
  /**
   * Why there is no replay: `few` confirmed documents to choose a threshold from, the replay still `pending`, or
   * `below-target` — no threshold was right often enough, so similar documents are not offered for the field.
   */
  whyNoReplay?: 'few' | 'pending' | 'below-target' | null
}

/**
 * Why a judgment field got no suggestion: `no-history` — nothing confirmed yet; `none-close` — nothing confirmed is
 * close enough; `below-target` — replaying its history, no similarity was right often enough to offer from.
 */
export type Abstention = 'no-history' | 'none-close' | 'below-target'

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
  /** `memory`: from a similar document · `key`: settled alongside a value this document has · `abstain`. */
  mode: string
  /** What it rests on: the similar document's path, or the other field's value (`부서: 영업`). */
  source: string | null
  similarity: number | null
  /** Why there is none, when `value` is null and the field was asked (`abstain`). */
  reason?: Abstention | null
}
