/** What a field holds: one text, or several for a field that takes several. */
export type Value = string | string[]

/** A record's values by field. */
export type Values = Record<string, Value>

/** A suggestion shown for a field: a value, or — `fit: 'prefix'` — a class the value begins with. */
export interface Suggestion {
  value: string
  origin?: 'decider' | 'other'
  fit?: 'exact' | 'prefix'
}

interface Track {
  shown?: Suggestion
  declined?: boolean
  held?: number
}

/**
 * The account of one record while it is written: the values it was opened with, and for each field the suggestion
 * last shown, whether it was turned down, and whether its answer was held back to be checked. The host's engine
 * turns it, with the saved values, into what each decided field teaches — so a value taken from a suggestion is never
 * counted as one typed. It is only bookkeeping: nothing is counted here.
 *
 * Written as the engine reads it: `{ opened, fields: { field: { shown, declined, held } } }`.
 */
export class Draft {
  readonly opened: Values
  readonly fields: Record<string, Track> = {}

  /** A record opened holding `values` — none for a new one. Empty values are left out. */
  constructor(values: Values = {}) {
    this.opened = Object.fromEntries(Object.entries(values).filter(([, v]) => !isEmpty(v)))
  }

  /** A suggestion came into view for the field. A suggestion turned down earlier stays turned down only if it is this. */
  show(field: string, suggestion: Suggestion): void {
    const track = (this.fields[field] ??= {})
    if (!sameSuggestion(track.shown, suggestion)) track.declined = false
    track.shown = { ...suggestion }
    delete track.held
  }

  /** The field's answer is held back for a check, drawn with `probability`: what the person settles is checked. */
  hold(field: string, probability: number): void {
    if (!(probability > 0 && probability <= 1)) throw new RangeError('a check is drawn with a probability above 0 and at most 1')
    this.fields[field] = { held: probability }
  }

  /** The person turned down the suggestion in view; false, changing nothing, when none was shown. */
  decline(field: string): boolean {
    const track = this.fields[field]
    if (!track?.shown) return false
    track.declined = true
    return true
  }

  /** Whether `suggestion` is the one in view for the field and the person turned it down. */
  declined(field: string, suggestion: Suggestion): boolean {
    const track = this.fields[field]
    return track?.declined === true && sameSuggestion(track.shown, suggestion)
  }

  shown(field: string): Suggestion | undefined {
    return this.fields[field]?.shown
  }

  held(field: string): number | undefined {
    return this.fields[field]?.held
  }

  toJSON(): { opened: Values; fields: Record<string, Track> } {
    return { opened: this.opened, fields: this.fields }
  }
}

function sameSuggestion(a: Suggestion | undefined, b: Suggestion): boolean {
  return a !== undefined && a.value === b.value && (a.origin ?? 'decider') === (b.origin ?? 'decider') && (a.fit ?? 'exact') === (b.fit ?? 'exact')
}

export function isEmpty(value: Value | undefined): boolean {
  return value === undefined || (Array.isArray(value) ? value.every((v) => v === '') : value === '')
}

/**
 * A form's data as the engine takes it: texts, and lists of texts; a number or a check as its text. Empty fields are
 * left out.
 */
export function valuesOf(data: Record<string, unknown>): Values {
  const values: Values = {}
  for (const [field, raw] of Object.entries(data)) {
    const value: Value | undefined = Array.isArray(raw)
      ? raw.map(String)
      : raw === null || raw === undefined
        ? undefined
        : String(raw)
    if (value !== undefined && !isEmpty(value)) values[field] = value
  }
  return values
}
