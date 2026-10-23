import { LitElement, html } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import '@formdown/ui'
import { LowlineClient, LowlineError } from './client.js'
import { valuesOf, type Values } from './draft.js'
import { Session, englishStrings, type FieldState, type Proposal, type Strings } from './session.js'

/** How long typing pauses before the decided fields are asked about again. */
const ASK_DELAY_MS = 300

interface FormdownUi extends HTMLElement {
  content: string
  data: Record<string, unknown>
  fieldStates: Record<string, FieldState>
  updateData(data: Record<string, unknown>): void
}

/**
 * A formdown form whose decided fields are suggested from the records people confirmed. It asks the host's routes
 * (`src` — where `MapLowline` put them) what to show for form `form` while record `record` is written, draws each
 * suggestion in its field, keeps the account of what the person took or turned down, and sends it with the save.
 *
 * ```html
 * <lowline-form src="/lowline" form="intake" record="r-17"></lowline-form>
 * ```
 *
 * Set `content` to the form's formdown text and, for a record opened again, `data` to its values. `save()` saves it;
 * `lowline-saved` follows with `{ id, settledAt, values }`.
 */
@customElement('lowline-form')
export class LowlineForm extends LitElement {
  /** Where the host's routes are. */
  @property() src = '/lowline'

  /** The form, by the name the host defined it under. */
  @property() form = ''

  /** The record being written; opening a record again under its id keeps it from being evidence for itself. */
  @property() record = ''

  /** The form's formdown text. */
  @property() content = ''

  /** The record's values when it was opened. */
  @property({ attribute: false }) data: Record<string, unknown> = {}

  /** How often a field's answer is held back to check it, from 0 to 1. */
  @property({ type: Number }) rate = 0.05

  /** The words the form shows, in the host's language. */
  @property({ attribute: false }) strings: Strings = englishStrings

  @query('formdown-ui') private formdown?: FormdownUi

  private session?: Session
  private asking?: ReturnType<typeof setTimeout>
  private client = new LowlineClient(this.src)
  private fieldStates: Record<string, FieldState> = {}
  /** Whether the host judges what the records could not answer — until its `judge` route says it has no model. */
  private canJudge = true

  protected override createRenderRoot() {
    return this
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('src')) {
      this.client = new LowlineClient(this.src)
      this.canJudge = true
    }
    if (changed.has('record') || changed.has('form') || changed.has('data') || changed.has('content')) {
      // The values it was opened with are taken before anything is suggested or put in.
      this.session = new Session(this.record, valuesOf(this.data), this.rate, Math.random, this.strings)
      this.fieldStates = {}
    }
  }

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('record') || changed.has('form') || changed.has('content')) void this.ask()
  }

  override render() {
    return html`<formdown-ui
      .content=${this.content}
      .data=${this.data}
      .fieldStates=${this.fieldStates}
      @formdown-change=${this.changed}
      @formdown-suggestion-pick=${this.picked}
      @formdown-suggestion-decline=${this.declined}
    ></formdown-ui>`
  }

  /** The values the form holds now. */
  values(): Values {
    return valuesOf(this.formdown?.data ?? this.data)
  }

  /** Saves the record as it stands, with the account of what was shown and done; what is written next starts here. */
  save(): Promise<{ id: string; settledAt: string }> {
    return this.settleWith(true)
  }

  /**
   * For a host that stores the record through its own API first: sends only the account of what was shown and done,
   * and the host's engine learns the record as the host stored it (`Saved` in .NET). What is written next starts here.
   */
  settle(): Promise<{ id: string; settledAt: string }> {
    return this.settleWith(false)
  }

  private async settleWith(sendValues: boolean): Promise<{ id: string; settledAt: string }> {
    if (!this.session || !this.form || !this.record) throw new Error('lowline-form needs a form and a record to save')
    const values = this.values()
    const saved = await this.client.settle(this.form, this.record, this.session.draft, sendValues ? values : undefined)
    this.session.saved(values)
    this.dispatchEvent(new CustomEvent('lowline-saved', { detail: { ...saved, values }, bubbles: true, composed: true }))
    return saved
  }

  /**
   * Fills the record from `text` — what the person wrote or a picture's description — through the host's model: each
   * value it gives is offered in its field for the person to take. Nothing is put in on its own.
   */
  async fill(text: string): Promise<void> {
    const session = this.session
    if (!session || !this.form) return
    const proposals = await this.client.fill(this.form, this.values(), text)
    if (session !== this.session) return
    this.fieldStates = session.applyFill(proposals)
    if (this.formdown) this.formdown.fieldStates = this.fieldStates
  }

  /** Asks again what to show for the decided fields still open. */
  async ask(): Promise<void> {
    const session = this.session
    if (!session || !this.form || !this.record) return
    const values = this.values()
    let proposals
    try {
      proposals = await this.client.propose(this.form, this.record, values)
    } catch (error) {
      // Suggestions are an aid: without them the form is filled in by hand.
      this.dispatchEvent(new CustomEvent('lowline-unavailable', { detail: { error }, bubbles: true, composed: true }))
      return
    }
    if (session !== this.session) return
    const shown = session.judged(proposals)
    const round = session.apply(shown, values)
    this.fieldStates = round.fieldStates
    const formdown = this.formdown
    if (!formdown) return
    if (Object.keys(round.prefill).length > 0) formdown.updateData({ ...formdown.data, ...round.prefill })
    formdown.fieldStates = this.fieldStates
    if (this.canJudge) void this.judge(session, values, shown)
  }

  /**
   * Asks the host to judge the fields of a round the records could not answer — apart from the round, since a model
   * takes longer — and asks again once it has, so the judgements are shown in their fields.
   */
  private async judge(session: Session, values: Values, round: Proposal[]): Promise<void> {
    const fields = session.toJudge(round)
    if (fields.length === 0) return
    const asked = round.filter((p) => fields.includes(p.field))
    let judged: Proposal[]
    try {
      judged = await this.client.judge(this.form, this.record, values)
    } catch (error) {
      if (error instanceof LowlineError && error.status === 404) this.canJudge = false
      session.notJudged(asked)
      return
    }
    if (session !== this.session) return
    session.takeJudged(asked, judged)
    void this.ask()
  }

  private changed = () => {
    clearTimeout(this.asking)
    this.asking = setTimeout(() => void this.ask(), ASK_DELAY_MS)
  }

  private picked = (event: Event) => {
    const { field, value } = (event as CustomEvent<{ field: string; value: string }>).detail
    this.session?.picked(field)
    const formdown = this.formdown
    if (formdown) formdown.updateData({ ...formdown.data, [field]: value })
  }

  private declined = (event: Event) => {
    const { field } = (event as CustomEvent<{ field: string }>).detail
    const formdown = this.formdown
    if (this.session?.decline(field, this.values()) && formdown) formdown.updateData({ ...formdown.data, [field]: '' })
    const { [field]: _, ...rest } = this.fieldStates
    this.fieldStates = rest
    if (formdown) formdown.fieldStates = rest
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback()
    clearTimeout(this.asking)
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lowline-form': LowlineForm
  }
}
