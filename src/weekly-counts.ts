// Weekly counts of what people did with suggestions — numbers only, for a person to hand to whoever
// studies whether suggestions improve with use. Nothing that says what a document is about leaves in
// it: forms and fields are numbered, and no value, name or path is written (constitution §3).

import type { SuggestionEvent } from './events.js'
import type { DocumentSnapshot, TemplateSnapshot } from './projection.js'

export const WEEKLY_COUNTS_FORMAT = 'lowline-weekly-counts/1'

/** One week of one judgment field. */
export interface WeekCounts {
  /** The Monday the week starts on (UTC), as `YYYY-MM-DD`. */
  week: string
  /** The form's number in this vault (see {@link WeeklyCounts.forms}); a new version is a new number. */
  form: number
  /** The judgment field's number within its form, in the order the form names them. */
  field: number
  accepted: number
  corrected: number
  rejected: number
  /** Decisions by the similarity the suggestion was made at, in steps of 0.1 (`"0.6"` = 0.6 to under 0.7). */
  bySimilarity: Record<string, { decided: number; accepted: number }>
}

export interface FormCounts {
  form: number
  /** Saved documents with a value in at least one judgment field. */
  confirmed: number
  /** Weeks from the first such save to the last, both included. */
  weeks: number
  perWeek: number
}

export interface WeeklyCounts {
  format: typeof WEEKLY_COUNTS_FORMAT
  /** Only decisions are recorded: a suggestion shown and left undecided leaves no trace to count. */
  counts: WeekCounts[]
  forms: FormCounts[]
}

const DAY = 24 * 60 * 60 * 1000

/** The Monday (UTC) of the week `ms` falls in, as `YYYY-MM-DD`. */
export function weekOf(ms: number): string {
  const day = new Date(ms).getUTCDay() // 0 = Sunday
  const monday = ms - ((day + 6) % 7) * DAY
  return new Date(monday).toISOString().slice(0, 10)
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
): WeeklyCounts {
  const forms = numberedForms(templates)
  const formNumber = new Map(forms.map((t, i) => [t.ref, i + 1]))
  const templateOf = new Map(documents.map((d) => [d.path, d.template]))

  const cells = new Map<string, WeekCounts>()
  for (const event of events) {
    // An event names its template; older ones are placed through their document, if it is still there.
    const ref = event.template ?? templateOf.get(event.doc)
    const form = ref === undefined ? undefined : forms[(formNumber.get(ref) ?? 0) - 1]
    const field = form ? form.suggest.indexOf(event.field) + 1 : 0
    const at = Date.parse(event.at)
    if (!form || field === 0 || Number.isNaN(at)) continue
    const week = weekOf(at)
    const key = `${week}|${formNumber.get(form.ref)}|${field}`
    let cell = cells.get(key)
    if (!cell) {
      cell = { week, form: formNumber.get(form.ref)!, field, accepted: 0, corrected: 0, rejected: 0, bySimilarity: {} }
      cells.set(key, cell)
    }
    if (event.kind === 'accept') cell.accepted++
    else if (event.kind === 'correct') cell.corrected++
    else cell.rejected++
    if (event.similarity !== null) {
      const bucket = (Math.floor(Math.min(event.similarity, 1) * 10) / 10).toFixed(1)
      const slot = (cell.bySimilarity[bucket] ??= { decided: 0, accepted: 0 })
      slot.decided++
      if (event.kind === 'accept') slot.accepted++
    }
  }

  const formCounts = forms.map((template, i): FormCounts => {
    const saved = documents
      .filter((d) => d.template === template.ref && template.suggest.some((f) => isFilled(d.values[f])))
      .map((d) => d.modified)
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
