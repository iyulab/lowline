import type { Draft, Values } from './draft.js'
import type { Proposal } from './session.js'

/** A route of the host refused a call: its status, and what it said. */
export class LowlineError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'LowlineError'
  }
}

/** A threshold chosen on a replay of the settled records, and what the replay saw at it. */
export interface ThresholdChoice {
  threshold: number
  /** The share of the replay's answers at this threshold that were right. */
  precision: number
  /** The share of lookups answered at it. */
  answer_rate: number
  answered: number
  lookups: number
  /** The precision over the latest records (`promiseOver` of them), on `promise_answered` independent answers. */
  promise: number
  promise_answered: number
}

/**
 * How one decided field's replays went when its thresholds were chosen — `GET {src}/{form}/report`. A part with
 * nothing to say is left out.
 */
export interface FieldReport {
  field: string
  lookups: number
  /** The threshold at which values settled alongside answer; absent while none was right often enough. */
  key?: ThresholdChoice
  /** When `key` is absent, the closest the replay came; absent when too few were answered to say. */
  closest?: ThresholdChoice
  /** The fields chosen to key it; absent when every field it rests on does. */
  keyFields?: string[]
  /** For a free text field, the threshold for one, two, … characters typed (`null` where none was right often enough). */
  typed?: (ThresholdChoice | null)[]
  coarse?: ThresholdChoice
  similar?: ThresholdChoice
  similarOffered: boolean
  promiseOver: number
  /** How many checks — answers held back while a person wrote the value — are among the records. */
  checks: number
  /** What the precision was counted on: values settled with nothing in view and checks, or every settled value. */
  counting: 'unprompted' | 'settled'
}

/**
 * The routes a Lowline host maps (`MapLowline` in .NET): `POST {src}/{form}/propose` and `POST {src}/{form}/settle`,
 * `GET {src}/{form}/report`, and — when the host gave a model — `fill` and `judge`. The host decides the memory space and the choices a person may pick from the request
 * itself — its sign-in — so the calls carry the record only.
 */
export class LowlineClient {
  constructor(
    readonly src: string,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}

  /** What to show for each open decided field of record `id`, given its values so far. */
  propose(form: string, id: string, values: Values): Promise<Proposal[]> {
    return this.post(form, 'propose', { id, values })
  }

  /**
   * Settles record `id` with the draft kept while it was written: saves it holding `saved`, or — left out, for a host
   * that stores its records through its own API and reads them back (`Saved` in .NET) — learns what the host stored.
   */
  settle(form: string, id: string, draft: Draft, saved?: Values): Promise<{ id: string; settledAt: string }> {
    return this.post(form, 'settle', { id, saved, draft })
  }

  /** What the host's model makes of `text` for the fields of record values still empty — 404 when the host gave none. */
  fill(form: string, values: Values, text: string): Promise<Proposal[]> {
    return this.post(form, 'fill', { values, text })
  }

  /**
   * What the host's model judged for the decided fields of record `id` the records could not answer
   * (`needs-judgement`) — 404 when the host gave no model.
   */
  judge(form: string, id: string, values: Values): Promise<Proposal[]> {
    return this.post(form, 'judge', { id, values })
  }

  /** Per decided field, in the form's order, the thresholds chosen on this memory space's records and what the replay saw. */
  report(form: string): Promise<FieldReport[]> {
    return this.send(form, 'report', { method: 'GET', credentials: 'same-origin' })
  }

  private post<T>(form: string, route: string, body: unknown): Promise<T> {
    return this.send(form, route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    })
  }

  private async send<T>(form: string, route: string, init: RequestInit): Promise<T> {
    const url = `${this.src.replace(/\/+$/, '')}/${encodeURIComponent(form)}/${route}`
    const response = await this.fetcher(url, init)
    if (!response.ok) {
      const problem = await response.json().catch(() => undefined)
      throw new LowlineError(response.status, problem?.detail ?? `${route} answered ${response.status}`)
    }
    return (await response.json()) as T
  }
}
