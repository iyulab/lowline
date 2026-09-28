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
  const fields = parseFormdown(source).forms.map((f) => ({
    name: f.name,
    label: f.label ?? f.name,
    type: f.type,
    multiple: f.type === 'checkbox' && Array.isArray(f.options) && f.options.length > 0,
  }))
  return { ref, fields }
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
