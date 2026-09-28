// Bringing existing records in: rows copied from a spreadsheet become documents of a template, so
// suggestions have confirmed values to learn from on the first day. Each row is a document; the
// first row names the columns, matched to the template's fields by label or name.

import { parseFormdown } from '@formdown/core'
import type { FieldValue, FieldValues } from './documents.js'

export interface ImportField {
  name: string
  label: string
  type: string
  /** A checkbox with options: its value is a list. */
  multiple: boolean
  options: string[]
}

/** One column of the pasted rows and the field it fills, if any. */
export interface ColumnMatch {
  heading: string
  field?: string
}

/** A value that does not fit its field: kept as written, and shown so the person can check it. */
export interface ImportProblem {
  /** 1-based, counting the heading row: the row number the spreadsheet shows. */
  row: number
  field: string
  value: string
}

export interface ImportPlan {
  columns: ColumnMatch[]
  /** One entry per document to create, in row order. */
  documents: FieldValues[]
  problems: ImportProblem[]
  /** Rows that fill no field. */
  skipped: number
}

/** The fields of a template, as an import can fill them. */
export function importFields(templateSource: string): ImportField[] {
  return parseFormdown(templateSource).forms.map((f) => {
    const options = Array.isArray(f.options) ? f.options.map(String) : []
    return {
      name: f.name,
      label: f.label ?? f.name,
      type: f.type,
      multiple: f.type === 'checkbox' && options.length > 0,
      options,
    }
  })
}

/** Headings compare without case, surrounding space, or the difference between `_` and a space. */
const normalize = (text: string) => text.trim().replace(/[\s_]+/g, ' ').toLowerCase()

/** Matches each heading to the field whose label or name it spells; a field is filled once. */
export function matchColumns(headings: string[], fields: ImportField[]): ColumnMatch[] {
  const taken = new Set<string>()
  return headings.map((heading) => {
    const wanted = normalize(heading)
    const field = fields.find(
      (f) => !taken.has(f.name) && (normalize(f.label) === wanted || normalize(f.name) === wanted),
    )
    if (!field || !wanted) return { heading }
    taken.add(field.name)
    return { heading, field: field.name }
  })
}

const YES = new Set(['true', 'yes', 'y', 'o', '1', '예', '네', '✓', '✔', 'v'])
const NO = new Set(['false', 'no', 'n', 'x', '0', '아니오', '아니요'])

/**
 * A cell as a field value. Empty cells fill nothing. A value that does not fit the field — an
 * option the field does not offer, a check mark it cannot read — is kept as written (nothing the
 * person had is dropped) and reported.
 */
export function cellValue(field: ImportField, text: string): { value?: FieldValue; fits: boolean } {
  const cell = text.trim()
  if (!cell) return { fits: true }
  if (field.type === 'checkbox' && !field.multiple) {
    const answer = cell.toLowerCase()
    if (YES.has(answer)) return { value: true, fits: true }
    if (NO.has(answer)) return { value: false, fits: true }
    return { value: cell, fits: false }
  }
  if (field.multiple) {
    const chosen = cell
      .split(/[,;\n]/)
      .map((c) => c.trim())
      .filter(Boolean)
    return { value: chosen, fits: chosen.every((c) => field.options.includes(c)) }
  }
  if (field.options.length > 0) return { value: cell, fits: field.options.includes(cell) }
  return { value: cell, fits: true }
}

/** What importing `rows` (the first one naming the columns) into a template would create. */
export function planImport(rows: string[][], fields: ImportField[]): ImportPlan {
  const [headings = [], ...records] = rows
  const columns = matchColumns(headings, fields)
  const byName = new Map(fields.map((f) => [f.name, f]))
  const documents: FieldValues[] = []
  const problems: ImportProblem[] = []
  let skipped = 0
  records.forEach((cells, index) => {
    const values: FieldValues = {}
    columns.forEach((column, i) => {
      const field = column.field ? byName.get(column.field) : undefined
      if (!field) return
      const { value, fits } = cellValue(field, cells[i] ?? '')
      if (value === undefined) return
      values[field.name] = value
      if (!fits) problems.push({ row: index + 2, field: field.name, value: (cells[i] ?? '').trim() })
    })
    if (Object.keys(values).length === 0) skipped++
    else documents.push(values)
  })
  return { columns, documents, problems, skipped }
}
