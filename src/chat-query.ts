// Asking the vault: what a model's reply says to count — checked against the template's fields — before the vault counts
// it. The model never writes a number: the counts, and the documents behind each, come from the vault's aggregate.

import type { ColumnFilter, TemplateField } from './projection.js'

/** What to count: by which fields, of which documents, and how many of the largest counts to show (all when unset). */
export interface QueryPlan {
  groupBy: string[]
  filters: ColumnFilter[]
  top?: number
}

/** What the reply asked for, checked: a plan to count — or why it is not one, in the app's terms. */
export type ReadPlan =
  | { plan: QueryPlan }
  | { unanswerable: string }
  | { problem: 'no-plan' }
  | { problem: 'unknown-field'; field: string }
  | { problem: 'bad-filter'; field: string }

const OPS = new Set(['equal', 'contains', 'atLeast', 'atMost', 'empty'])

/** The JSON object in the reply's last fenced block — or the reply itself — or null. */
function objectOf(reply: string): Record<string, unknown> | null {
  const blocks = [...reply.matchAll(/```[ \t]*(?:json)?[ \t]*\r?\n([\s\S]*?)```/g)].map((m) => m[1])
  for (const text of [...blocks.reverse(), reply]) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end < start) continue
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1))
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      // Not JSON: the next candidate, if any.
    }
  }
  return null
}

/**
 * What a reply asks to count, checked against `fields`: each field named one the template has (by name, or by its
 * label), each condition one the vault asks, a value where it needs one — a choice field's value one of its choices.
 * A field named twice to count by counts once.
 */
export function queryPlan(reply: string, fields: readonly TemplateField[]): ReadPlan {
  const asked = objectOf(reply)
  if (!asked) return { problem: 'no-plan' }
  if (typeof asked.unanswerable === 'string') return { unanswerable: asked.unanswerable }
  const named = (text: unknown) => {
    const wanted = String(text ?? '').trim().replace(/^@/, '')
    return fields.find((f) => f.name === wanted || f.label === wanted)
  }
  const groupBy: string[] = []
  for (const name of Array.isArray(asked.groupBy) ? asked.groupBy : []) {
    const field = named(name)
    if (!field) return { problem: 'unknown-field', field: String(name) }
    if (!groupBy.includes(field.name)) groupBy.push(field.name)
  }
  const filters: ColumnFilter[] = []
  for (const condition of Array.isArray(asked.filters) ? asked.filters : []) {
    const { field: name, op, value } = (condition ?? {}) as Record<string, unknown>
    const field = named(name)
    if (!field) return { problem: 'unknown-field', field: String(name) }
    if (typeof op !== 'string' || !OPS.has(op)) return { problem: 'bad-filter', field: field.name }
    if (op === 'empty') {
      filters.push({ column: field.name, op, value: '' })
      continue
    }
    const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
    if (!text) return { problem: 'bad-filter', field: field.name }
    if (op === 'equal' && field.options.length > 0 && !field.options.includes(text)) return { problem: 'bad-filter', field: field.name }
    filters.push({ column: field.name, op: op as ColumnFilter['op'], value: text })
  }
  const top = typeof asked.top === 'number' && Number.isInteger(asked.top) && asked.top > 0 ? asked.top : undefined
  return { plan: { groupBy, filters, ...(top ? { top } : {}) } }
}
