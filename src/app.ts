import { LitElement, css, html, nothing } from 'lit'
import { customElement, queryAll, state } from 'lit/decorators.js'
import { live } from 'lit/directives/live.js'
import { open } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { DpSidebarSelectEvent } from '@iyulab/desktop-patterns/sidebar'
import type { DcTabChangeEvent } from '@iyulab/desktop-compact/tab-bar'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { createSampleTemplate, createTemplateFile } from './document-files.js'
import type { LlMark } from './brand/mark.js'
import { describeError } from './errors.js'
import { strings } from './strings.js'
import { NEW_TEMPLATE, documentsOf, placeId, placeOf, sidebarEntries, templatesAfterRead, type Place, type TemplateItem } from './template-scope.js'
import { onVaultChanged, onWritten, vault, type VaultInfo } from './vault-client.js'
import { openVault, readVault, resumeVault } from './vault-snapshot.js'
import { confirmDiscard, hasUnsaved, setDiscardQuestion } from './unsaved.js'
import './templates-view.js'
import './documents-view.js'
import type { LlDocuments } from './documents-view.js'
import './table-view.js'
import './learning-view.js'

/** What of a template shows: its table, its source, or its documents. */
type Tab = 'table' | 'template' | 'documents'

/** Whether a modal dialog is open anywhere in the page — dialogs live in components' shadow roots. */
function modalOpen(root: Document | ShadowRoot): boolean {
  if (root.querySelector('dialog[open]')) return true
  for (const el of root.querySelectorAll('*')) if (el.shadowRoot && modalOpen(el.shadowRoot)) return true
  return false
}

@customElement('ll-app')
export class LlApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      height: 100%;
    }
    dp-shell {
      height: 100%;
    }
    .place {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-3, 12px);
      height: 100%;
      min-height: 0;
    }
    .place > :last-child {
      flex: 1;
      min-height: 0;
    }
    .error {
      color: var(--dc-color-danger, #b00020);
    }
    .notice {
      margin: 0 0 var(--dc-space-2, 8px);
      color: var(--dc-color-text-muted, #666);
    }
    .welcome {
      min-height: 60vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--dc-space-5, 24px);
      text-align: center;
    }
    .welcome p {
      margin: 0;
      color: var(--dc-color-text-secondary, #5e5c57);
    }
    .choices {
      display: flex;
      gap: var(--dc-space-2, 8px);
    }
    .tagline {
      font-size: 17px;
      letter-spacing: 0.01em;
    }
  `

  /** Where the app is; unset while the vault has no template (or none is open). */
  @state() private place?: Place
  @state() private tab: Tab = 'table'
  /** The vault's templates, as the sidebar lists them. */
  @state() private templates: TemplateItem[] = []
  /** Whether some documents name no template the vault has. */
  @state() private hasOrphans = false
  /**
   * Whether the sidebar is open as a drawer. The shell shows the sidebar beside the content at desktop
   * width whatever this says, and below it as a drawer over the content only while this is set — so it
   * starts closed, and closes when the shell asks (its backdrop) or a place is picked from it.
   */
  @state() private sidebarOpen = false
  @state() private vaultInfo?: VaultInfo
  @state() private error = ''
  /** What the app just did that left the place it showed (a template deleted); gone once elsewhere. */
  @state() private notice = ''
  /** Where the app was when it was last used, to be shown once the vault it reopened is read. */
  private resumeAt?: { place: Place; tab: Tab }
  /** A document to open in the documents view, asked for from elsewhere (a table row). */
  @state() private openPath?: string
  /** The unsaved-edits question is showing; the answer settles the promise it was asked with. */
  @state() private asking = false
  private answer?: (discard: boolean) => void
  @queryAll('ll-mark') private marks!: NodeListOf<LlMark>
  private unlisten?: Promise<UnlistenFn>
  /** A template the app writes (makes, saves) may change the list. */
  private readonly onTemplateWritten = (path: string | null) => {
    if (path !== null && this.vaultInfo && path.startsWith(this.vaultInfo.templatesDir + '/')) void this.refreshPlaces()
  }

  /**
   * The app's shortcuts, heard on the window so the web view's own (save page, new window, find in
   * page) never run, and the same from any field or with focus on the page itself:
   * - Ctrl+S (⌘S) saves whatever is being edited — a template or a document.
   * - Ctrl+N starts a new document of the template shown, on its documents tab.
   * - Ctrl+F goes to the box that finds the template's documents.
   * While a dialog is open they do nothing: the question on screen is answered first.
   */
  private readonly onShortcut = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
    const key = e.key.toLowerCase()
    if (key !== 's' && key !== 'n' && key !== 'f') return
    e.preventDefault()
    if (modalOpen(document)) return
    if (key === 's') {
      const editor = this.renderRoot.querySelector<HTMLElement & { save(): Promise<void> }>('ll-templates, ll-documents')
      void editor?.save()
    } else void this.toDocuments((documents) => (key === 'n' ? documents.newDocument() : documents.focusFinder()))
  }

  /** Shows the documents tab of the template shown, then does `then` there; elsewhere does nothing. */
  private async toDocuments(then: (documents: LlDocuments) => void) {
    if (this.place?.kind !== 'template') return
    if (this.tab !== 'documents') {
      await this.switchTab('documents')
      if ((this.tab as Tab) !== 'documents') return // the edits were kept: the tab stayed
      await this.updateComplete
    }
    const documents = this.renderRoot.querySelector<LlDocuments>('ll-documents')
    if (!documents) return
    await documents.updateComplete
    then(documents)
  }

  connectedCallback() {
    super.connectedCallback()
    // Typing holds the caret solid; a pause lets it blink again.
    this.addEventListener('keydown', () => this.marks.forEach((m) => m.hold()))
    window.addEventListener('keydown', this.onShortcut)
    this.addEventListener('pointerdown', () => this.marks.forEach((m) => m.wake()))
    // A save is a confirmation: the mark shows "not yet" becoming "confirmed".
    this.addEventListener('ll-confirmed', () => this.marks.forEach((m) => m.confirm()))
    setDiscardQuestion(
      () =>
        new Promise<boolean>((resolve) => {
          this.answer = resolve
          this.asking = true
        }),
    )
    // Closing the window with unsaved edits asks first, like everywhere else in the app.
    const win = getCurrentWindow()
    void win.onCloseRequested(async (e) => {
      if (!hasUnsaved()) return
      e.preventDefault()
      if (await confirmDiscard()) await win.destroy()
    })
    void this.resume()
    this.addEventListener('ll-open-document', (e) => {
      const { path, template } = (e as CustomEvent<{ path: string; template: string }>).detail
      this.openPath = path
      this.place = { kind: 'template', ref: template }
      this.tab = 'documents'
    })
    // The template showing was deleted: its place is gone, and the app shows the next one.
    this.addEventListener('ll-template-deleted', async (e) => {
      const { permanently } = (e as CustomEvent<{ permanently: boolean }>).detail
      this.openPath = undefined
      this.place = undefined
      await this.refreshPlaces()
      this.notice = strings.templateDeleted(permanently, this.hasOrphans)
    })
    onWritten.add(this.onTemplateWritten)
    this.unlisten = onVaultChanged(() => void this.refreshPlaces())
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('keydown', this.onShortcut)
    onWritten.delete(this.onTemplateWritten)
    void this.unlisten?.then((stop) => stop())
  }

  /**
   * Opens the vault the app was last using, at the place it showed — unless a vault is open by then, or
   * that one can no longer be opened (then the first screen, as for a first launch).
   */
  private async resume() {
    const resumed = await resumeVault().catch(() => null)
    if (!resumed || this.vaultInfo) return
    const session = resumed.session as { place?: unknown; tab?: unknown } | undefined
    const place = typeof session?.place === 'string' ? placeOf(session.place) : undefined
    const tab = session?.tab
    if (place) this.resumeAt = { place, tab: tab === 'template' || tab === 'documents' ? tab : 'table' }
    this.vaultInfo = resumed.vault
  }

  updated(changed: Map<string, unknown>) {
    // Where the app is, for the next launch: kept on this device (the shell's app settings), not in the vault.
    if ((changed.has('vaultInfo') || changed.has('place') || changed.has('tab')) && this.vaultInfo && this.place) {
      const session = { vault: this.vaultInfo.root, place: placeId(this.place), tab: this.tab }
      void vault.writeSession(JSON.stringify(session)).catch(() => {})
    }
  }

  willUpdate(changed: Map<string, unknown>) {
    // Another vault: its own templates, starting from the first.
    if (changed.has('vaultInfo')) {
      this.place = undefined
      this.templates = []
      this.hasOrphans = false
      void this.refreshPlaces()
    }
  }

  /** Reads which templates the vault has now; a place that is gone gives way to the first template. */
  private async refreshPlaces() {
    if (!this.vaultInfo) return
    try {
      const read = await readVault()
      const templateOf = new Map(read.documents.map((d) => [d.path, d.template]))
      const place = this.place
      const shown = place?.kind === 'template' ? this.templates.find((t) => t.ref === place.ref) : undefined
      const after = templatesAfterRead(read.templateItems, shown)
      this.templates = after.templates
      this.hasOrphans = documentsOf(read.documentEntries, templateOf, null, new Set(read.names.keys())).length > 0
      // The template showing may be the same file under a reference edited in it: the place follows the file.
      const now: Place | undefined = after.shown && place?.kind === 'template' ? { kind: 'template', ref: after.shown.ref } : place
      const stays =
        now?.kind === 'learning' ||
        (now?.kind === 'orphans' && this.hasOrphans) ||
        (now?.kind === 'template' && this.templates.some((t) => t.ref === now.ref))
      const resume = this.resumeAt
      this.resumeAt = undefined
      const there = (p: Place) =>
        p.kind === 'learning' || (p.kind === 'orphans' && this.hasOrphans) || (p.kind === 'template' && this.templates.some((t) => t.ref === p.ref))
      if (!stays && resume && there(resume.place)) {
        this.place = resume.place
        this.tab = resume.tab
      } else if (!stays) {
        // First the template with documents — where the work is — else the first one.
        const worked = this.templates.find((t) => read.documents.some((d) => d.template === t.ref)) ?? this.templates[0]
        this.place = worked ? { kind: 'template', ref: worked.ref } : undefined
      }
      else if (now?.kind === 'template' && place?.kind === 'template' && now.ref !== place.ref) this.place = now
    } catch (e) {
      this.error = describeError(e)
    }
  }

  private settle(discard: boolean) {
    this.asking = false
    this.answer?.(discard)
    this.answer = undefined
  }

  /** Goes to a place once unsaved edits are let go; otherwise the sidebar shows the place kept. */
  private async go(place: Place) {
    if (this.place && placeId(place) === placeId(this.place)) return
    if (!(await confirmDiscard())) return this.requestUpdate()
    this.openPath = undefined
    this.notice = ''
    this.place = place
    void this.refreshPlaces() // a template kept while it showed, gone outside, leaves the list
  }

  private async switchTab(tab: Tab) {
    if (tab === this.tab) return
    if (!(await confirmDiscard())) return this.requestUpdate()
    this.openPath = undefined
    this.notice = ''
    this.tab = tab
  }

  private onSidebarSelect(e: DpSidebarSelectEvent) {
    this.sidebarOpen = false // a drawer over the content gives way to what was picked
    if (e.itemId === NEW_TEMPLATE) {
      e.preventDefault() // an action, not a place: the selection stays where it is
      void this.createTemplate()
      return
    }
    const place = placeOf(e.itemId)
    if (place) void this.go(place)
  }

  /** Makes a template from the starter and opens its source. */
  private async createTemplate() {
    const info = this.vaultInfo
    if (!info || !(await confirmDiscard())) return
    try {
      const path = await createTemplateFile(info.templatesDir)
      await this.refreshPlaces()
      const made = this.templates.find((t) => t.path === path)
      if (made) {
        this.openPath = undefined
        this.place = { kind: 'template', ref: made.ref }
        this.tab = 'template'
      }
    } catch (e) {
      this.error = describeError(e)
    }
  }

  private async openVault() {
    if (!(await confirmDiscard())) return
    const path = await open({ directory: true, title: strings.openVaultTitle })
    if (typeof path !== 'string') return
    try {
      this.vaultInfo = await openVault(path)
      this.error = ''
    } catch (e) {
      this.error = describeError(e)
    }
  }

  private async newVault() {
    if (!(await confirmDiscard())) return
    const path = await open({ directory: true, title: strings.newVaultTitle })
    if (typeof path === 'string') await this.makeVault(path)
  }

  /**
   * Makes a vault in the empty folder at `path`: opens it and puts the sample template in it, then
   * shows the sample's documents, ready for a first one. A folder that holds anything is refused.
   */
  async makeVault(path: string) {
    try {
      if (!(await invoke<boolean>('folder_is_empty', { path }))) {
        this.error = strings.newVaultNotEmpty
        return
      }
      const info = await openVault(path)
      const sample = await createSampleTemplate(info.templatesDir)
      this.vaultInfo = info
      this.error = ''
      await this.updateComplete // the new vault's places are read
      await this.refreshPlaces()
      const made = this.templates.find((t) => t.path === sample)
      if (made) {
        this.place = { kind: 'template', ref: made.ref }
        this.tab = 'documents'
      }
    } catch (e) {
      this.error = describeError(e)
    }
  }

  private heading(): string {
    const place = this.place
    if (place?.kind === 'learning') return strings.navLearning
    if (place?.kind === 'orphans') return strings.orphanDocuments
    if (place?.kind === 'template') return this.templates.find((t) => t.ref === place.ref)?.name ?? place.ref
    return ''
  }

  private renderPlace(info: VaultInfo) {
    const place = this.place
    if (!place)
      return html`<div class="welcome">
        <p>${strings.noTemplates}</p>
        <dc-button @click=${() => void this.createTemplate()}>${strings.makeTemplate}</dc-button>
      </div>`
    if (place.kind === 'learning') return html`<ll-learning .vaultInfo=${info}></ll-learning>`
    if (place.kind === 'orphans') return html`<ll-documents .vaultInfo=${info} .scope=${null}></ll-documents>`
    const template = this.templates.find((t) => t.ref === place.ref)
    if (!template) return nothing
    return html`<div class="place">
      <dc-tab-bar
        .items=${[
          { id: 'table', label: strings.navTable },
          { id: 'template', label: strings.navTemplates },
          { id: 'documents', label: strings.navDocuments },
        ]}
        .activeId=${live(this.tab)}
        @dc-tab-change=${(e: DcTabChangeEvent) => void this.switchTab(e.tabId as Tab)}
      ></dc-tab-bar>
      ${this.tab === 'table'
        ? html`<ll-table .vaultInfo=${info} .template=${template.ref}></ll-table>`
        : this.tab === 'template'
          ? html`<ll-templates .vaultInfo=${info} .path=${template.path}></ll-templates>`
          : html`<ll-documents .vaultInfo=${info} .scope=${template} .openPath=${this.openPath}></ll-documents>`}
    </div>`
  }

  render() {
    const info = this.vaultInfo
    return html`
      <dp-shell ?sidebar-open=${this.sidebarOpen} @dp-shell-sidebar-close=${() => (this.sidebarOpen = false)}>
        <dp-sidebar
          slot="sidebar"
          header=${info?.name ?? strings.appName}
          nav-label=${strings.navLabel}
          .activeId=${live(this.place ? placeId(this.place) : '')}
          .items=${info
            ? sidebarEntries(this.templates, this.hasOrphans, {
                templates: strings.navTemplates,
                newTemplate: strings.makeTemplate,
                learning: strings.navLearning,
                orphans: strings.orphanDocuments,
              })
            : []}
          @dp-sidebar-select=${(e: DpSidebarSelectEvent) => this.onSidebarSelect(e)}
        >
          <ll-mark slot="icon" size="20" label=""></ll-mark>
        </dp-sidebar>
        <dp-toolbar
          slot="toolbar"
          heading=${info?.name ?? strings.appName}
          subtitle=${this.heading()}
          show-toggle
          toggle-label=${strings.toggleSidebar}
          @dp-toolbar-toggle=${() => (this.sidebarOpen = !this.sidebarOpen)}
        >
          <dc-button slot="actions" variant="secondary" size="sm" @click=${this.openVault}>${strings.openVault}</dc-button>
        </dp-toolbar>
        <dp-page>
          ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
          ${this.notice ? html`<p class="notice" role="status">${this.notice}</p>` : ''}
          ${!info
            ? html`<div class="welcome">
                <ll-mark variant="wordmark" size="96" intro></ll-mark>
                <p class="tagline">${strings.tagline}</p>
                <p>${strings.noVault}</p>
                <div class="choices">
                  <dc-button @click=${this.newVault}>${strings.newVault}</dc-button>
                  <dc-button variant="secondary" @click=${this.openVault}>${strings.openFolder}</dc-button>
                </div>
              </div>`
            : this.renderPlace(info)}
        </dp-page>
      </dp-shell>
      <dc-confirm-dialog
        heading=${strings.unsavedHeading}
        confirm-label=${strings.unsavedDiscard}
        cancel-label=${strings.unsavedKeep}
        danger
        .open=${this.asking}
        @confirm=${() => this.settle(true)}
        @cancel=${() => this.settle(false)}
        >${strings.unsavedBody}</dc-confirm-dialog
      >
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'll-app': LlApp
  }
}
