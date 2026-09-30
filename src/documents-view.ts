import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { formdownTheme } from './formdown-theme.js'
import { guard } from 'lit/directives/guard.js'
import { keyed } from 'lit/directives/keyed.js'
import type { FieldStates } from '@formdown/ui'
import {
  documentTitle,
  fileName,
  fileNameFor,
  documentFrontMatter,
  fieldValues,
  newDocument,
  setDocumentId,
  templateBody,
  templateInfo,
  updateDocument,
  type FieldValues,
} from './documents.js'
import { documentId, newDocumentId, sharedIds } from './identity.js'
import { describeError } from './errors.js'
import { fillOrder, presentation, suggestionEvents, type Offer } from './events.js'
import type { Abstention, Suggestion, TemplateSnapshot } from './projection.js'
import { strings } from './strings.js'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { host, onVaultChanged, removedBy, touches, vault, type VaultChanged, type VaultEntry, type VaultInfo } from './vault-client.js'
import { readVault, syncVault } from './vault-snapshot.js'
import { documentsOf, type TemplateItem } from './template-scope.js'
import { createDocumentFile } from './document-files.js'
import { conflictLabel, conflictNoticeFor, conflictOf, isCopy, noteFor } from './conflicts.js'
import { confirmDiscard, markUnsaved } from './unsaved.js'
import './import-view.js'
import './rename-control.js'
import './delete-control.js'
import './keep-copy-control.js'

/** How long typing pauses before suggestions are asked for again. */
const SUGGEST_DELAY_MS = 300

/** What is open in the editor: a new document from a template, or an existing document. */
type Draft =
  | { kind: 'new'; templateSource: string; templateRef: string }
  | { kind: 'existing'; path: string; id: string; source: string; templateRef?: string }

/**
 * A template's documents: fill in the template to create one, or open one and change its values.
 * Without a template (`null`), the documents that name none the vault has — to open and keep.
 */
@customElement('ll-documents')
export class LlDocuments extends LitElement {
  static styles = [
    formdownTheme,
    css`
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
      background: var(--dc-color-surface, #f4f4f4);
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
    /* When the column is narrow the status goes to a line of its own; a heading or a button never breaks. */
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--dc-space-2, 8px);
    }
    .bar > * {
      white-space: nowrap;
    }
    .bar > [role='status'],
    .bar > [role='alert'] {
      white-space: normal;
    }
    .message {
      color: var(--dc-color-text-muted, #666);
    }
    .error {
      color: var(--dc-color-danger, #b00020);
    }
    p.judgment {
      margin: 0;
      font-size: 0.875em;
    }
  `,
  ]

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
  /** Judgment fields asked for a suggestion and given none, with why — or `unavailable` when asking failed. */
  @state() private abstained = new Map<string, Abstention | null | 'unavailable'>()
  /** The open draft's template has judgment fields, and the sidecar that suggests for them did not start. */
  @state() private unavailable = false
  /** Ids more than one document holds (a file copied outside the app); see `sharedIds`. */
  private sharedIds = new Set<string>()
  /** Documents' paths by id: a suggestion from a similar document names the document by its id. */
  private pathsById = new Map<string, string>()
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
  /** The trash would not take the open document: whether to delete it for good is being asked. */
  @state() private untrashable = false
  /** The trash would not take the original of the open conflict copy being kept: whether to delete it for good is being asked. */
  @state() private originalUntrashable = false
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
    // A view no longer shown holds no edits: an outside change that lands after it left says nothing.
    if (changed.has('dirty')) markUnsaved('documents', this.isConnected && this.dirty)
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
      } else {
        const source = await vault.read(draft.path)
        // A notice that changed nothing leaves the screen alone. An edit made while the file was being
        // read is not replaced: the notice was about the file, not about what was typed since.
        if (this.draft !== draft || source === draft.source) {
          // nothing to show
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
    }
    if (this.template) void this.prepareSuggestions(draft?.templateRef)
  }

  private async refresh() {
    try {
      const read = await readVault()
      const templateOf = new Map(read.documents.map((d) => [d.path, d.template]))
      this.documents = documentsOf(read.documentEntries, templateOf, this.scope?.ref ?? null, new Set(read.names.keys()))
      this.templateNames = read.names
      this.sharedIds = sharedIds(read.documents)
    } catch (e) {
      this.error = describeError(e)
    }
  }

  private reset() {
    this.error = ''
    this.importing = false
    this.changedOutside = false
    this.untrashable = false
    this.originalUntrashable = false
    this.message = ''
    this.dirty = false
    this.template = undefined
    this.suggestions = new Map()
    this.abstained = new Map()
    this.unavailable = false
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
      this.pathsById = new Map(synced.documents.map((d) => [d.id, d.path]))
      this.learned = new Map(template?.suggest.map((f) => [f, settled.filter((d) => holdsValue(d.values[f])).length]))
      this.unavailable = false
      await this.suggest()
    } catch {
      this.template = undefined
      // Saying nothing would read as "no suggestion to make": say they failed, if the template has fields to suggest for.
      try {
        const read = await readVault()
        if (this.draft?.templateRef !== templateRef) return
        this.unavailable = !!read.templates.find((t) => t.ref === templateRef)?.suggest.length
      } catch {
        // the vault itself could not be read: nothing more to say about suggestions
      }
    }
  }

  /** Asks for a value for each empty judgment field, given what the other fields hold. */
  private async suggest() {
    const template = this.template
    if (!template) return
    const run = ++this.suggestRun
    const values = { ...this.values }
    const next = new Map<string, Suggestion>()
    const abstained = new Map<string, Abstention | null | 'unavailable'>()
    for (const field of template.suggest) {
      if (!isEmpty(values[field])) continue
      try {
        const document = this.draft?.kind === 'existing' ? this.draft.id : undefined
        const suggestion = await host.suggest(template.ref, field, values, document)
        // Declined here, now or before it was last saved: not offered again, and nothing to explain.
        if (this.rejected.has(field) || suggestion.mode === 'rejected') continue
        if (suggestion.value !== null) next.set(field, suggestion)
        else abstained.set(field, suggestion.reason ?? null)
      } catch {
        abstained.set(field, 'unavailable')
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
  private async recordSuggestionEvents(id: string) {
    const events = suggestionEvents(this.offered, this.rejected, this.values, id, new Date(), this.template?.ref)
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
      const { template, id, values } = documentFrontMatter(source)
      this.setValues(fieldValues(values))
      this.initialValues = this.values
      this.draft = { kind: 'existing', path, id: documentId(path, id), source, templateRef: template }
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
        // A copy saved with a change is a document of its own from now on.
        const id = this.sharedIds.has(draft.id) ? newDocumentId() : draft.id
        const updated = updateDocument(draft.source, this.values)
        const source = id === draft.id ? updated : setDocumentId(updated, id)
        // Unless the person was told the file changed outside, an edit made there since it was read is
        // not overwritten unseen — the watch may not have reported it yet, or at all.
        try {
          if (this.changedOutside) await vault.write(draft.path, source)
          else await vault.writeIfUnchanged(draft.path, draft.source, source)
        } catch (e) {
          if ((e as { kind?: string }).kind !== 'changed-outside') throw e
          this.error = strings.changedOutsideDirty
          this.changedOutside = true
          return
        }
        this.draft = { ...draft, id, source }
      } else {
        const id = newDocumentId()
        const source = newDocument(draft.templateSource, this.values, id)
        const path = await this.createDocument(source, documentTitle(draft.templateSource, this.values))
        this.draft = { kind: 'existing', path, id, source, templateRef: draft.templateRef }
      }
      // The app's own writes are not reported back, so the list is read here: a new document, or
      // one made again after it was removed outside, joins it.
      await this.refresh()
      if (this.draft?.kind === 'existing') await this.recordSuggestionEvents(this.draft.id)
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

  /**
   * Gives the open document the name typed — its file's name, which is what the lists show (R-1).
   * Unsaved edits are saved first. A document known by its path is given that path as its id before
   * it moves, so what was recorded about it stays with it. A name another document has is refused.
   */
  private async rename(name: string) {
    if (this.draft?.kind !== 'existing') return
    const file = fileNameFor(name, '.md')
    if (!file) {
      this.error = strings.nameInvalid
      return
    }
    const from = this.draft.path
    const to = `${from.slice(0, from.lastIndexOf('/') + 1)}${file}`
    if (to === from) return
    this.error = ''
    this.message = ''
    if (this.dirty) {
      await this.save()
      if (this.dirty) return // not saved: the error says why
    }
    const draft = this.draft
    if (draft?.kind !== 'existing') return
    try {
      const source = documentFrontMatter(draft.source).id ? draft.source : setDocumentId(draft.source, draft.id)
      if (source !== draft.source) await vault.writeIfUnchanged(draft.path, draft.source, source)
      try {
        await vault.rename(draft.path, to)
      } catch (e) {
        // Refused: the file is left as it was.
        if (source !== draft.source) await vault.write(draft.path, draft.source)
        throw e
      }
      this.draft = { ...draft, source, path: to }
      await this.refresh()
      this.message = strings.renamed
      // The sidecar knows documents by their paths too: it is handed the vault as it is now.
      void this.prepareSuggestions(draft.templateRef)
    } catch (e) {
      const kind = (e as { kind?: string }).kind
      if (kind === 'changed-outside') this.changedOutside = true
      this.error = kind === 'already-exists' ? strings.nameTaken : kind === 'changed-outside' ? strings.changedOutsideDirty : describeError(e)
    }
  }

  /**
   * Deletes the open document — to the system's trash, or for good once the person chose that for a
   * file the trash would not take. Unsaved edits go with it: the question said so. What was recorded
   * about the document stays in the event files under its id; its values no longer teach suggestions.
   */
  private async delete(permanently: boolean) {
    const draft = this.draft
    if (draft?.kind !== 'existing') return
    const conflict = conflictOf(draft.path, this.documents)
    this.untrashable = false
    this.error = ''
    this.message = ''
    try {
      if (permanently) await vault.remove(draft.path)
      else await vault.trash(draft.path)
    } catch (e) {
      if (!permanently && (e as { kind?: string }).kind === 'not-trashed') this.untrashable = true
      else this.error = describeError(e)
      return
    }
    if (conflict !== undefined && 'copyOf' in conflict) {
      // Deleting a conflict copy keeps its original: that is where the person is taken.
      await this.refresh()
      await this.open(conflict.copyOf)
      this.message = strings.keptOriginal(permanently)
      return
    }
    this.reset()
    this.draft = undefined
    await this.refresh()
    this.message = permanently ? strings.removed : strings.trashed
  }

  /**
   * Keeps the open conflict copy in its original's place: the original goes to the system's trash (or
   * for good, once the person chose that for a file the trash would not take), and the copy takes its
   * name. Unsaved edits to the copy are saved first. The copy is not given an id of its own: it holds
   * the original's, or — a document known by its path — takes the original's path, and with it what
   * was recorded about the original.
   */
  private async keepCopy(permanently: boolean) {
    const draft = this.draft
    if (draft?.kind !== 'existing') return
    const conflict = conflictOf(draft.path, this.documents)
    if (conflict === undefined || !('copyOf' in conflict)) return
    const original = conflict.copyOf
    this.originalUntrashable = false
    this.error = ''
    this.message = ''
    if (this.dirty) {
      await this.save()
      if (this.dirty) return // not saved: the error says why
    }
    try {
      if (permanently) await vault.remove(original)
      else await vault.trash(original)
    } catch (e) {
      if (!permanently && (e as { kind?: string }).kind === 'not-trashed') this.originalUntrashable = true
      else this.error = describeError(e)
      return
    }
    try {
      await vault.rename(draft.path, original)
    } catch (e) {
      // The original is gone as asked; the copy stays under its own name, still a copy.
      await this.refresh()
      this.error = (e as { kind?: string }).kind === 'already-exists' ? strings.keptCopyNameTaken(permanently) : describeError(e)
      return
    }
    await this.refresh()
    await this.open(original)
    this.message = strings.keptCopy(permanently)
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

  /**
   * Takes the values of the form opened as draft `opened`. A form that has been replaced — another
   * draft opened, or the document deleted — can still report once, as its focused field blurs on
   * the way out: that is not an edit of what is open now.
   */
  private onData(e: CustomEvent<{ formData: Record<string, unknown> }>, opened: number) {
    if (opened !== this.opened || !this.draft) return
    this.setValues(fieldValues(e.detail.formData))
    this.dirty = true
    this.message = ''
    this.scheduleSuggest()
  }

  /** Which fields of this template learn from confirmed documents — set on the template's page. */
  private renderJudgment() {
    if (this.unavailable) return html`<p class="message judgment" role="status">${strings.suggestionsUnavailable}</p>`
    const template = this.template
    if (!template) return nothing
    return html`<p class="message judgment">${strings.judgmentFields(template.suggest.map((f) => this.label(f)))}</p>`
  }

  private label(field: string): string {
    return this.template?.fields.find((f) => f.name === field)?.label ?? field
  }

  /** What the form draws by each judgment field: the suggested value to take or decline, or why there is none. */
  private fieldStates(): FieldStates {
    const states: FieldStates = {}
    for (const [field, s] of this.suggestions) {
      states[field] = { suggestions: [s.value!], note: this.sourceOf(s), decline: strings.reject }
    }
    for (const [field, reason] of this.abstained) {
      states[field] = {
        note: reason === 'unavailable' ? strings.judgmentUnavailable : strings.judgmentAbstained(reason, this.learned.get(field) ?? 0),
      }
    }
    return states
  }

  /** What a suggestion rests on, in words: the similar document by its name, or the value it was settled with. */
  private sourceOf(s: Suggestion): string {
    if (!s.source) return strings.suggestion
    return s.mode === 'key'
      ? strings.suggestionKey(s.source)
      : strings.suggestionSource((this.pathsById.get(s.source) ?? s.source).replace(/^.*\//, '').replace(/\.md$/, ''))
  }

  render() {
    const draft = this.draft
    const opened = this.opened
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
                ${draft.kind === 'existing'
                  ? html`<ll-rename
                      .name=${fileName(draft.path, '.md')}
                      @ll-rename=${(e: CustomEvent<{ name: string }>) => void this.rename(e.detail.name)}
                      @ll-rename-cancel=${() => (this.error = '')}
                    ></ll-rename>
                    <ll-delete
                      heading=${isCopy(draft.path, this.documents) ? strings.deleteCopyHeading : strings.deleteDocumentHeading}
                      body=${(isCopy(draft.path, this.documents) ? strings.deleteCopyBody : strings.deleteDocumentBody)(this.dirty)}
                      .untrashable=${this.untrashable}
                      @ll-delete=${(e: CustomEvent<{ permanently: boolean }>) => void this.delete(e.detail.permanently)}
                      @ll-delete-cancel=${() => (this.untrashable = false)}
                    ></ll-delete>`
                  : nothing}
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
              ${draft.kind === 'existing'
                ? conflictNoticeFor(draft.path, this.documents, '.md', strings.conflictedOriginal, {
                    view: (copy) => void this.leaveFor(() => this.open(copy)),
                    keep: (original) => html`<ll-keep-copy
                      original=${original}
                      .untrashable=${this.originalUntrashable}
                      @ll-keep-copy=${(e: CustomEvent<{ permanently: boolean }>) => void this.keepCopy(e.detail.permanently)}
                      @ll-keep-copy-cancel=${() => (this.originalUntrashable = false)}
                    ></ll-keep-copy>`,
                  })
                : nothing}
              ${this.renderJudgment()}
              ${keyed(
                opened,
                html`<formdown-ui
                .content=${draft.kind === 'new' ? templateBody(draft.templateSource) : draft.source}
                .data=${guard([this.opened, this.applied], () => this.initialValues)}
                .fieldStates=${guard([this.suggestions, this.abstained], () => this.fieldStates())}
                @formdown-data-update=${(e: CustomEvent<{ formData: Record<string, unknown> }>) => this.onData(e, opened)}
                @formdown-suggestion-pick=${(e: CustomEvent<{ field: string; value: string }>) => this.accept(e.detail.field, e.detail.value)}
                @formdown-suggestion-decline=${(e: CustomEvent<{ field: string }>) => this.reject(e.detail.field)}
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
