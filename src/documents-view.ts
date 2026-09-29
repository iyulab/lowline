import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { guard } from 'lit/directives/guard.js'
import { keyed } from 'lit/directives/keyed.js'
import {
  documentTitle,
  documentFrontMatter,
  fieldValues,
  newDocument,
  templateBody,
  templateInfo,
  updateDocument,
  type FieldValues,
} from './documents.js'
import { describeError } from './errors.js'
import { fillOrder, presentation, suggestionEvents, type Offer } from './events.js'
import type { Suggestion, TemplateSnapshot } from './projection.js'
import { strings } from './strings.js'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { host, onVaultChanged, removedBy, touches, vault, type VaultChanged, type VaultEntry, type VaultInfo } from './vault-client.js'
import { readVault, syncVault } from './vault-snapshot.js'
import { documentsOf, type TemplateItem } from './template-scope.js'
import { createDocumentFile } from './document-files.js'
import { conflictLabel, conflictNotice, noteFor, noticeFor } from './conflicts.js'
import { confirmDiscard, markUnsaved } from './unsaved.js'
import './import-view.js'

/** How long typing pauses before suggestions are asked for again. */
const SUGGEST_DELAY_MS = 300

/** What is open in the editor: a new document from a template, or an existing document. */
type Draft =
  | { kind: 'new'; templateSource: string; templateRef: string }
  | { kind: 'existing'; path: string; source: string; templateRef?: string }

/**
 * A template's documents: fill in the template to create one, or open one and change its values.
 * Without a template (`null`), the documents that name none the vault has — to open and keep.
 */
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
    nav button .note {
      display: block;
      font-size: 0.85em;
      color: var(--dc-color-text-muted, #666);
    }
    .new {
      display: flex;
      gap: var(--dc-space-1, 4px);
      margin-bottom: var(--dc-space-2, 8px);
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
    .suggestion > * {
      flex-shrink: 0;
    }
    /* The source gives way — one line, cut short, whole in its tooltip — so the buttons never wrap. */
    .suggestion .source {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      color: var(--dc-color-text-muted, #666);
      font-size: 12px;
    }
    .error {
      color: var(--dc-color-danger, #b00020);
    }
  `

  @property({ attribute: false }) vaultInfo!: VaultInfo
  /** Whose documents: a template, or `null` for those naming none the vault has. */
  @property({ attribute: false }) scope: TemplateItem | null = null
  /** A document to open as soon as the view shows. */
  @property({ attribute: false }) openPath?: string

  /** This template's documents, their conflict copies included. */
  @state() private documents: VaultEntry[] = []
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
  /** Judgment fields asked for a suggestion and given none: nothing confirmed was close enough. */
  @state() private abstained = new Set<string>()
  /** For each judgment field, how many settled documents of the template hold a value in it. */
  private learned = new Map<string, number>()
  /** Suggestions for the draft's empty judgment fields, by field name. */
  @state() private suggestions = new Map<string, Suggestion>()
  /** Every suggestion shown since the draft was opened or last saved: what a save confirms or not. */
  private offered = new Map<string, Offer>()
  /** The draft's filled fields in the order they were filled (see `fillOrder`). */
  private filled: string[] = []
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
  /** The import panel is showing instead of a document. */
  @state() private importing = false
  /** The open document changed outside while it had unsaved edits: the person chooses which to keep. */
  @state() private changedOutside = false
  @state() private message = ''
  @state() private error = ''

  private unlisten?: Promise<UnlistenFn>

  connectedCallback() {
    super.connectedCallback()
    void this.refresh()
    if (this.openPath) void this.open(this.openPath)
    this.unlisten = onVaultChanged((change) => void this.outsideChange(change))
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    void this.unlisten?.then((stop) => stop())
    markUnsaved('documents', false)
  }

  willUpdate(changed: Map<string, unknown>) {
    // Another template: the app asked before letting unsaved edits go.
    const before = changed.get('scope') as TemplateItem | null | undefined
    if (changed.has('scope') && before !== undefined && before?.ref !== this.scope?.ref) {
      this.reset()
      this.draft = undefined
      void this.refresh()
    }
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('dirty')) markUnsaved('documents', this.dirty)
  }

  /**
   * Shows what another program did to the vault. The open document is read again only when it
   * has no unsaved edits; otherwise the person is told, and saving decides. Suggestions learn from
   * the vault as it is now.
   */
  private async outsideChange(change: VaultChanged) {
    await this.refresh()
    const draft = this.draft
    if (draft?.kind === 'existing' && touches(change, draft.path)) {
      if (removedBy(change, draft.path, this.documents.map((d) => d.path))) {
        // What is on screen is now held nowhere else: it is unsaved, whatever was typed.
        this.dirty = true
        this.error = strings.removedOutside
        this.message = '' // an earlier "saved" no longer holds
      } else if (this.dirty) {
        this.error = strings.changedOutsideDirty
        this.message = ''
        this.changedOutside = true
      } else {
        await this.open(draft.path)
        if (!change.rescan) this.message = strings.reloadedOutside
        return // opening prepares the suggestions again
      }
    }
    if (this.template) void this.prepareSuggestions(draft?.templateRef)
  }

  private async refresh() {
    try {
      const read = await readVault()
      const templateOf = new Map(read.documents.map((d) => [d.path, d.template]))
      this.documents = documentsOf(read.documentEntries, templateOf, this.scope?.ref ?? null, new Set(read.names.keys()))
      this.templateNames = read.names
    } catch (e) {
      this.error = describeError(e)
    }
  }

  private reset() {
    this.error = ''
    this.importing = false
    this.changedOutside = false
    this.message = ''
    this.dirty = false
    this.template = undefined
    this.suggestions = new Map()
    this.abstained = new Set()
    this.offered = new Map()
    this.filled = []
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
      const settled = synced.documents.filter((d) => d.template === templateRef && !d.conflicted)
      this.learned = new Map(template?.suggest.map((f) => [f, settled.filter((d) => holdsValue(d.values[f])).length]))
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
    const abstained = new Set<string>()
    for (const field of template.suggest) {
      if (!isEmpty(values[field])) continue
      try {
        const document = this.draft?.kind === 'existing' ? this.draft.path : undefined
        const suggestion = await host.suggest(template.ref, field, values, document)
        if (this.rejected.has(field)) continue
        if (suggestion.value !== null) next.set(field, suggestion)
        else abstained.add(field)
      } catch {
        // no suggestion for this field
      }
    }
    // Values may have changed (or another draft opened) while these were asked for.
    if (run !== this.suggestRun || this.template !== template) return
    this.suggestions = next
    this.abstained = abstained
    const filled = fillOrder(this.filled, values)
    for (const [field, suggestion] of next) {
      // Asked again after each pause in typing: the same value still showing is the same presentation.
      if (this.offered.get(field)?.suggestion.value === suggestion.value) continue
      const offer: Offer = { suggestion, shown: new Date(), filled }
      this.offered.set(field, offer)
      void vault.recordPresentation(presentation(template.ref, field, offer)).catch(() => {})
    }
  }

  private scheduleSuggest() {
    clearTimeout(this.suggestTimer)
    if (this.template) this.suggestTimer = setTimeout(() => void this.suggest(), SUGGEST_DELAY_MS)
  }

  /** Puts a suggested value into the form. It is a value like any other until the document is saved. */
  private accept(field: string, value: string) {
    this.decided(field)
    this.setValues({ ...this.values, [field]: value })
    this.initialValues = this.values
    this.applied++
    this.dirty = true
    this.message = ''
    this.dismiss(field)
  }

  /** Sets a suggestion aside. The rejection is recorded if the field is still empty when saved. */
  private reject(field: string) {
    this.decided(field)
    this.rejected.add(field)
    this.dismiss(field)
  }

  private decided(field: string) {
    const offer = this.offered.get(field)
    if (offer) offer.decided = new Date()
  }

  /** The form's values, and the order its fields were filled in. */
  private setValues(values: FieldValues) {
    this.values = values
    this.filled = fillOrder(this.filled, values)
  }

  private dismiss(field: string) {
    const rest = new Map(this.suggestions)
    rest.delete(field)
    this.suggestions = rest
  }

  /** Records what the save confirmed about the suggestions offered for this draft. */
  private async recordSuggestionEvents(path: string) {
    const events = suggestionEvents(this.offered, this.rejected, this.values, path, new Date(), this.template?.ref)
    // Each event is recorded once; a rejection stays in force while the draft is open. A suggestion
    // the save said nothing about is still the one showing, not a new presentation.
    for (const event of events) this.offered.delete(event.field)
    for (const event of events) await vault.recordEvent(event)
  }

  /** Drops the unsaved edits and shows the document as it is on disk now. */
  private async readOutside() {
    if (this.draft?.kind !== 'existing') return
    await this.open(this.draft.path)
    this.message = strings.reloadedOutside
  }

  private async startNew(templatePath: string) {
    this.reset()
    try {
      const templateSource = await vault.read(templatePath)
      const { ref } = templateInfo(templateSource)
      this.setValues({})
      this.initialValues = this.values
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
      const { template, values } = documentFrontMatter(source)
      this.setValues(fieldValues(values))
      this.initialValues = this.values
      this.draft = { kind: 'existing', path, source, templateRef: template }
      this.opened++
      void this.prepareSuggestions(this.draft.templateRef)
    } catch (e) {
      this.error = describeError(e)
    }
  }

  /** Saves the open document; the app's save shortcut calls this too. */
  async save() {
    const draft = this.draft
    if (!draft) return
    this.error = ''
    this.message = '' // "saved" is said again only once this save has landed
    try {
      if (draft.kind === 'existing') {
        const source = updateDocument(draft.source, this.values)
        await vault.write(draft.path, source)
        this.draft = { ...draft, source }
      } else {
        const source = newDocument(draft.templateSource, this.values)
        const path = await this.createDocument(source, documentTitle(draft.templateSource, this.values))
        this.draft = { kind: 'existing', path, source, templateRef: draft.templateRef }
      }
      // The app's own writes are not reported back, so the list is read here: a new document, or
      // one made again after it was removed outside, joins it.
      await this.refresh()
      if (this.draft?.kind === 'existing') await this.recordSuggestionEvents(this.draft.path)
      this.dirty = false
      this.changedOutside = false
      this.message = strings.saved
      this.dispatchEvent(new CustomEvent('ll-confirmed', { bubbles: true, composed: true }))
      // What was just saved is confirmed: the next suggestions learn from it.
      void this.prepareSuggestions(this.draft?.templateRef)
    } catch (e) {
      this.error = describeError(e)
    }
  }

  /** Creates the document under a free name; never replaces an existing file. */
  private createDocument(source: string, title: string | undefined): Promise<string> {
    return createDocumentFile(this.vaultInfo.documentsDir, source, title)
  }

  /** Goes elsewhere once unsaved edits to the open document are let go. */
  private async leaveFor(next: () => unknown) {
    if (await confirmDiscard()) await next()
  }

  private startImport() {
    this.reset()
    this.draft = undefined
    this.importing = true
  }

  private async imported(created: number) {
    this.importing = false
    await this.refresh()
    this.message = strings.imported(created)
  }

  private onData(e: CustomEvent<{ formData: Record<string, unknown> }>) {
    this.setValues(fieldValues(e.detail.formData))
    this.dirty = true
    this.message = ''
    this.scheduleSuggest()
  }

  /** Which fields of this template learn from confirmed documents — set on the template's page. */
  private renderJudgment() {
    const template = this.template
    if (!template) return nothing
    const label = (name: string) => template.fields.find((f) => f.name === name)?.label ?? name
    return html`<p class="message judgment">${strings.judgmentFields(template.suggest.map(label))}</p>
      ${[...this.abstained].map(
        (field) => html`<p class="message abstained" data-field=${field}>${strings.judgmentAbstained(label(field), this.learned.get(field) ?? 0)}</p>`,
      )}`
  }

  private renderSource(s: Suggestion) {
    const text =
      s.mode === 'key' ? strings.suggestionKey(s.source!) : strings.suggestionSource(s.source!.replace(/^.*\//, '').replace(/\.md$/, ''))
    return html`<span class="source" title=${text}>${text}</span>`
  }

  private renderSuggestions() {
    if (this.suggestions.size === 0) return nothing
    const label = (name: string) => this.template?.fields.find((f) => f.name === name)?.label ?? name
    return html`<div class="suggestions">
      ${[...this.suggestions].map(
        ([field, s]) => html`<div class="suggestion" role="note" data-field=${field}>
          <span>${strings.suggestionFor(label(field))}: <strong>${s.value}</strong></span>
          ${s.source ? this.renderSource(s) : html`<span class="source"></span>`}
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
        ${this.scope
          ? html`<div class="new">
              <dc-button size="sm" variant="secondary" @click=${() => this.leaveFor(() => this.startNew(this.scope!.path))}
                >${strings.newDocument}</dc-button
              >
              <dc-button size="sm" variant="ghost" @click=${() => this.leaveFor(() => this.startImport())}>${strings.import}</dc-button>
            </div>`
          : nothing}
        ${this.documents.length === 0
          ? html`<p class="message">${strings.noDocuments}</p>`
          : this.documents.map(
              (d) => html`<button
                aria-current=${draft?.kind === 'existing' && draft.path === d.path}
                @click=${() => this.leaveFor(() => this.open(d.path))}
              >
                ${d.name.replace(/\.md$/, '')}
                ${noteFor(conflictLabel(d, this.documents, '.md'))}
              </button>`,
            )}
      </nav>
      <section>
        ${this.importing
          ? html`<ll-import
              .vaultInfo=${this.vaultInfo}
              .template=${this.scope}
              @ll-imported=${(e: CustomEvent<{ created: number }>) => void this.imported(e.detail.created)}
              @ll-import-cancel=${() => (this.importing = false)}
            ></ll-import>`
          : draft
          ? html`
              <div class="bar">
                <dc-button size="sm" ?disabled=${!this.dirty} @click=${this.save}>${strings.save}</dc-button>
                ${draft.templateRef && !this.scope
                  ? html`<span class="message">${strings.documentFrom(this.templateNames.get(draft.templateRef) ?? draft.templateRef)}</span>`
                  : nothing}
                ${this.error
                  ? html`<span class="error" role="alert">${this.error}</span>`
                  : html`<span class="message" role="status">${this.message}</span>`}
                ${this.changedOutside
                  ? html`<dc-button size="sm" variant="secondary" @click=${this.readOutside}>${strings.readOutside}</dc-button>`
                  : nothing}
              </div>
              ${draft.kind === 'existing' ? noticeFor(conflictNotice(draft.path, this.documents, '.md', strings.conflictedOriginal)) : nothing}
              ${this.renderJudgment()}
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
            : this.message
              ? html`<p class="message" role="status">${this.message}</p>`
              : nothing}
      </section>
    `
  }
}

/** A saved value, as the vault's front matter holds it (a key written empty reads as null). */
function holdsValue(value: unknown): boolean {
  return value !== undefined && value !== null && !isEmpty(value as FieldValues[string])
}

function isEmpty(value: FieldValues[string] | undefined): boolean {
  return value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

declare global {
  interface HTMLElementTagNameMap {
    'll-documents': LlDocuments
  }
}
