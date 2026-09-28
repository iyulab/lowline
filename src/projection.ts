// What the sidecar gets to see of the vault: templates as field lists, documents as values.
// The UI parses (Formdown lives here); the sidecar projects. Neither re-reads the other's work.

import { parseFormdown } from '@formdown/core'
import { documentTemplateRef, documentValues, templateInfo } from './documents.js'

export interface TemplateField {
  name: string
  /** What the form shows for the field; the table's column heading. */
  label: string
  /** The Formdown field type (`text`, `select`, `checkbox`, …). */
  type: string
  /** A checkbox with options: its value is a list. */
  multiple: boolean
}

export interface TemplateSnapshot {
  ref: string
  fields: TemplateField[]
  /** Judgment fields the template's author turned suggestions on for (front matter `lowline.suggest`). */
  suggest: string[]
}

export interface DocumentSnapshot {
  path: string
  template: string
  values: Record<string, unknown>
}

export interface VaultSnapshot {
  templates: TemplateSnapshot[]
  documents: DocumentSnapshot[]
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
export function documentSnapshot(path: string, source: string): DocumentSnapshot | undefined {
  const template = documentTemplateRef(source)
  if (!template) return undefined
  return { path, template, values: documentValues(source) }
}

export interface ProjectionTable {
  template: string
  columns: { name: string; type: string }[]
  rows: { path: string; values: Record<string, unknown> }[]
}

export interface IngestResult {
  ingested: number
  projections: string[]
  skipped: { path: string; reason: string }[]
}

/** A cell as text: lists joined, booleans as a check mark, missing values empty. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? '✓' : ''
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

export interface Suggestion {
  /** The suggested value; null when there is none to offer. */
  value: string | null
  mode: string
  /** The document the value was confirmed in. */
  source: string | null
  similarity: number | null
}
