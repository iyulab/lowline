import { describe, expect, it } from 'vitest'
import { Draft, valuesOf } from '../src/draft.js'
import { Session, type Proposal } from '../src/session.js'
import { LowlineClient, LowlineError } from '../src/client.js'

const lee: Proposal = {
  field: 'owner',
  suggestion: { value: 'lee', origin: 'decider', fit: 'exact' },
  prefill: true,
  layer: 'key',
  basis: [{ kind: 'value', field: 'customer', value: 'beta' }],
  abstain: null,
}

const never = () => 1

describe('Draft', () => {
  it('is written as the engine reads it', () => {
    const draft = new Draft({ customer: 'Beta', note: '' })
    draft.show('owner', { value: 'lee' })
    expect(JSON.parse(JSON.stringify(draft))).toEqual({
      opened: { customer: 'Beta' },
      fields: { owner: { shown: { value: 'lee' }, declined: false } },
    })
  })

  it('keeps a turn-down only for the suggestion turned down', () => {
    const draft = new Draft()
    expect(draft.decline('owner')).toBe(false)
    draft.show('owner', { value: 'lee' })
    expect(draft.decline('owner')).toBe(true)
    draft.show('owner', { value: 'lee' })
    expect(draft.fields.owner.declined).toBe(true)
    draft.show('owner', { value: 'kim' })
    expect(draft.fields.owner.declined).toBe(false)
  })

  it('holds an answer back with its probability, and refuses one out of range', () => {
    const draft = new Draft()
    draft.show('owner', { value: 'lee' })
    draft.hold('owner', 0.05)
    expect(draft.fields.owner).toEqual({ held: 0.05 })
    expect(() => draft.hold('owner', 0)).toThrow(RangeError)
  })

  it('reads a form’s data as texts and lists of texts', () => {
    expect(valuesOf({ a: 'x', b: ['p', 'q'], c: 3, d: true, e: '', f: null, g: [] })).toEqual({
      a: 'x',
      b: ['p', 'q'],
      c: '3',
      d: 'true',
    })
  })
})

describe('Session', () => {
  it('shows a suggestion, notes what it rests on as the record holds it, and puts it in when it may', () => {
    const session = new Session('r', { customer: 'Beta' }, 0.05, never)
    const round = session.apply([lee], { customer: 'Beta' })
    expect(round.prefill).toEqual({ owner: 'lee' })
    expect(round.fieldStates.owner).toEqual({
      suggestions: ['lee'],
      decline: 'Not this',
      note: 'As before with customer Beta',
    })
    expect(session.draft.shown('owner')).toEqual(lee.suggestion)
    // Taken before the suggestion: what the record was opened with is not the prefilled value.
    expect(session.draft.opened).toEqual({ customer: 'Beta' })
  })

  it('puts nothing in a field that holds a value, or for a field the host must not fill', () => {
    const session = new Session('r', {}, 0.05, never)
    expect(session.apply([lee], { owner: 'kim' }).prefill).toEqual({})
    expect(session.apply([{ ...lee, prefill: false }], {}).prefill).toEqual({})
  })

  it('holds a field back to check it once, at random, and keeps it held', () => {
    const rolls = [0.01]
    const session = new Session('r', {}, 0.05, () => rolls.shift() ?? 1)
    const first = session.apply([lee], {})
    expect(first.fieldStates).toEqual({})
    expect(first.prefill).toEqual({})
    expect(session.draft.held('owner')).toBe(0.05)
    expect(session.apply([lee], {}).fieldStates).toEqual({})
    expect(session.draft.held('owner')).toBe(0.05)
  })

  it('holds back the open fields of a checked field’s group, checking only the field drawn', () => {
    const industry: Proposal = { ...lee, field: 'industry', suggestion: { value: 'health', origin: 'decider', fit: 'exact' }, together: 'coding' }
    const occupation: Proposal = { ...lee, field: 'occupation', suggestion: { value: 'nurse', origin: 'decider', fit: 'exact' }, together: 'coding' }
    const rolls = [0, 0.99, 0.99]
    const session = new Session('r', {}, 0.05, () => rolls.shift() ?? 1)
    const round = session.apply([industry, occupation, lee], {})
    expect(session.draft.held('industry')).toBe(0.05)
    expect(session.draft.held('occupation')).toBeUndefined()
    expect(Object.keys(round.fieldStates)).toEqual(['owner'])
    expect(round.prefill).toEqual({ owner: 'lee' })
    // Once the checked field is settled it is no longer proposed, and its group is shown again.
    expect(Object.keys(session.apply([occupation], { industry: 'health' }).fieldStates)).toEqual(['occupation'])
  })

  it('draws a field once: not drawn, it is shown from then on', () => {
    let rolled = 0
    const session = new Session('r', {}, 0.05, () => (rolled++, 0.9))
    session.apply([lee], {})
    session.apply([lee], {})
    expect(rolled).toBe(1)
    expect(session.draft.shown('owner')?.value).toBe('lee')
  })

  it('never holds back a class or a suggestion from elsewhere', () => {
    const session = new Session('r', {}, 1, () => 0)
    session.apply([{ ...lee, suggestion: { value: 'A-', fit: 'prefix' }, prefill: false }], {})
    expect(session.draft.held('owner')).toBeUndefined()
    expect(session.draft.shown('owner')?.fit).toBe('prefix')
  })

  it('never holds back a field that takes several values — a set cannot be a check', () => {
    const session = new Session('r', {}, 1, () => 0)
    session.apply([{ ...lee, several: true }], {})
    expect(session.draft.held('owner')).toBeUndefined()
    expect(session.draft.shown('owner')?.value).toBe('lee')
  })

  it('starts the next record from the saved values', () => {
    const session = new Session('r', {}, 0.05, never, undefined, () => 40)
    session.apply([lee], {})
    session.decline('owner', { owner: 'lee' })
    session.saved({ customer: 'Beta', owner: 'kim' })
    expect(JSON.parse(JSON.stringify(session.draft))).toEqual({ opened: { customer: 'Beta', owner: 'kim' }, fields: {}, opened_at: 40 })
  })

  it('reports to the draft what the engine writes into the record: layer, promise, times, arrival, who and batch', () => {
    let now = 1000.4
    const session = new Session('r', {}, 0.05, never, undefined, () => now)
    now = 1500
    session.took({ customer: 'Beta' })
    now = 2000.6
    session.apply([{ ...lee, promise: 0.9 }], { customer: 'Beta' })
    now = 2600
    session.took({ customer: 'Beta', owner: 'lee' })
    session.took({ customer: 'Beta', owner: 'lee' }) // nothing new: nothing arrives again
    now = 4000
    session.beforeSave('person-7', 'import-3')
    expect(JSON.parse(JSON.stringify(session.draft))).toEqual({
      opened: {},
      fields: {
        customer: { at: 1500 },
        owner: { shown: lee.suggestion, declined: false, layer: 'key', promise: 0.9, at: 2001 },
      },
      opened_at: 1000,
      saved_at: 4000,
      arrival: ['customer', 'owner'],
      by: 'person-7',
      batch: 'import-3',
    })
  })

  it('keeps the answer held back for a check, with its layer and promise', () => {
    const session = new Session('r', {}, 0.05, () => 0, undefined, () => 10)
    session.apply([{ ...lee, promise: 0.8 }], {})
    expect(JSON.parse(JSON.stringify(session.draft.fields.owner))).toEqual({
      held: 0.05,
      withheld: lee.suggestion,
      layer: 'key',
      promise: 0.8,
    })
  })

  it('empties a field it filled when its suggestion is turned down, and not one the person filled', () => {
    const session = new Session('r', {}, 0.05, never)
    session.apply([lee], {})
    expect(session.decline('owner', { owner: 'lee' })).toBe(true)
    expect(session.draft.fields.owner.declined).toBe(true)
    // Asked again, the turned-down suggestion is neither shown nor put back; another one is.
    expect(session.apply([lee], { customer: 'Beta' })).toEqual({ fieldStates: {}, prefill: {} })
    expect(session.draft.fields.owner.declined).toBe(true)
    const kim = { ...lee, suggestion: { value: 'kim' } }
    expect(session.apply([kim], {}).prefill).toEqual({ owner: 'kim' })
    expect(session.draft.fields.owner.declined).toBe(false)
    const typed = new Session('r', {}, 0.05, never)
    typed.apply([{ ...lee, prefill: false }], {})
    expect(typed.decline('owner', { owner: 'lee' })).toBe(false)
    const changed = new Session('r', {}, 0.05, never)
    changed.apply([lee], {})
    expect(changed.decline('owner', { owner: 'kim' })).toBe(false)
  })

  it('offers what was filled from the writing until it is picked or turned down, ahead of the records', () => {
    const session = new Session('r', {}, 0.05, never)
    const states = session.applyFill([
      { field: 'owner', suggestion: { value: 'kim', origin: 'other', fit: 'exact' }, prefill: false, layer: null, abstain: null },
      { field: 'kind', suggestion: null, prefill: false, layer: null, abstain: 'not-a-choice' },
    ])
    expect(states).toEqual({ owner: { suggestions: ['kim'], decline: 'Not this', note: 'From what you wrote' } })
    expect(session.draft.shown('owner')?.origin).toBe('other')
    // The records suggest lee; what was filled from the writing stays in view, and nothing is put in.
    expect(session.apply([lee], {})).toEqual({ fieldStates: states, prefill: {} })
    expect(session.draft.shown('owner')?.value).toBe('kim')
    session.picked('owner')
    expect(session.apply([lee], {}).fieldStates.owner.suggestions).toEqual(['lee'])
  })

  it('asks for a judgement once on what it reads, and shows it from then on', () => {
    const session = new Session('r', {}, 0.05, never)
    const asking: Proposal = {
      field: 'owner',
      suggestion: null,
      prefill: false,
      layer: null,
      abstain: 'needs-judgement',
      asks: [['customer', 'Gamma']],
    }
    expect(session.toJudge([asking])).toEqual(['owner'])
    // Asked again while the host is still judging, or on the same values: not asked twice.
    expect(session.toJudge([asking])).toEqual([])
    expect(session.judged([asking])).toEqual([asking])

    const judged: Proposal = { ...lee, layer: 'judgement', basis: [], prefill: false }
    session.takeJudged([asking], [judged])
    expect(session.judged([asking])).toEqual([judged])
    const round = session.apply(session.judged([asking]), { customer: 'Gamma' })
    expect(round.fieldStates.owner).toEqual({
      suggestions: ['lee'],
      decline: 'Not this',
      note: 'Suggested from what was written',
    })

    // Other values to read: asked again, and the old judgement is not shown for them.
    const other = { ...asking, asks: [['customer', 'Delta']] as [string, string][] }
    expect(session.judged([other])).toEqual([other])
    expect(session.toJudge([other])).toEqual(['owner'])
    // A judgement for what it read before arrives late: it does not answer the newer question.
    session.takeJudged([asking], [judged])
    expect(session.judged([other])).toEqual([other])
  })

  it('does not ask again what the host judged to nothing, and asks again what it could not judge', () => {
    const session = new Session('r', {}, 0.05, never)
    const blank: Proposal = { field: 'owner', suggestion: null, prefill: false, layer: null, abstain: 'needs-judgement', asks: [] }
    expect(session.toJudge([blank]), 'nothing to read yet').toEqual([])
    const asking: Proposal = { ...blank, asks: [['customer', 'Gamma']] }
    session.toJudge([asking])
    session.takeJudged([asking], [])
    expect(session.toJudge([asking])).toEqual([])
    expect(session.judged([asking])).toEqual([asking])

    const other = new Session('r', {}, 0.05, never)
    other.toJudge([asking])
    other.notJudged([asking])
    expect(other.toJudge([asking])).toEqual(['owner'])
  })

  it('shows nothing for a field it abstains on', () => {
    const session = new Session('r', {}, 0.05, never)
    const round = session.apply([{ ...lee, suggestion: null, prefill: false, layer: null, basis: [], abstain: 'unsure' }], {})
    expect(round).toEqual({ fieldStates: {}, prefill: {} })
  })
})

describe('LowlineClient', () => {
  it('posts the record to the form’s routes and reads the answer', async () => {
    const calls: { url: string; body: unknown }[] = []
    const client = new LowlineClient('/lowline/', async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify(String(url).endsWith('propose') ? [lee] : { id: 'r', settledAt: 'now' }))
    })
    expect(await client.propose('in take', 'r', { customer: 'Beta' })).toEqual([lee])
    const draft = new Draft()
    draft.show('owner', { value: 'lee' })
    expect(await client.settle('in take', 'r', draft, { owner: 'lee' })).toEqual({ id: 'r', settledAt: 'now' })
    // A host that stores its own records reads them back: the call carries the draft only.
    await client.settle('in take', 'r', draft)
    expect(calls).toEqual([
      { url: '/lowline/in%20take/propose', body: { id: 'r', values: { customer: 'Beta' } } },
      {
        url: '/lowline/in%20take/settle',
        body: { id: 'r', saved: { owner: 'lee' }, draft: { opened: {}, fields: { owner: { shown: { value: 'lee' }, declined: false } } } },
      },
      {
        url: '/lowline/in%20take/settle',
        body: { id: 'r', draft: { opened: {}, fields: { owner: { shown: { value: 'lee' }, declined: false } } } },
      },
    ])
  })

  it('asks the judge route with the record', async () => {
    const calls: { url: string; body: unknown }[] = []
    const client = new LowlineClient('/lowline', async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify([lee]))
    })
    expect(await client.judge('intake', 'r', { customer: 'Gamma' })).toEqual([lee])
    expect(calls).toEqual([{ url: '/lowline/intake/judge', body: { id: 'r', values: { customer: 'Gamma' } } }])
  })

  it('gets the form’s report without a body', async () => {
    const calls: { url: string; method?: string; body: unknown }[] = []
    const owner = { field: 'owner', lookups: 40, similarOffered: false, promiseOver: 0, checks: 0, counting: 'unprompted' }
    const client = new LowlineClient('/lowline', async (url, init) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body })
      return new Response(JSON.stringify([owner]))
    })
    expect(await client.report('intake')).toEqual([owner])
    expect(calls).toEqual([{ url: '/lowline/intake/report', method: 'GET', body: undefined }])
  })

  it('says what a route refused', async () => {
    const client = new LowlineClient('/lowline', async () =>
      new Response(JSON.stringify({ detail: 'draft does not read' }), { status: 400 }),
    )
    await expect(client.propose('intake', 'r', {})).rejects.toEqual(new LowlineError(400, 'draft does not read'))
  })
})
