import { Draft, isEmpty, type Suggestion, type Values } from './draft.js'

/** What a suggestion rests on: another field's value it was settled under, or a settled record like this one. */
export type Basis = { kind: 'value'; field: string; value: string } | { kind: 'record'; id: string; similarity: number }

/** Why a decided field is shown no suggestion. */
export type Abstain = 'off' | 'no-evidence' | 'unsure' | 'not-allowed' | 'needs-judgement'

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
}

export const englishStrings: Strings = {
  decline: 'Not this',
  fromValue: 'As before with {field} {value}',
  fromSimilar: 'As in a similar record',
  fromJudgement: 'Suggested from what was written',
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

  constructor(
    readonly id: string,
    opened: Values,
    readonly rate = 0.05,
    private readonly random: () => number = Math.random,
    private readonly strings: Strings = englishStrings,
  ) {
    this.draft = new Draft(opened)
  }

  /** Takes a round of proposals for the form's `values` now. */
  apply(proposals: Proposal[], values: Values): Round {
    const round: Round = { fieldStates: {}, prefill: {} }
    for (const proposal of proposals) {
      const { field, suggestion } = proposal
      if (!suggestion) continue
      if (this.draw(field, suggestion)) continue
      if (this.draft.held(field) !== undefined) continue
      this.draft.show(field, suggestion)
      if (proposal.prefill && isEmpty(values[field])) round.prefill[field] = suggestion.value
      round.fieldStates[field] = {
        suggestions: [suggestion.value],
        decline: this.strings.decline,
        ...(this.note(proposal, values) ? { note: this.note(proposal, values) } : {}),
      }
    }
    return round
  }

  /** The person turned down the field's suggestion. */
  decline(field: string): boolean {
    return this.draft.decline(field)
  }

  /** The record was saved holding `values`: what is written next starts from them. */
  saved(values: Values): void {
    this.draft = new Draft(values)
    this.drawn.clear()
  }

  /** Whether the field's answer is held back now — drawn the first time a checkable value is proposed for it. */
  private draw(field: string, suggestion: Suggestion): boolean {
    if (this.drawn.has(field)) return this.draft.held(field) !== undefined
    const checkable = (suggestion.origin ?? 'decider') === 'decider' && (suggestion.fit ?? 'exact') === 'exact'
    if (!checkable) return false
    this.drawn.add(field)
    if (this.rate > 0 && this.rate <= 1 && this.random() < this.rate) {
      this.draft.hold(field, this.rate)
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
