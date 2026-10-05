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
  /** The value an option's shown text stands for (`value=Label`), so a cell may hold either. */
  valueOf?: Record<string, string>
  options: string[]
}

/**
 * What a column that fills no field is kept for: `date` — when each record was made, the day its file
 * is named by; `name` — a code that tells the records apart (a case number), put in the file name.
 * Without these, imported records all look made today and are told apart only by a number.
 */
export type ColumnUse = 'date' | 'name'

/** One column of the pasted rows and the field it fills, if any — or else what it is kept for. */
export interface ColumnMatch {
  heading: string
  field?: string
  use?: ColumnUse
}

/** A document to create: its values, and — from the columns kept for them — its day and name. */
export interface ImportRecord {
  values: FieldValues
  date?: Date
  name?: string
}

/** A value that does not fit its field: kept as written, and shown so the person can check it. */
export interface ImportProblem {
  /** 1-based, counting the heading row: the row number the spreadsheet shows. */
  row: number
  /** The field — or, for a day that could not be read, the column's heading. */
  field: string
  value: string
}

export interface ImportPlan {
  columns: ColumnMatch[]
  /** One entry per document to create, in row order. */
  documents: ImportRecord[]
  problems: ImportProblem[]
  /** Rows that fill no field. */
  skipped: number
}

/** The fields of a template, as an import can fill them. */
export function importFields(templateSource: string): ImportField[] {
  return parseFormdown(templateSource).forms.map((f) => {
    const options = (f.options ?? []).map((o) => o.value)
    const labelled = (f.options ?? []).filter((o) => o.label !== undefined)
    return {
      name: f.name,
      label: f.label ?? f.name,
      type: f.type,
      multiple: f.type === 'checkbox' && options.length > 0,
      options,
      ...(labelled.length > 0 ? { valueOf: Object.fromEntries(labelled.map((o) => [o.label!, o.value])) } : {}),
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
    const values = chosen.map((c) => field.valueOf?.[c] ?? c)
    return { value: values, fits: values.every((c) => field.options.includes(c)) }
  }
  if (field.options.length > 0) {
    const value = field.valueOf?.[cell] ?? cell
    return { value, fits: field.options.includes(value) }
  }
  return { value: cell, fits: true }
}

/**
 * A day as spreadsheets write it — `2026-01-15`, `2026/1/15 14:30`, `2026. 1. 15.`, `2026년 1월 15일` —
 * at midnight local time, or undefined when the text is not one, or names a day that does not exist.
 */
export function parseRecordDate(text: string): Date | undefined {
  const match = /^\s*(\d{4})\s*(?:[-./]\s*|년\s*)(\d{1,2})\s*(?:[-./]\s*|월\s*)(\d{1,2})\s*(?:일|\.)?(?:[\sT].*)?$/.exec(text)
  if (!match) return undefined
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : undefined
}

/** Longest value read as a code — a case number, not a sentence. */
const CODE_LENGTH = 20

/**
 * What the columns that fill no field are probably for: the first whose every value is a day, as the
 * records' day; the first other whose values are on every record, all different, and short words
 * without spaces — codes, not notes — as their name.
 */
function guessUses(columns: ColumnMatch[], records: string[][]): (ColumnUse | undefined)[] {
  const cells = (i: number) => records.map((r) => (r[i] ?? '').trim())
  const uses: (ColumnUse | undefined)[] = columns.map(() => undefined)
  const dates = columns.findIndex((c, i) => {
    const values = cells(i).filter(Boolean)
    return !c.field && values.length > 0 && values.every((v) => parseRecordDate(v))
  })
  if (dates >= 0) uses[dates] = 'date'
  const names = columns.findIndex((c, i) => {
    if (c.field || i === dates) return false
    const values = cells(i)
    return (
      values.length > 0 &&
      values.every((v) => v && v.length <= CODE_LENGTH && !/\s/.test(v) && !parseRecordDate(v)) &&
      new Set(values).size === values.length
    )
  })
  if (names >= 0) uses[names] = 'name'
  return uses
}

/**
 * What importing `rows` (the first one naming the columns) into a template would create. `uses` says
 * what each column that fills no field is kept for; without it, `guessUses` guesses.
 */
export function planImport(rows: string[][], fields: ImportField[], uses?: (ColumnUse | undefined)[]): ImportPlan {
  const [headings = [], ...records] = rows
  const matched = matchColumns(headings, fields)
  const filling = records.filter((cells) =>
    matched.some((column, i) => column.field && fields.some((f) => f.name === column.field && cellValue(f, cells[i] ?? '').value !== undefined)),
  )
  const chosen = uses ?? guessUses(matched, filling)
  const columns = matched.map((c, i) => (c.field || !chosen[i] ? c : { ...c, use: chosen[i] }))
  const byName = new Map(fields.map((f) => [f.name, f]))
  const documents: ImportRecord[] = []
  const problems: ImportProblem[] = []
  let skipped = 0
  records.forEach((cells, index) => {
    const record: ImportRecord = { values: {} }
    columns.forEach((column, i) => {
      const cell = (cells[i] ?? '').trim()
      if (column.use === 'name' && cell) record.name = cell
      if (column.use === 'date' && cell) {
        record.date = parseRecordDate(cell)
        if (!record.date) problems.push({ row: index + 2, field: column.heading, value: cell })
      }
      const field = column.field ? byName.get(column.field) : undefined
      if (!field) return
      const { value, fits } = cellValue(field, cells[i] ?? '')
      if (value === undefined) return
      record.values[field.name] = value
      if (!fits) problems.push({ row: index + 2, field: field.name, value: cell })
    })
    if (Object.keys(record.values).length === 0) {
      skipped++
      // A row that makes no document has nothing to report.
      while (problems.length && problems[problems.length - 1].row === index + 2) problems.pop()
    } else documents.push(record)
  })
  return { columns, documents, problems, skipped }
}
