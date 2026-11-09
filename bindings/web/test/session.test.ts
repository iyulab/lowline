import { describe, expect, it } from 'vitest'
import { Draft, valuesOf } from '../src/draft.js'
import { Session, englishStrings, type Proposal } from '../src/session.js'
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
    // Back to the value turned down: still turned down in this record, and not written into its JSON otherwise.
    draft.show('owner', { value: 'lee' })
    expect(draft.fields.owner.declined).toBe(true)
    expect(JSON.parse(JSON.stringify(draft)).fields.owner).toEqual({ shown: { value: 'lee' }, declined: true })
  })

  it('holds an answer back with its probability, and refuses one out of range', () => {
    const draft = new Draft()
    draft.show('owner', { value: 'lee' })
    draft.hold('owner', 0.05)
    expect(draft.fields.owner).toEqual({ held: 0.05 })
    expect(() => draft.hold('owner', 0)).toThrow(RangeError)
  })

  it('says whether the promise of the suggestion shown was displayed, until another one is shown or the answer is held', () => {
    const draft = new Draft()
    expect(draft.showPromise('owner', true, 0.5)).toBe(false)
    draft.show('owner', { value: 'lee' })
    expect(draft.showPromise('owner', true, 0.5)).toBe(true)
    draft.show('owner', { value: 'lee' })
    expect(draft.fields.owner.promise_shown).toEqual({ shown: true, probability: 0.5 })
    draft.show('owner', { value: 'kim' })
    expect(draft.fields.owner.promise_shown).toBeUndefined()
    draft.showPromise('owner', false, 0)
    draft.hold('owner', 0.05)
    expect(draft.fields.owner.promise_shown).toBeUndefined()
    for (const [shown, probability] of [[true, 0], [false, 1], [true, 1.5], [false, -0.1]] as const) {
      expect(() => draft.showPromise('owner', shown, probability)).toThrow(RangeError)
    }
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

  it('says why an empty decided field is shown no suggestion, in the host’s words', () => {
    const asking: Proposal = {
      field: 'owner', suggestion: null, prefill: false, layer: null, abstain: 'needs-judgement', asks: [['customer', 'Gamma']],
    }
    const unsure: Proposal = { ...asking, field: 'site', abstain: 'unsure' }
    const off: Proposal = { ...asking, field: 'note', abstain: 'off' }
    const round = new Session('r', {}, 0.05, never).apply([asking, unsure, off], {})
    expect(round.fieldStates).toEqual({
      owner: { note: 'Needs your judgement — the records cannot tell' },
      site: { note: 'No suggestion — the records are not sure enough' },
      note: { note: 'Yours to decide — this form suggests nothing here' },
    })
    expect(round.prefill).toEqual({})

    const strings = { ...englishStrings, abstain: { ...englishStrings.abstain, unsure: '' } }
    const own = new Session('r', {}, 0.05, never, strings).apply([asking, unsure], {})
    expect(Object.keys(own.fieldStates)).toEqual(['owner'])
  })

  it('says a judgement was asked and could not tell, when the judged answer suggests nothing', () => {
    const asking: Proposal = {
      field: 'owner', suggestion: null, prefill: false, layer: null, abstain: 'needs-judgement', asks: [['customer', 'Gamma']],
    }
    const session = new Session('r', {}, 0.05, never)
    expect(session.apply([asking], {}).fieldStates.owner).toEqual({ note: 'Needs your judgement — the records cannot tell' })
    expect(session.toJudge([asking])).toEqual(['owner'])
    session.takeJudged([asking], [{ ...asking, abstain: 'unsure', asks: [] }])
    const round = session.apply(session.judged([asking]), {})
    expect(round.fieldStates.owner).toEqual({
      note: 'Needs your judgement — neither the records nor a judgement gave a suggestion',
    })
  })

  it('says nothing of a field that asks for a judgement on nothing written yet', () => {
    const early: Proposal = { field: 'owner', suggestion: null, prefill: false, layer: null, abstain: 'needs-judgement', asks: [] }
    expect(new Session('r', {}, 0.05, never).apply([early], {}).fieldStates).toEqual({})
  })

  it('says nothing of a field that holds a value, or one held back with a field drawn for a check', () => {
    const asking: Proposal = { field: 'owner', suggestion: null, prefill: false, layer: null, abstain: 'needs-judgement' }
    expect(new Session('r', {}, 0.05, never).apply([asking], { owner: 'kim' }).fieldStates).toEqual({})

    const kind: Proposal = { ...lee, field: 'kind', together: 'case' }
    const cause: Proposal = { ...asking, field: 'cause', abstain: 'together', together: 'case' }
    const checked = new Session('r', {}, 0.05, () => 0.01).apply([kind, cause], {})
    expect(checked.fieldStates).toEqual({})
  })

  it('puts nothing in when the host keeps suggestions beside their fields', () => {
    const session = new Session('r', { customer: 'Beta' }, 0.05, never)
    session.prefills = false
    const round = session.apply([lee], { customer: 'Beta' })
    expect(round.prefill).toEqual({})
    expect(round.fieldStates.owner?.suggestions).toEqual(['lee'])
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

  it('audited, holds every checkable answer back with the audit’s probability and shows nothing else', () => {
    const session = new Session('r', {}, 0.05, never)
    session.audit = 0.1
    const unsure: Proposal = { field: 'priority', abstain: 'unsure' }
    const round = session.apply([lee, { ...lee, field: 'team', suggestion: { value: 'A-', fit: 'prefix' } }, unsure], {})
    expect(round).toEqual({ fieldStates: {}, prefill: {} })
    expect(session.draft.held('owner')).toBe(0.1)
    expect(session.draft.held('team')).toBeUndefined()
    expect(session.draft.shown('team')).toBeUndefined()
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
        owner: {
          shown: lee.suggestion,
          declined: false,
          layer: 'key',
          promise: 0.9,
          promise_shown: { shown: false, probability: 0 },
          at: 2001,
        },
      },
      opened_at: 1000,
      saved_at: 4000,
      arrival: ['customer', 'owner'],
      by: 'person-7',
      batch: 'import-3',
    })
  })

  it('reports the score of a judgement to the draft, and none for an answer of the records', () => {
    const session = new Session('r', {}, 0.05, never, undefined, () => 10)
    session.apply([{ ...lee, layer: 'judgement', score: 0.73 }], {})
    expect(session.draft.fields.owner).toMatchObject({ layer: 'judgement', score: 0.73 })
    session.apply([{ ...lee, suggestion: { value: 'kim' }, layer: 'key', promise: 0.9 }], {})
    expect(session.draft.fields.owner.score).toBeUndefined()
  })

  it('says the form never displays a promise, for the answers that carry one', () => {
    const session = new Session('r', {}, 0.05, never, undefined, () => 10)
    session.apply([lee], {})
    expect(session.draft.fields.owner.promise_shown).toBeUndefined()
    session.apply([{ ...lee, promise: 0.9 }], {})
    expect(session.draft.fields.owner.promise_shown).toEqual({ shown: false, probability: 0 })
    session.applyFill([{ ...lee, suggestion: { value: 'park', origin: 'other' }, promise: 0.9 }])
    expect(session.draft.fields.owner.promise_shown).toBeUndefined()
  })

  it('keeps a suggestion turned down out of view for the rest of the record, whatever is suggested between', () => {
    const kim: Proposal = { ...lee, suggestion: { value: 'kim', origin: 'decider', fit: 'exact' }, basis: [{ kind: 'value', field: 'customer', value: 'Acme' }] }
    const session = new Session('r', {}, 0.05, never, undefined, () => 10)
    expect(session.apply([kim], { customer: 'Acme' }).fieldStates.owner?.suggestions).toEqual(['kim'])
    session.decline('owner', { customer: 'Acme' })
    expect(session.apply([kim], { customer: 'Acme' }).fieldStates.owner).toBeUndefined()
    expect(session.apply([lee], { customer: 'Beta' }).fieldStates.owner?.suggestions).toEqual(['lee'])
    expect(session.apply([kim], { customer: 'Acme' }).fieldStates.owner).toBeUndefined()
    expect(session.draft.fields.owner).toMatchObject({ shown: { value: 'kim' }, declined: true })
    // A new record starts with nothing turned down.
    session.saved({ customer: 'Acme' })
    expect(session.apply([kim], { customer: 'Acme' }).fieldStates.owner?.suggestions).toEqual(['kim'])
  })

  it('shows the promise beside the suggestion as a count out of ten, rounded down, when the host turns it on', () => {
    const session = new Session('r', {}, 0.05, never, undefined, () => 10)
    session.promises = 1
    const round = session.apply([{ ...lee, promise: 0.974 }], {})
    expect(round.fieldStates.owner.note).toBe('As before with customer beta · right 9 times in 10 like this')
    expect(session.draft.fields.owner.promise_shown).toEqual({ shown: true, probability: 1 })
  })

  it('draws the display once for each suggestion shown, reports the draw, and draws again for another suggestion', () => {
    // The check is drawn first (0.3 — not held back), then the display: 0.3 shows it, 0.9 does not.
    const rolls = [0.3, 0.3, 0.9]
    const session = new Session('r', {}, 0.05, () => rolls.shift() ?? 0, undefined, () => 10)
    session.promises = 0.5
    expect(session.apply([{ ...lee, promise: 0.8 }], {}).fieldStates.owner.note).toContain('right 8 times in 10')
    expect(session.draft.fields.owner.promise_shown).toEqual({ shown: true, probability: 0.5 })
    // The same suggestion again: the same draw, nothing rolled.
    expect(session.apply([{ ...lee, promise: 0.8 }], {}).fieldStates.owner.note).toContain('right 8 times in 10')
    const kim = { ...lee, suggestion: { value: 'kim', origin: 'decider' as const, fit: 'exact' as const }, promise: 0.8 }
    expect(session.apply([kim], {}).fieldStates.owner.note).toBe('As before with customer beta')
    expect(session.draft.fields.owner.promise_shown).toEqual({ shown: false, probability: 0.5 })
  })

  it('shows no promise for a suggestion that carries none, nor when the rate is out of range', () => {
    const off = new Session('r', {}, 0, () => 0, undefined, () => 10)
    off.promises = 2
    expect(off.apply([{ ...lee, promise: 0.9 }], {}).fieldStates.owner.note).toBe('As before with customer beta')
    expect(off.draft.fields.owner.promise_shown).toEqual({ shown: false, probability: 0 })
    const none = new Session('r', {}, 0, () => 0, undefined, () => 10)
    none.promises = 1
    expect(none.apply([lee], {}).fieldStates.owner.note).toBe('As before with customer beta')
    expect(none.draft.fields.owner.promise_shown).toBeUndefined()
  })

  it('says the words the host changes to while a record is written in the next round', () => {
    const session = new Session('r', {}, 0.05, never, undefined, () => 10)
    session.strings = { ...englishStrings, decline: 'Nope' }
    expect(session.apply([lee], {}).fieldStates.owner?.decline).toBe('Nope')
  })

  it('lets the host word the promise', () => {
    const session = new Session('r', {}, 0, never, { ...englishStrings, promise: '10번 중 {right}번 맞음' }, () => 10)
    session.promises = 1
    expect(session.apply([{ ...lee, promise: 0.86 }], {}).fieldStates.owner.note).toBe('As before with customer beta · 10번 중 8번 맞음')
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
    expect(states).toEqual({
      owner: { suggestions: ['kim'], decline: 'Not this', note: 'From what you wrote' },
      kind: { note: 'No suggestion — the value given was not one of the choices' },
    })
    expect(session.draft.shown('owner')?.origin).toBe('other')
    // The records suggest lee; what was filled from the writing stays in view, and nothing is put in.
    expect(session.apply([lee], {})).toEqual({ fieldStates: { owner: states.owner }, prefill: {} })
    // The records have nothing for the field the writing could not fill: what the writing gave is still said.
    const kind: Proposal = { field: 'kind', suggestion: null, prefill: false, layer: null, abstain: 'unsure' }
    expect(session.apply([kind], {}).fieldStates.kind).toEqual(states.kind)
    expect(session.apply([kind], { kind: 'bug' }).fieldStates.kind).toBeUndefined()
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
      note: 'Judged from this record’s values — no settled record answers it',
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

  it('puts nothing in for a field it abstains on, and offers no value', () => {
    const session = new Session('r', {}, 0.05, never)
    const round = session.apply([{ ...lee, suggestion: null, prefill: false, layer: null, basis: [], abstain: 'unsure' }], {})
    expect(round.prefill).toEqual({})
    expect(round.fieldStates.owner?.suggestions).toBeUndefined()
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

  it('sends what the person showed with the text to the fill route, and nothing extra without it', async () => {
    const calls: { url: string; body: unknown }[] = []
    const client = new LowlineClient('/lowline', async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify([lee]))
    })
    const photo = { mediaType: 'image/jpeg', data: 'AQID', name: 'nameplate' }
    await client.fill('intake', {}, '', [photo])
    await client.fill('intake', {}, 'Beta, lee')
    expect(calls).toEqual([
      { url: '/lowline/intake/fill', body: { values: {}, text: '', attachments: [photo] } },
      { url: '/lowline/intake/fill', body: { values: {}, text: 'Beta, lee' } },
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
