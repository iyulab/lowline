import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { guard } from 'lit/directives/guard.js'
import { keyed } from 'lit/directives/keyed.js'
import {
  documentFileName,
  documentTitle,
  documentTemplateRef,
  documentValues,
  fieldValues,
  newDocument,
  templateBody,
  templateInfo,
  updateDocument,
  type FieldValues,
} from './documents.js'
import { describeError } from './errors.js'
import { suggestionEvents } from './events.js'
import type { Suggestion, TemplateSnapshot } from './projection.js'
import { strings } from './strings.js'
import { host, vault, type VaultEntry, type VaultInfo } from './vault-client.js'
import { syncVault } from './vault-snapshot.js'

/** How long typing pauses before suggestions are asked for again. */
const SUGGEST_DELAY_MS = 300

/** What is open in the editor: a new document from a template, or an existing document. */
type Draft =
  | { kind: 'new'; templateSource: string; templateRef: string }
  | { kind: 'existing'; path: string; source: string; templateRef?: string }

/** Documents: fill in a template to create one, or open one and change its values. */
@customElement('ll-documents')
export class LlDocuments extends LitElement {
  static styles = css`
    :host {
      display: grid;
      grid-template-columns: 16rem 1fr;
      gap: var(--dc-space-4, 16px);
      height: 100%;
      min-height: 0;
    }
    nav {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-1, 4px);
      overflow: auto;
    }
    nav button {
      text-align: left;
      padding: var(--dc-space-2, 8px);
      border: 1px solid transparent;
      border-radius: var(--dc-radius-md, 6px);
      background: none;
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    nav button[aria-current='true'] {
      border-color: var(--dc-color-border, #d0d0d0);
      background: var(--dc-color-bg-subtle, #f4f4f4);
    }
    .new {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-1, 4px);
      margin-bottom: var(--dc-space-2, 8px);
    }
    select {
      font: inherit;
      padding: var(--dc-space-1, 4px);
    }
    section {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-2, 8px);
      min-height: 0;
      overflow: auto;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: var(--dc-space-2, 8px);
    }
    .message {
      color: var(--dc-color-text-muted, #666);
    }
    .suggestions {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-1, 4px);
    }
    .suggestion {
      display: flex;
      align-items: center;
      gap: var(--dc-space-2, 8px);
      padding: var(--dc-space-2, 8px);
      border: 1px dashed var(--dc-color-border, #d0d0d0);
      border-radius: var(--dc-radius-md, 6px);
    }
    .suggestion .source {
      color: var(--dc-color-text-muted, #666);
      font-size: 12px;
    }
    .error {
      color: var(--dc-color-danger, #b00020);
    }
  `

  @property({ attribute: false }) vaultInfo!: VaultInfo

  @state() private documents: VaultEntry[] = []
  @state() private templates: VaultEntry[] = []
  @state() private draft?: Draft
  /**
   * Values handed to the form when a draft opens; the form owns them after that. Lit
   * re-sets object values on every render, so the binding is guarded by `opened` —
   * otherwise each re-render (and each save) would hand the form its opening values again.
   */
  @state() private initialValues: FieldValues = {}
  /** Counts drafts opened; changes only when another draft is opened. */
  @state() private opened = 0
  /** The form's current values, as it reports them. */
  private values: FieldValues = {}
  /** The open draft's template as the sidecar knows it; undefined when suggestions are unavailable. */
  private template?: TemplateSnapshot
  /** Suggestions for the draft's empty judgment fields, by field name. */
  @state() private suggestions = new Map<string, Suggestion>()
  /** Every suggestion shown since the draft was opened or last saved: what a save confirms or not. */
  private offered = new Map<string, Suggestion>()
  /**
   * Fields whose suggestion was rejected in this draft and not offered again. Once the draft is
   * saved the rejection is an event, and the sidecar keeps it out of the document after reopening.
   */
  private rejected = new Set<string>()
  /** Template names (their file names) by `id@version`. */
  @state() private templateNames = new Map<string, string>()
  /** Counts accepted suggestions, so the form is handed its values again. */
  @state() private applied = 0
  private suggestTimer?: ReturnType<typeof setTimeout>
  /** Counts requests for suggestions; only the latest one's answers are shown. */
  private suggestRun = 0
  @state() private dirty = false
  @state() private message = ''
  @state() private error = ''

  connectedCallback() {
    super.connectedCallback()
    void this.refresh()
  }

  private async refresh() {
    try {
      ;[this.documents, this.templates] = await Promise.all([vault.listDocuments(), vault.listTemplates()])
      const names = new Map<string, string>()
      for (const t of this.templates) {
        try {
          names.set(templateInfo(await vault.read(t.path)).ref, t.name.replace(/\.fd\.md$/, ''))
        } catch {
          // a template without an identity has no documents
        }
      }
      this.templateNames = names
    } catch (e) {
      this.error = describeError(e)
    }
  }

  private reset() {
    this.error = ''
    this.message = ''
    this.dirty = false
    this.template = undefined
    this.suggestions = new Map()
    this.offered = new Map()
    this.rejected = new Set()
  }

  /**
   * Hands the sidecar the vault as it is now — its saved documents are what suggestions learn
   * from — and finds the draft's template. Suggestions are an aid: without the sidecar the
   * document is filled in by hand as before.
   */
  private async prepareSuggestions(templateRef: string | undefined) {
    if (!templateRef) return
    try {
      const synced = await syncVault()
      const template = synced.templates.find((t) => t.ref === templateRef)
      if (this.draft?.templateRef !== templateRef) return // another draft opened meanwhile
      this.template = template?.suggest.length ? template : undefined
      await this.suggest()
    } catch {
      this.template = undefined
    }
  }

  /** Asks for a value for each empty judgment field, given what the other fields hold. */
  private async suggest() {
    const template = this.template
    if (!template) return
    const run = ++this.suggestRun
    const values = { ...this.values }
    const next = new Map<string, Suggestion>()
    for (const field of template.suggest) {
      if (!isEmpty(values[field])) continue
      try {
        const document = this.draft?.kind === 'existing' ? this.draft.path : undefined
        const suggestion = await host.suggest(template.ref, field, values, document)
        if (suggestion.value !== null && !this.rejected.has(field)) next.set(field, suggestion)
      } catch {
        // no suggestion for this field
      }
    }
    // Values may have changed (or another draft opened) while these were asked for.
    if (run !== this.suggestRun || this.template !== template) return
    this.suggestions = next
    for (const [field, suggestion] of next) this.offered.set(field, suggestion)
  }

  private scheduleSuggest() {
    clearTimeout(this.suggestTimer)
    if (this.template) this.suggestTimer = setTimeout(() => void this.suggest(), SUGGEST_DELAY_MS)
  }

  /** Puts a suggested value into the form. It is a value like any other until the document is saved. */
  private accept(field: string, value: string) {
    this.values = { ...this.values, [field]: value }
    this.initialValues = this.values
    this.applied++
    this.dirty = true
    this.message = ''
    this.dismiss(field)
  }

  /** Sets a suggestion aside. The rejection is recorded if the field is still empty when saved. */
  private reject(field: string) {
    this.rejected.add(field)
    this.dismiss(field)
  }

  private dismiss(field: string) {
    const rest = new Map(this.suggestions)
    rest.delete(field)
    this.suggestions = rest
  }

  /** Records what the save confirmed about the suggestions offered for this draft. */
  private async recordSuggestionEvents(path: string) {
    const events = suggestionEvents(this.offered, this.rejected, this.values, path, new Date())
    // Each event is recorded once; a rejection stays in force while the draft is open.
    this.offered = new Map()
    for (const event of events) await vault.recordEvent(event)
  }

  private async startNew(templatePath: string) {
    this.reset()
    try {
      const templateSource = await vault.read(templatePath)
      const { ref } = templateInfo(templateSource)
      this.values = this.initialValues = {}
      this.draft = { kind: 'new', templateSource, templateRef: ref }
      this.opened++
      void this.prepareSuggestions(ref)
    } catch (e) {
      this.error = describeError(e)
    }
  }

  private async open(path: string) {
    this.reset()
    try {
      const source = await vault.read(path)
      this.values = this.initialValues = fieldValues(documentValues(source))
      this.draft = { kind: 'existing', path, source, templateRef: documentTemplateRef(source) }
      this.opened++
      void this.prepareSuggestions(this.draft.templateRef)
    } catch (e) {
      this.error = describeError(e)
    }
  }

  private async save() {
    const draft = this.draft
    if (!draft) return
    this.error = ''
    try {
      if (draft.kind === 'existing') {
        const source = updateDocument(draft.source, this.values)
        await vault.write(draft.path, source)
        this.draft = { ...draft, source }
      } else {
        const source = newDocument(draft.templateSource, this.values)
        const path = await this.createDocument(source, documentTitle(draft.templateSource, this.values))
        this.draft = { kind: 'existing', path, source, templateRef: draft.templateRef }
        await this.refresh()
      }
      if (this.draft?.kind === 'existing') await this.recordSuggestionEvents(this.draft.path)
      this.dirty = false
      this.message = strings.saved
      this.dispatchEvent(new CustomEvent('ll-confirmed', { bubbles: true, composed: true }))
      // What was just saved is confirmed: the next suggestions learn from it.
      void this.prepareSuggestions(this.draft?.templateRef)
    } catch (e) {
      this.error = describeError(e)
    }
  }

  /** Creates the document under a free name; never replaces an existing file. */
  private async createDocument(source: string, title: string | undefined): Promise<string> {
    const now = new Date()
    for (let attempt = 1; ; attempt++) {
      const path = `${this.vaultInfo.documentsDir}/${documentFileName(now, title, attempt)}`
      try {
        await vault.create(path, source)
        return path
      } catch (e) {
        if ((e as { kind?: string }).kind !== 'already-exists' || attempt >= 99) throw e
      }
    }
  }

  private onData(e: CustomEvent<{ formData: Record<string, unknown> }>) {
    this.values = fieldValues(e.detail.formData)
    this.dirty = true
    this.message = ''
    this.scheduleSuggest()
  }

  private renderSuggestions() {
    if (this.suggestions.size === 0) return nothing
    const label = (name: string) => this.template?.fields.find((f) => f.name === name)?.label ?? name
    return html`<div class="suggestions">
      ${[...this.suggestions].map(
        ([field, s]) => html`<div class="suggestion" role="note" data-field=${field}>
          <span>${strings.suggestionFor(label(field))}: <strong>${s.value}</strong></span>
          ${s.source
            ? html`<span class="source">${strings.suggestionSource(s.source.replace(/^.*\//, '').replace(/\.md$/, ''))}</span>`
            : nothing}
          <dc-button size="sm" variant="secondary" @click=${() => this.accept(field, s.value!)}>${strings.accept}</dc-button>
          <dc-button size="sm" variant="ghost" @click=${() => this.reject(field)}>${strings.reject}</dc-button>
        </div>`,
      )}
    </div>`
  }

  render() {
    const draft = this.draft
    return html`
      <nav aria-label=${strings.navDocuments}>
        <div class="new">
          <label for="template">${strings.newDocument}</label>
          <select
            id="template"
            @change=${(e: Event) => {
              const select = e.target as HTMLSelectElement
              if (select.value) void this.startNew(select.value)
              select.value = ''
            }}
          >
            <option value="">${strings.pickTemplate}</option>
            ${this.templates.map((t) => html`<option value=${t.path}>${t.name.replace(/\.fd\.md$/, '')}</option>`)}
          </select>
        </div>
        ${this.documents.length === 0
          ? html`<p class="message">${strings.noDocuments}</p>`
          : this.documents.map(
              (d) => html`<button
                aria-current=${draft?.kind === 'existing' && draft.path === d.path}
                @click=${() => this.open(d.path)}
              >
                ${d.name.replace(/\.md$/, '')}
              </button>`,
            )}
      </nav>
      <section>
        ${draft
          ? html`
              <div class="bar">
                <dc-button size="sm" ?disabled=${!this.dirty} @click=${this.save}>${strings.save}</dc-button>
                ${draft.templateRef
                  ? html`<span class="message">${strings.documentFrom(this.templateNames.get(draft.templateRef) ?? draft.templateRef)}</span>`
                  : nothing}
                ${this.error
                  ? html`<span class="error" role="alert">${this.error}</span>`
                  : html`<span class="message" role="status">${this.message}</span>`}
              </div>
              ${this.renderSuggestions()}
              ${keyed(
                this.opened,
                html`<formdown-ui
                .content=${draft.kind === 'new' ? templateBody(draft.templateSource) : draft.source}
                .data=${guard([this.opened, this.applied], () => this.initialValues)}
                .showSubmitButton=${false}
                @formdown-data-update=${this.onData}
              ></formdown-ui>`,
              )}
            `
          : this.error
            ? html`<p class="error" role="alert">${this.error}</p>`
            : nothing}
      </section>
    `
  }
}

function isEmpty(value: FieldValues[string] | undefined): boolean {
  return value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

declare global {
  interface HTMLElementTagNameMap {
    'll-documents': LlDocuments
  }
}
