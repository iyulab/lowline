import { Draft, isEmpty, type Suggestion, type Values } from './draft.js'

/** What a suggestion rests on: another field's value it was settled under, or a settled record like this one. */
export type Basis = { kind: 'value'; field: string; value: string } | { kind: 'record'; id: string; similarity: number }

/** Why a decided field is shown no suggestion. */
export type Abstain =
  | 'off'
  | 'no-evidence'
  | 'unsure'
  | 'not-allowed'
  | 'needs-judgement'
  | 'not-a-choice'
  | 'malformed'
  | 'together'

/** What the host's engine says to show for one decided field. */
export interface Proposal {
  field: string
  suggestion: Suggestion | null
  /** Whether the suggestion may go in as the field's value without the person taking it. */
  prefill: boolean
  layer: 'key' | 'similar' | 'judgement' | null
  basis?: Basis[]
  abstain: Abstain | null
  asks?: [string, string][]
  /** For `together`: the fields of its group, still open, that are shown no suggestion. */
  with?: string[]
  /** The group of fields settled together the field is in, if any: a field held back for a check holds its group's back. */
  together?: string | null
  /**
   * How often an answer of this kind for this field has been right — the replay's precision at the threshold the
   * suggestion was held to. Absent with no suggestion, for a value from elsewhere, for a judgement until the score it
   * is trusted from was chosen from the records, and before thresholds were chosen.
   */
  promise?: number
  /** For a judgement from outside the records: the score it gave the suggestion, on its own scale. The draft keeps it. */
  score?: number
  /** Whether the field takes several values: it is settled as a set, which cannot be a check, so none is drawn for it. */
  several?: boolean
}

/** What a field shows, as formdown's `fieldStates` takes it. */
export interface FieldState {
  suggestions?: string[]
  note?: string
  decline?: string
  label?: string
}

/** The words the form shows, in the host's language. */
export interface Strings {
  /** The button that turns the suggestion down. */
  decline: string
  /** The note of a suggestion settled before under another field's value: `{field}` and `{value}` are filled in. */
  fromValue: string
  /** The note of a suggestion taken from a similar record. */
  fromSimilar: string
  /** The note of a suggestion from a judgement made outside the records. */
  fromJudgement: string
  /** The note of a value filled in from what the person wrote. */
  fromWriting: string
  /**
   * The note of an empty decided field shown no suggestion, by why: a field is never left looking like one that is not
   * decided. An empty text shows no note for that reason.
   */
  abstain: Record<Abstain, string>
  /** The note of an empty decided field a judgement was asked for and gave nothing the form can show. */
  judgedNothing: string
}

export const englishStrings: Strings = {
  decline: 'Not this',
  fromValue: 'As before with {field} {value}',
  fromSimilar: 'As in a similar record',
  fromJudgement: 'Judged from this record’s values — no settled record answers it',
  fromWriting: 'From what you wrote',
  abstain: {
    off: 'Yours to decide — this form suggests nothing here',
    'no-evidence': 'No suggestion yet — nothing settled bears on it',
    unsure: 'No suggestion — the records are not sure enough',
    'not-allowed': 'No suggestion among the choices you may pick',
    'needs-judgement': 'Needs your judgement — the records cannot tell',
    'not-a-choice': 'No suggestion — the value given was not one of the choices',
    malformed: 'No suggestion — the value given does not fit this field',
    together: 'No suggestion until the fields decided with it are settled',
  },
  judgedNothing: 'Needs your judgement — neither the records nor a judgement gave a suggestion',
}

/** What the form does with one round of proposals: what each field shows, and the values to put in unasked. */
export interface Round {
  fieldStates: Record<string, FieldState>
  prefill: Values
}

/**
 * One record being written: its draft, and what its fields show. A field's answer may be held back once, at random,
 * to check it — `rate` is how often (one in twenty by default), drawn once per field of the record, before its answer
 * is looked at, and only for a value the decider suggests.
 */
export class Session {
  draft: Draft
  private drawn = new Set<string>()
  /** Fields whose value the form put in unasked, from the suggestion still shown. */
  private filled = new Set<string>()
  /** What filling from the person's writing offers, by field, until the person picks it or turns it down. */
  private written = new Map<string, FieldState>()
  /** Why filling from the person's writing gave a field nothing to offer, by field, until it offers one. */
  private unfilled = new Map<string, string>()
  /** The judgement asked for each field, by what it reads; `null` while the host is still judging. */
  private judgements = new Map<string, { reads: string; proposal: Proposal | null }>()

  /**
   * Whether a suggestion the engine allows to go in unasked (`prefill`) is put in as the field's starting value. Off, it
   * stays beside the field until the person takes it.
   */
  prefills = true

  /** The values the form held when it was last looked at, to tell which fields' values arrived since. */
  private seen: Values

  constructor(
    readonly id: string,
    opened: Values,
    readonly rate = 0.05,
    private readonly random: () => number = Math.random,
    private readonly strings: Strings = englishStrings,
    /** A steady clock in milliseconds (`performance.now()` by default): the record's times are read from it. */
    private readonly clock: () => number = () => performance.now(),
  ) {
    this.draft = new Draft(opened)
    this.draft.openAt(this.clock())
    this.seen = { ...this.draft.opened }
  }

  /**
   * The form's values are `values` now: each field whose value is new since the last look arrived, and the person has
   * reached it. A value the form put in unasked arrives too — it is when the record came to hold it.
   */
  took(values: Values): void {
    const now = this.clock()
    for (const [field, value] of Object.entries(values)) {
      if (isEmpty(value) || sameValue(this.seen[field], value)) continue
      this.draft.arrived(field)
      this.draft.reach(field, now)
    }
    this.seen = { ...values }
  }

  /** The record is about to be saved by `by`, in `batch`: the draft says so, with the time. */
  beforeSave(by?: string, batch?: string): void {
    this.draft.saveAt(this.clock())
    if (by) this.draft.settledBy(by)
    if (batch) this.draft.inBatch(batch)
  }

  /**
   * Takes a round of proposals for the form's `values` now. A field offered a value from the person's writing keeps it
   * in view until the person picks it or turns it down.
   */
  apply(proposals: Proposal[], values: Values): Round {
    const round: Round = { fieldStates: Object.fromEntries(this.written), prefill: {} }
    for (const proposal of proposals) {
      if (proposal.suggestion && !this.written.has(proposal.field)) this.draw(proposal)
    }
    // A field held back for a check holds back the open fields of its group: the person settling it with nothing in view
    // is not shown what is suggested alongside it. Only the held field is the check.
    const held = proposals.filter((p) => this.draft.held(p.field) !== undefined)
    const hidden = (p: Proposal) => held.some((h) => h.field === p.field || (h.together != null && h.together === p.together))
    for (const proposal of proposals) {
      const { field, suggestion } = proposal
      if (this.written.has(field)) continue
      if (hidden(proposal)) continue
      if (!suggestion) {
        // Why the field is empty, said beside it: silent, it would read as a field nothing is suggested for, and a
        // person passes over it. A field that already holds a value needs no word.
        const judged = this.judgements.get(field)?.proposal === proposal
        // A field that asks for a judgement on nothing yet has not been looked at: there is nothing to say of it.
        const early = proposal.abstain === 'needs-judgement' && (proposal.asks?.length ?? 0) === 0
        const why =
          this.unfilled.get(field) ??
          (judged ? this.strings.judgedNothing : proposal.abstain && !early ? this.strings.abstain[proposal.abstain] : '')
        if (why && isEmpty(values[field])) round.fieldStates[field] = { note: why }
        continue
      }
      // Turned down, it stays down for this record: neither shown again nor put back in.
      if (this.draft.declined(field, suggestion)) continue
      this.draft.show(field, suggestion, proposal)
      // The form shows the answer and where it came from, never the precision promised for it: the record says so, for
      // the answers that carry one.
      if (proposal.promise !== undefined && (suggestion.origin ?? 'decider') === 'decider') {
        this.draft.showPromise(field, false, 0)
      }
      this.draft.reach(field, this.clock())
      if (this.prefills && proposal.prefill && isEmpty(values[field])) {
        round.prefill[field] = suggestion.value
        this.filled.add(field)
      }
      round.fieldStates[field] = {
        suggestions: [suggestion.value],
        decline: this.strings.decline,
        ...(this.note(proposal, values) ? { note: this.note(proposal, values) } : {}),
      }
    }
    return round
  }

  /**
   * The round's proposals with each field that asks for a judgement answered by the one already judged on the same
   * values, if there is one — so a judgement stays in view while the person writes on, and is not asked for again.
   */
  judged(proposals: Proposal[]): Proposal[] {
    return proposals.map((proposal) => {
      if (proposal.abstain !== 'needs-judgement') return proposal
      const known = this.judgements.get(proposal.field)
      return known?.reads === reads(proposal) && known.proposal ? known.proposal : proposal
    })
  }

  /**
   * The fields of the round that ask for a judgement not asked for yet on what they read; marked as being asked. A field
   * with nothing to read yet is left until there is something.
   */
  toJudge(proposals: Proposal[]): string[] {
    const asking = proposals.filter(
      (p) => p.abstain === 'needs-judgement' && (p.asks?.length ?? 0) > 0 && this.judgements.get(p.field)?.reads !== reads(p),
    )
    for (const p of asking) this.judgements.set(p.field, { reads: reads(p), proposal: null })
    return asking.map((p) => p.field)
  }

  /**
   * Takes what the host judged for the fields `asked` — each a proposal as the round would give it; a field it gave
   * nothing for stays as it was, and is not asked about again on the same values. A field asked for again since, on
   * other values, keeps waiting for that one.
   */
  takeJudged(asked: Proposal[], judged: Proposal[]): void {
    for (const before of asked) {
      const pending = this.judgements.get(before.field)
      if (pending?.reads !== reads(before)) continue
      const answer = judged.find((j) => j.field === before.field) ?? before
      this.judgements.set(before.field, { reads: pending.reads, proposal: answer })
    }
  }

  /** The host could not judge the fields `asked`: they may be asked about again. */
  notJudged(asked: Proposal[]): void {
    for (const before of asked) {
      if (this.judgements.get(before.field)?.reads === reads(before)) this.judgements.delete(before.field)
    }
  }

  /**
   * Takes what filling from the person's writing offers: each value shown as a suggestion from elsewhere, never put in
   * on its own, in place of what the records suggest for the field. Answers what every field shows now.
   */
  applyFill(proposals: Proposal[]): Record<string, FieldState> {
    for (const { field, suggestion, abstain } of proposals) {
      if (!suggestion) {
        // A value was given for the field that it cannot take: said beside the field, not dropped in silence.
        const why = abstain ? this.strings.abstain[abstain] : ''
        if (why) this.unfilled.set(field, why)
        continue
      }
      this.unfilled.delete(field)
      this.draft.show(field, suggestion)
      this.filled.delete(field)
      this.written.set(field, { suggestions: [suggestion.value], decline: this.strings.decline, note: this.strings.fromWriting })
    }
    const unfilled = [...this.unfilled].filter(([field]) => !this.written.has(field))
    return { ...Object.fromEntries(this.written), ...Object.fromEntries(unfilled.map(([field, note]) => [field, { note }])) }
  }

  /** The person picked a field's offered value: what was offered from their writing has done its part. */
  picked(field: string): void {
    this.written.delete(field)
  }

  /**
   * The person turned down the field's suggestion. Answers whether the form must empty the field: it holds the value
   * the form put in unasked — saved as it is, the turned-down value would count as taken.
   */
  decline(field: string, values: Values): boolean {
    const shown = this.draft.shown(field)
    if (!this.draft.decline(field)) return false
    const empty = this.filled.has(field) && values[field] === shown?.value
    this.filled.delete(field)
    this.written.delete(field)
    return empty
  }

  /** The record was saved holding `values`: what is written next starts from them. */
  saved(values: Values): void {
    this.draft = new Draft(values)
    this.draft.openAt(this.clock())
    this.seen = { ...this.draft.opened }
    this.drawn.clear()
    this.filled.clear()
    this.written.clear()
    this.judgements.clear()
  }

  /** Whether the field's answer is held back now — drawn the first time a checkable value is proposed for it. */
  private draw(proposal: Proposal): boolean {
    const { field, suggestion } = proposal
    if (!suggestion) return false
    if (this.drawn.has(field)) return this.draft.held(field) !== undefined
    const checkable =
      !proposal.several && (suggestion.origin ?? 'decider') === 'decider' && (suggestion.fit ?? 'exact') === 'exact'
    if (!checkable) return false
    this.drawn.add(field)
    if (this.rate > 0 && this.rate <= 1 && this.random() < this.rate) {
      this.draft.hold(field, this.rate, { ...proposal, suggestion })
      return true
    }
    return false
  }

  /** Where the suggestion comes from, in words. A field's value is shown as the record holds it now. */
  private note(proposal: Proposal, values: Values): string | undefined {
    const first = proposal.basis?.[0]
    if (proposal.layer === 'key' && first?.kind === 'value') {
      const now = values[first.field]
      const shown = now === undefined ? first.value : Array.isArray(now) ? now.join(', ') : now
      return this.strings.fromValue.replace('{field}', first.field).replace('{value}', shown)
    }
    if (proposal.layer === 'similar') return this.strings.fromSimilar
    if (proposal.layer === 'judgement') return this.strings.fromJudgement
    return undefined
  }
}

function sameValue(a: Values[string] | undefined, b: Values[string]): boolean {
  return JSON.stringify(a ?? '') === JSON.stringify(b)
}

/** What a proposal asking for a judgement reads, as one text. */
function reads(proposal: Proposal): string {
  return JSON.stringify(proposal.asks ?? [])
}
