import { LitElement, css, html } from 'lit'
import { customElement, queryAll, state } from 'lit/decorators.js'
import { open } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { DpSidebarSelectEvent } from '@iyulab/desktop-patterns/sidebar'
import type { LlMark } from './brand/mark.js'
import { describeError } from './errors.js'
import { strings } from './strings.js'
import { vault, type VaultInfo } from './vault-client.js'
import { confirmDiscard, hasUnsaved, setDiscardQuestion } from './unsaved.js'
import './templates-view.js'
import './documents-view.js'
import './table-view.js'
import './learning-view.js'

type View = 'templates' | 'documents' | 'table' | 'learning'

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
    .error {
      color: var(--dc-color-danger, #b00020);
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
    .tagline {
      font-size: 17px;
      letter-spacing: 0.01em;
    }
  `

  @state() private view: View = 'templates'
  @state() private sidebarOpen = true
  @state() private vaultInfo?: VaultInfo
  @state() private error = ''
  /** A document to open in the documents view, asked for from elsewhere (a table row). */
  @state() private openPath?: string
  /** The unsaved-edits question is showing; the answer settles the promise it was asked with. */
  @state() private asking = false
  private answer?: (discard: boolean) => void
  @queryAll('ll-mark') private marks!: NodeListOf<LlMark>

  connectedCallback() {
    super.connectedCallback()
    // Typing holds the caret solid; a pause lets it blink again.
    this.addEventListener('keydown', () => this.marks.forEach((m) => m.hold()))
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
    this.addEventListener('ll-open-document', (e) => {
      this.openPath = (e as CustomEvent<{ path: string }>).detail.path
      this.view = 'documents'
    })
  }

  private settle(discard: boolean) {
    this.asking = false
    this.answer?.(discard)
    this.answer = undefined
  }

  private async switchTo(view: View) {
    if (view === this.view) return
    if (!(await confirmDiscard())) return this.requestUpdate() // the sidebar shows the view kept
    this.openPath = undefined
    this.view = view
  }

  private async openVault() {
    if (!(await confirmDiscard())) return
    const path = await open({ directory: true, title: strings.openVaultTitle })
    if (typeof path !== 'string') return
    try {
      this.vaultInfo = await vault.open(path)
      this.error = ''
    } catch (e) {
      this.error = describeError(e)
    }
  }

  render() {
    const info = this.vaultInfo
    return html`
      <dp-shell ?sidebar-open=${this.sidebarOpen}>
        <dp-sidebar
          slot="sidebar"
          header=${info?.name ?? strings.appName}
          nav-label=${strings.navLabel}
          active-id=${this.view}
          .items=${[
            { id: 'templates', icon: '▤', label: strings.navTemplates },
            { id: 'documents', icon: '▦', label: strings.navDocuments },
            { id: 'table', icon: '▥', label: strings.navTable },
            { id: 'learning', icon: '◔', label: strings.navLearning },
          ]}
          @dp-sidebar-select=${(e: DpSidebarSelectEvent) => void this.switchTo(e.itemId as View)}
        >
          <ll-mark slot="icon" size="20" label=""></ll-mark>
        </dp-sidebar>
        <dp-toolbar
          slot="toolbar"
          heading=${{ templates: strings.navTemplates, documents: strings.navDocuments, table: strings.navTable, learning: strings.navLearning }[this.view]}
          subtitle=${info?.root ?? ''}
          show-toggle
          toggle-label=${strings.toggleSidebar}
          @dp-toolbar-toggle=${() => (this.sidebarOpen = !this.sidebarOpen)}
        >
          <dc-button slot="actions" variant="secondary" size="sm" @click=${this.openVault}>${strings.openVault}</dc-button>
        </dp-toolbar>
        <dp-page>
          ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
          ${!info
            ? html`<div class="welcome">
                <ll-mark variant="wordmark" size="96"></ll-mark>
                <p class="tagline">${strings.tagline}</p>
                <p>${strings.noVault}</p>
                <dc-button @click=${this.openVault}>${strings.openVault}</dc-button>
              </div>`
            : this.view === 'templates'
              ? html`<ll-templates .vaultInfo=${info}></ll-templates>`
              : this.view === 'documents'
                ? html`<ll-documents .vaultInfo=${info} .openPath=${this.openPath}></ll-documents>`
                : this.view === 'table'
                  ? html`<ll-table .vaultInfo=${info}></ll-table>`
                  : html`<ll-learning .vaultInfo=${info}></ll-learning>`}
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
