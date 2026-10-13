// Weekly counts of what people did with suggestions — numbers only, for a person to hand to whoever
// studies whether suggestions improve with use. Nothing that says what a document is about leaves in
// it: forms and fields are numbered, and no value, name or path is written (constitution §3).

import type { Presentation, SuggestionEvent } from './events.js'
import type { DocumentSnapshot, TemplateSnapshot } from './projection.js'

export const WEEKLY_COUNTS_FORMAT = 'lowline-weekly-counts/1'

/** One week of one judgment field. */
export interface WeekCounts {
  /** The Monday the week starts on, in this device's time, as `YYYY-MM-DD`. */
  week: string
  /** The form's number in this vault (see {@link WeeklyCounts.forms}); a new version is a new number. */
  form: number
  /** The judgment field's number within its form, in the order the form names them. */
  field: number
  /**
   * Suggestions shown on this device, saved or not. Decisions come from every device that shares the
   * vault, so on a shared vault they can outnumber what this device showed.
   */
  presented: number
  accepted: number
  corrected: number
  rejected: number
  /** Decisions by the similarity the suggestion was made at, in steps of 0.1 (`"0.6"` = 0.6 to under 0.7). */
  bySimilarity: Record<string, { decided: number; accepted: number }>
  /**
   * Decisions by where the suggestion came from: `key` (a value settled alongside one the document has) or
   * `memory` (a similar record). Each promises the target on its own, so each is read apart. Added within
   * format 1 — a reader that does not know it can pass it by.
   */
  bySource: Record<string, { decided: number; accepted: number }>
  /**
   * Presentations and decisions by how many characters had been typed in the field when the suggestion was first
   * shown: `"0"` (before typing), `"1"`, `"2"`, `"3+"`. A typed suggestion answers to a promise of its own length, so
   * each is read apart. Those recorded before the count was kept are in none, so the slots can add up to less than
   * `presented` and the decisions. Added within format 1 — a reader that does not know it can pass it by.
   */
  byTyped: Record<string, { presented: number; decided: number; accepted: number }>
}

export interface FormCounts {
  form: number
  /** Saved documents with a value in at least one judgment field, leaving out those not settled (`conflicted`). */
  confirmed: number
  /**
   * Weeks from the first such document's day to the last, both included. A document's day is the one its file is
   * named by — the day it was made, or for a record brought in, its own day — or, for a file renamed without it, its
   * last save. Records brought in all at once are counted in the weeks they were made, not the week they came in.
   */
  weeks: number
  perWeek: number
}

export interface WeeklyCounts {
  format: typeof WEEKLY_COUNTS_FORMAT
  counts: WeekCounts[]
  forms: FormCounts[]
}

const DAY = 24 * 60 * 60 * 1000

/** The `byTyped` slot of a count of characters typed: 0, 1, 2, or 3 and more. */
export function typedSlot(typed: number): string {
  return typed >= 3 ? '3+' : String(Math.max(0, Math.floor(typed)))
}

/**
 * The Monday of the week `ms` falls in, in this device's time — the time a document's file is named by — as
 * `YYYY-MM-DD`. A decision and the document it was made in are counted in the same week.
 */
export function weekOf(ms: number): string {
  const at = new Date(ms)
  const monday = new Date(at.getFullYear(), at.getMonth(), at.getDate() - ((at.getDay() + 6) % 7)) // getDay: 0 = Sunday
  return [monday.getFullYear(), String(monday.getMonth() + 1).padStart(2, '0'), String(monday.getDate()).padStart(2, '0')].join('-')
}

/**
 * The day a document's file is named by (`2026-10-13-문의.md`, `2026-10-13 (1).md`), as the start of that day in
 * this device's time, as the app named it; undefined for a name that starts with no day.
 */
export function namedDay(path: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?=[-. ]|$)/.exec(path.slice(path.lastIndexOf('/') + 1))
  if (!match) return undefined
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date.getTime() : undefined
}

function isFilled(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)
}

/**
 * The forms counted, numbered from 1 in the order of their references. The numbering is this vault's
 * alone; it is shown to the person exporting so they know which is which, and never exported.
 */
export function numberedForms(templates: readonly TemplateSnapshot[]): TemplateSnapshot[] {
  return templates.filter((t) => t.suggest.length > 0).sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
}

export function weeklyCounts(
  templates: readonly TemplateSnapshot[],
  documents: readonly DocumentSnapshot[],
  events: readonly SuggestionEvent[],
  presentations: readonly Presentation[] = [],
): WeeklyCounts {
  const forms = numberedForms(templates)
  const formNumber = new Map(forms.map((t, i) => [t.ref, i + 1]))
  const templateOf = new Map(documents.map((d) => [d.id, d.template]))

  const cells = new Map<string, WeekCounts>()
  /** The week's counts for a judgment field of a counted form; undefined for anything else. */
  const cellOf = (ref: string | undefined, name: string, when: string): WeekCounts | undefined => {
    const form = ref === undefined ? undefined : formNumber.get(ref)
    const field = form ? forms[form - 1].suggest.indexOf(name) + 1 : 0
    const at = Date.parse(when)
    if (!form || field === 0 || Number.isNaN(at)) return undefined
    const week = weekOf(at)
    const key = `${week}|${form}|${field}`
    let cell = cells.get(key)
    if (!cell) {
      cell = { week, form, field, presented: 0, accepted: 0, corrected: 0, rejected: 0, bySimilarity: {}, bySource: {}, byTyped: {} }
      cells.set(key, cell)
    }
    return cell
  }
  const typedOf = (cell: WeekCounts, typed: number) => (cell.byTyped[typedSlot(typed)] ??= { presented: 0, decided: 0, accepted: 0 })
  for (const shown of presentations) {
    const cell = cellOf(shown.template, shown.field, shown.at)
    if (!cell) continue
    cell.presented++
    if (typeof shown.typed === 'number') typedOf(cell, shown.typed).presented++
  }
  for (const event of events) {
    // An event names its template; older ones are placed through their document, if it is still there.
    const cell = cellOf(event.template ?? templateOf.get(event.doc), event.field, event.at)
    if (!cell) continue
    if (event.kind === 'accept') cell.accepted++
    else if (event.kind === 'correct') cell.corrected++
    else cell.rejected++
    if (typeof event.source === 'string' && event.source) {
      const slot = (cell.bySource[event.source] ??= { decided: 0, accepted: 0 })
      slot.decided++
      if (event.kind === 'accept') slot.accepted++
    }
    if (typeof event.typed === 'number') {
      const slot = typedOf(cell, event.typed)
      slot.decided++
      if (event.kind === 'accept') slot.accepted++
    }
    if (event.similarity !== null) {
      const bucket = (Math.floor(Math.min(event.similarity, 1) * 10) / 10).toFixed(1)
      const slot = (cell.bySimilarity[bucket] ??= { decided: 0, accepted: 0 })
      slot.decided++
      if (event.kind === 'accept') slot.accepted++
    }
  }

  const formCounts = forms.map((template, i): FormCounts => {
    const saved = documents
      .filter((d) => d.template === template.ref && !d.conflicted && template.suggest.some((f) => isFilled(d.values[f])))
      .map((d) => namedDay(d.path) ?? d.modified)
    const times = saved.filter((m): m is number => m !== undefined && m > 0)
    // Folded rather than spread: a spread's arguments are limited, and a vault can hold more documents.
    const first = times.reduce((a, b) => Math.min(a, b), Infinity)
    const last = times.reduce((a, b) => Math.max(a, b), -Infinity)
    const weeks = times.length === 0 ? 0 : Math.round((Date.parse(weekOf(last)) - Date.parse(weekOf(first))) / (7 * DAY)) + 1
    return { form: i + 1, confirmed: saved.length, weeks, perWeek: weeks === 0 ? 0 : Math.round((saved.length / weeks) * 100) / 100 }
  })

  const counts = [...cells.values()].sort((a, b) =>
    a.week !== b.week ? (a.week < b.week ? -1 : 1) : a.form !== b.form ? a.form - b.form : a.field - b.field,
  )
  return { format: WEEKLY_COUNTS_FORMAT, counts, forms: formCounts }
}
