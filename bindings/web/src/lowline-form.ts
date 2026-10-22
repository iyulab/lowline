import { LitElement, html } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import '@formdown/ui'
import { LowlineClient } from './client.js'
import { valuesOf, type Values } from './draft.js'
import { Session, englishStrings, type FieldState, type Strings } from './session.js'

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

  protected override createRenderRoot() {
    return this
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('src')) this.client = new LowlineClient(this.src)
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
  async save(): Promise<{ id: string; settledAt: string }> {
    if (!this.session || !this.form || !this.record) throw new Error('lowline-form needs a form and a record to save')
    const values = this.values()
    const saved = await this.client.settle(this.form, this.record, values, this.session.draft)
    this.session.saved(values)
    this.dispatchEvent(new CustomEvent('lowline-saved', { detail: { ...saved, values }, bubbles: true, composed: true }))
    return saved
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
    const round = session.apply(proposals, values)
    this.fieldStates = round.fieldStates
    const formdown = this.formdown
    if (!formdown) return
    if (Object.keys(round.prefill).length > 0) formdown.updateData({ ...formdown.data, ...round.prefill })
    formdown.fieldStates = this.fieldStates
  }

  private changed = () => {
    clearTimeout(this.asking)
    this.asking = setTimeout(() => void this.ask(), ASK_DELAY_MS)
  }

  private picked = (event: Event) => {
    const { field, value } = (event as CustomEvent<{ field: string; value: string }>).detail
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
