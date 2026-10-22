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

  it('starts the next record from the saved values', () => {
    const session = new Session('r', {}, 0.05, never)
    session.apply([lee], {})
    session.decline('owner')
    session.saved({ customer: 'Beta', owner: 'kim' })
    expect(JSON.parse(JSON.stringify(session.draft))).toEqual({ opened: { customer: 'Beta', owner: 'kim' }, fields: {} })
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
    expect(await client.settle('in take', 'r', { owner: 'lee' }, draft)).toEqual({ id: 'r', settledAt: 'now' })
    expect(calls).toEqual([
      { url: '/lowline/in%20take/propose', body: { id: 'r', values: { customer: 'Beta' } } },
      {
        url: '/lowline/in%20take/settle',
        body: { id: 'r', saved: { owner: 'lee' }, draft: { opened: {}, fields: { owner: { shown: { value: 'lee' }, declined: false } } } },
      },
    ])
  })

  it('says what a route refused', async () => {
    const client = new LowlineClient('/lowline', async () =>
      new Response(JSON.stringify({ detail: 'draft does not read' }), { status: 400 }),
    )
    await expect(client.propose('intake', 'r', {})).rejects.toEqual(new LowlineError(400, 'draft does not read'))
  })
})
