// A template's table as a file for a spreadsheet: CSV (RFC 4180) in UTF-8 with a byte-order mark,
// the way Excel recognises Korean text, and a first column naming each row's document.
import { fileName } from './documents.js'
import type { ProjectionTable } from './projection.js'

/** A value a spreadsheet would run as a formula when it opens the file; a negative number is not one. */
const FORMULA = /^[=+@\t\r]|^-(?!\d+(\.\d+)?$)/

/**
 * One value as a CSV field: checkboxes as TRUE and FALSE — an unchecked box is an answer, an empty
 * field is not — lists joined, and a value a spreadsheet would run as a formula kept as text.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : Array.isArray(value) ? value.join(', ') : String(value)
  if (FORMULA.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** The table as CSV: a heading row of `label`s after `documentHeading`, then one line per document. */
export function tableCsv(table: ProjectionTable, label: (field: string) => string, documentHeading: string): string {
  const lines = [
    [documentHeading, ...table.columns.map((c) => label(c.name))].map(csvCell),
    ...table.rows.map((row) => [csvCell(fileName(row.path, '.md')), ...table.columns.map((c) => csvCell(row.values[c.name]))]),
  ]
  return '﻿' + lines.map((cells) => cells.join(',') + '\r\n').join('')
}
