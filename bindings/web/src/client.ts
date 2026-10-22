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

/**
 * The routes a Lowline host maps (`MapLowline` in .NET): `POST {src}/{form}/propose` and `POST {src}/{form}/settle`,
 * and — when the host gave a model — `fill` and `judge`. The host decides the memory space and the choices a person may pick from the request
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

  /** Saves record `id` holding `saved`, with the draft kept while it was written. */
  settle(form: string, id: string, saved: Values, draft: Draft): Promise<{ id: string; settledAt: string }> {
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

  private async post<T>(form: string, route: string, body: unknown): Promise<T> {
    const url = `${this.src.replace(/\/+$/, '')}/${encodeURIComponent(form)}/${route}`
    const response = await this.fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    })
    if (!response.ok) {
      const problem = await response.json().catch(() => undefined)
      throw new LowlineError(response.status, problem?.detail ?? `${route} answered ${response.status}`)
    }
    return (await response.json()) as T
  }
}
