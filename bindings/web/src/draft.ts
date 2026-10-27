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

/** The layer of the decider an answer came from. */
export type Layer = 'key' | 'similar' | 'judgement'

/** What the host knows of the answer it shows or holds back, beyond its value: the layer that gave it and what it promised. */
export interface Reported {
  layer?: Layer | null
  promise?: number
}

interface Track extends Reported {
  shown?: Suggestion
  declined?: boolean
  held?: number
  /** The answer held back for a check, kept so the record can say what the person was not shown. */
  withheld?: Suggestion
  /** When the person reached the field, or its suggestion came into view — the first — on the session's clock, in milliseconds. */
  at?: number
}

/**
 * The account of one record while it is written: the values it was opened with, and for each field the suggestion
 * last shown, whether it was turned down, and whether its answer was held back to be checked. The host's engine
 * turns it, with the saved values, into what each decided field teaches — so a value taken from a suggestion is never
 * counted as one typed. It is only bookkeeping: nothing is counted here.
 *
 * Written as the engine reads it: `{ opened, fields: { field: { shown, declined, held } } }`, and — only what was
 * reported — `opened_at`, `saved_at` (milliseconds on one steady clock), `arrival` (the fields in the order their values
 * arrived), `by` and `batch`, and in a field `layer`, `promise`, `at` and `withheld`.
 */
export class Draft {
  readonly opened: Values
  readonly fields: Record<string, Track> = {}
  private openedAt?: number
  private savedAt?: number
  private arrival: string[] = []
  private by?: string
  private batch?: string

  /** A record opened holding `values` — none for a new one. Empty values are left out. */
  constructor(values: Values = {}) {
    this.opened = Object.fromEntries(Object.entries(values).filter(([, v]) => !isEmpty(v)))
  }

  /** A suggestion came into view for the field. A suggestion turned down earlier stays turned down only if it is this. */
  show(field: string, suggestion: Suggestion, reported: Reported = {}): void {
    const track = (this.fields[field] ??= {})
    if (!sameSuggestion(track.shown, suggestion)) track.declined = false
    track.shown = { ...suggestion }
    delete track.held
    delete track.withheld
    this.report(track, reported)
  }

  /**
   * The field's answer is held back for a check, drawn with `probability`: what the person settles is checked.
   * `withheld` is the answer not shown, with its layer and promise, for the record to say what was held back.
   */
  hold(field: string, probability: number, withheld?: { suggestion: Suggestion } & Reported): void {
    if (!(probability > 0 && probability <= 1)) throw new RangeError('a check is drawn with a probability above 0 and at most 1')
    const at = this.fields[field]?.at
    const track: Track = { held: probability }
    if (at !== undefined) track.at = at
    if (withheld) {
      track.withheld = { ...withheld.suggestion }
      this.report(track, withheld)
    }
    this.fields[field] = track
  }

  /** The record was opened at `ms` on the session's clock (a steady clock in milliseconds: only differences are read). */
  openAt(ms: number): void {
    this.openedAt = whole(ms)
  }

  /** The record is being saved at `ms` on the same clock. */
  saveAt(ms: number): void {
    this.savedAt = whole(ms)
  }

  /** The person reached the field, or its suggestion came into view, at `ms`. Only the first report for a field counts. */
  reach(field: string, ms: number): void {
    const track = (this.fields[field] ??= {})
    track.at ??= whole(ms)
  }

  /** The field's current value arrived now: it moves to the end of the order values arrived in. */
  arrived(field: string): void {
    this.arrival = this.arrival.filter((f) => f !== field)
    this.arrival.push(field)
  }

  /** The record is settled by the person `id`: an opaque id, one person, one id; not a name. */
  settledBy(id: string): void {
    this.by = id
  }

  /** The record is settled in the batch `id`, with the records that came at once from the same source. */
  inBatch(id: string): void {
    this.batch = id
  }

  private report(track: Track, { layer, promise }: Reported): void {
    if (layer) track.layer = layer
    else delete track.layer
    if (promise !== undefined) track.promise = promise
    else delete track.promise
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

  toJSON(): {
    opened: Values
    fields: Record<string, Track>
    opened_at?: number
    saved_at?: number
    arrival?: string[]
    by?: string
    batch?: string
  } {
    return {
      opened: this.opened,
      fields: this.fields,
      ...(this.openedAt !== undefined ? { opened_at: this.openedAt } : {}),
      ...(this.savedAt !== undefined ? { saved_at: this.savedAt } : {}),
      ...(this.arrival.length > 0 ? { arrival: this.arrival } : {}),
      ...(this.by !== undefined ? { by: this.by } : {}),
      ...(this.batch !== undefined ? { batch: this.batch } : {}),
    }
  }
}

/** A time the engine reads: whole milliseconds, never negative. */
function whole(ms: number): number {
  return Math.max(0, Math.round(ms))
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
