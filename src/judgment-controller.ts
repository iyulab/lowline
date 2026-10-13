import type { ReactiveController, ReactiveControllerHost } from 'lit'
import type { FieldStates } from '@formdown/ui'
import { holdsValue, isEmpty, type FieldValues } from './documents.js'
import { charactersTyped, fillOrder, presentation, suggestionEvents, type Offer } from './events.js'
import type { Abstention, Suggestion, TemplateSnapshot } from './projection.js'
import { strings } from './strings.js'
import { host, vault } from './vault-client.js'
import { readVault, syncVault } from './vault-snapshot.js'

/** How long typing pauses before suggestions are asked for again. */
const SUGGEST_DELAY_MS = 300
/** The field types whose value a person types out, rather than picks, checks or enters as a number or date. */
const TYPED_TYPES = new Set(['text', 'textarea', 'email', 'tel', 'url', 'search'])

/** What the panel reads from the view that holds it: the open draft and its form's values. */
export interface JudgmentSource {
  /** The open draft's template reference, and its document id once it has one; undefined when nothing is open. */
  draft(): { templateRef?: string; id?: string } | undefined
  /** The form's current values, as it last reported them. */
  values(): FieldValues
  /** What a suggestion rests on, in words. */
  sourceOf(suggestion: Suggestion): string
  /** Whether the documents a judgment field could be compared with are at hand (an existing document in a template's list). */
  hasCases(): boolean
}

/**
 * The judgment fields of the open draft: what is suggested for them or why nothing is, what the person took,
 * rejected or is typing, and — once the document is saved — the events that record it. Suggestions are an aid:
 * without the sidecar the document is filled in by hand as before.
 */
export class JudgmentController implements ReactiveController {
  /** The open draft's template as the sidecar knows it; undefined when suggestions are unavailable. */
  template?: TemplateSnapshot
  /** Suggestions for the draft's empty judgment fields, by field name. */
  suggestions = new Map<string, Suggestion>()
  /** Judgment fields asked for a suggestion and given none, with why — or `unavailable` when asking failed. */
  abstained = new Map<string, Abstention | null | 'unavailable'>()
  /** The open draft's template has judgment fields, and the sidecar that suggests for them did not start. */
  unavailable = false
  /** Every suggestion shown since the draft was opened or last saved: what a save confirms or not. */
  offered = new Map<string, Offer>()
  /** For each judgment field, how many settled documents of the template hold a value in it. */
  private learned = new Map<string, number>()
  /** The draft's filled fields in the order they were filled (see `fillOrder`). */
  private filled: string[] = []
  /**
   * Judgment fields the person is typing a value into — typed by hand since the draft was opened or last saved, not
   * taken from a suggestion. Such a field stays open: it is asked about with what has been typed so far.
   */
  private typing = new Set<string>()
  /**
   * Fields whose suggestion was rejected in this draft and not offered again. Once the draft is
   * saved the rejection is an event, and the sidecar keeps it out of the document after reopening.
   */
  private rejected = new Set<string>()
  private suggestTimer?: ReturnType<typeof setTimeout>
  /** Counts requests for suggestions; only the latest one's answers are shown. */
  private suggestRun = 0

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly source: JudgmentSource,
  ) {
    host.addController(this)
  }

  hostDisconnected() {
    clearTimeout(this.suggestTimer)
  }

  /** Forgets the draft that was open: another one opens, or none. */
  reset() {
    clearTimeout(this.suggestTimer)
    this.template = undefined
    this.suggestions = new Map()
    this.abstained = new Map()
    this.unavailable = false
    this.offered = new Map()
    this.filled = []
    this.typing = new Set()
    this.rejected = new Set()
    this.host.requestUpdate()
  }

  /**
   * Hands the sidecar the vault as it is now — its saved documents are what suggestions learn
   * from — finds the draft's template, and asks for its judgment fields.
   */
  async prepare(templateRef: string | undefined) {
    if (!templateRef) return
    try {
      const synced = await syncVault()
      const template = synced.templates.find((t) => t.ref === templateRef)
      if (this.source.draft()?.templateRef !== templateRef) return // another draft opened meanwhile
      this.template = template?.suggest.length ? template : undefined
      const settled = synced.documents.filter((d) => d.template === templateRef && !d.conflicted)
      this.learned = new Map(template?.suggest.map((f) => [f, settled.filter((d) => holdsValue(d.values[f])).length]))
      this.unavailable = false
      this.host.requestUpdate()
      await this.suggest()
    } catch {
      this.template = undefined
      // Saying nothing would read as "no suggestion to make": say they failed, if the template has fields to suggest for.
      try {
        const read = await readVault()
        if (this.source.draft()?.templateRef !== templateRef) return
        this.unavailable = !!read.templates.find((t) => t.ref === templateRef)?.suggest.length
      } catch {
        // the vault itself could not be read: nothing more to say about suggestions
      }
      this.host.requestUpdate()
    }
  }

  /** The form's values changed: notes the order fields were filled in. */
  track(values: FieldValues) {
    this.filled = fillOrder(this.filled, values)
  }

  /**
   * The person changed the form, from `before` to `values`: a judgment field typed into is being typed (asked
   * about with what it holds), one emptied or picked is not; suggestions are asked for again once typing pauses.
   */
  edited(before: FieldValues, values: FieldValues) {
    for (const field of this.template?.suggest ?? []) {
      if (values[field] === before[field]) continue
      if (isEmpty(values[field]) || !this.typeable(field)) this.typing.delete(field)
      else this.typing.add(field)
    }
    this.track(values)
    clearTimeout(this.suggestTimer)
    if (this.template) this.suggestTimer = setTimeout(() => void this.suggest(), SUGGEST_DELAY_MS)
  }

  /** The suggested value for `field` is taken: it is a value like any other until the document is saved. */
  take(field: string) {
    this.decided(field)
    this.typing.delete(field)
    this.dismiss(field)
  }

  /** The suggestion for `field` is set aside. The rejection is recorded if the field is still empty when saved. */
  reject(field: string) {
    this.decided(field)
    this.rejected.add(field)
    this.dismiss(field)
  }

  /** Records what saving document `id` confirmed about the suggestions offered; what was typed is no longer being typed. */
  async saved(id: string | undefined) {
    if (id !== undefined) {
      const events = suggestionEvents(this.offered, this.rejected, this.source.values(), id, new Date(), this.template?.ref)
      // Each event is recorded once; a rejection stays in force while the draft is open. A suggestion
      // the save said nothing about is still the one showing, not a new presentation.
      for (const event of events) this.offered.delete(event.field)
      for (const event of events) await vault.recordEvent(event)
    }
    this.typing = new Set()
  }

  /** What the form draws by each judgment field: the suggested value to take or decline, or why there is none. */
  fieldStates(): FieldStates {
    const states: FieldStates = {}
    for (const [field, s] of this.suggestions) {
      states[field] = { suggestions: [s.value!], note: this.source.sourceOf(s), decline: strings.reject }
    }
    for (const [field, reason] of this.abstained) {
      states[field] = {
        note:
          reason === 'unavailable'
            ? strings.judgmentUnavailable
            : strings.judgmentAbstained(reason, this.learned.get(field) ?? 0, this.source.hasCases()),
      }
    }
    return states
  }

  /** A field's label as its template gives it, or its name. */
  label(field: string): string {
    return this.template?.fields.find((f) => f.name === field)?.label ?? field
  }

  /** Asks for a value for each empty judgment field, given what the other fields hold. */
  private async suggest() {
    const template = this.template
    if (!template) return
    const run = ++this.suggestRun
    const values = { ...this.source.values() }
    const next = new Map<string, Suggestion>()
    const abstained = new Map<string, Abstention | null | 'unavailable'>()
    const typedWhenAsked = new Map<string, number>()
    for (const field of template.suggest) {
      // A field being typed into is asked with what has been typed, as an open field; one holding a value otherwise
      // is settled, and not asked about.
      const typed = this.typing.has(field) && typeof values[field] === 'string' ? (values[field] as string) : undefined
      if (!isEmpty(values[field]) && typed === undefined) continue
      try {
        const document = this.source.draft()?.id
        const { [field]: _, ...others } = values
        const suggestion = await host.suggest(template.ref, field, typed === undefined ? values : others, document, typed)
        // Declined here, now or before it was last saved: not offered again, and nothing to explain.
        if (this.rejected.has(field) || suggestion.mode === 'rejected') continue
        // While typing, only a value that adds to the text is worth showing, and no reason is given for there being none.
        if (typed !== undefined) {
          if (suggestion.value !== null && suggestion.value !== typed) next.set(field, suggestion)
        } else if (suggestion.value !== null) next.set(field, suggestion)
        else abstained.set(field, suggestion.reason ?? null)
        typedWhenAsked.set(field, charactersTyped(typed))
      } catch {
        abstained.set(field, 'unavailable')
      }
    }
    // Values may have changed (or another draft opened) while these were asked for.
    if (run !== this.suggestRun || this.template !== template) return
    this.suggestions = next
    this.abstained = abstained
    this.host.requestUpdate()
    const filled = fillOrder(this.filled, values)
    for (const [field, suggestion] of next) {
      // Asked again after each pause in typing: the same value still showing is the same presentation.
      if (this.offered.get(field)?.suggestion.value === suggestion.value) continue
      const offer: Offer = { suggestion, shown: new Date(), filled, typed: typedWhenAsked.get(field) ?? 0 }
      this.offered.set(field, offer)
      void vault.recordPresentation(presentation(template.ref, field, offer)).catch(() => {})
    }
  }

  /** Notes when a suggestion was taken or rejected, and what was in its field then — before taking it changes that. */
  private decided(field: string) {
    const offer = this.offered.get(field)
    if (!offer) return
    const value = this.source.values()[field]
    offer.decided = new Date()
    offer.decidedTyped = charactersTyped(typeof value === 'string' ? value : undefined)
  }

  private dismiss(field: string) {
    const rest = new Map(this.suggestions)
    rest.delete(field)
    this.suggestions = rest
    this.host.requestUpdate()
  }

  /** Whether a person types a field's value out — one value of a text kind, with no choices to pick from. */
  private typeable(field: string): boolean {
    const f = this.template?.fields.find((f) => f.name === field)
    return !!f && !f.multiple && f.options.length === 0 && TYPED_TYPES.has(f.type)
  }
}
