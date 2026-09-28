import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { open } from '@tauri-apps/plugin-dialog'
import type { DpSidebarSelectEvent } from '@iyulab/desktop-patterns/sidebar'
import { describeError } from './errors.js'
import { strings } from './strings.js'
import { vault, type VaultInfo } from './vault-client.js'
import './templates-view.js'
import './documents-view.js'

type View = 'templates' | 'documents'

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
  `

  @state() private view: View = 'templates'
  @state() private sidebarOpen = true
  @state() private vaultInfo?: VaultInfo
  @state() private error = ''

  private async openVault() {
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
          ]}
          @dp-sidebar-select=${(e: DpSidebarSelectEvent) => (this.view = e.itemId as View)}
        ></dp-sidebar>
        <dp-toolbar
          slot="toolbar"
          heading=${this.view === 'templates' ? strings.navTemplates : strings.navDocuments}
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
            ? html`<dc-empty-state description=${strings.noVault}></dc-empty-state>`
            : this.view === 'templates'
              ? html`<ll-templates .vaultInfo=${info}></ll-templates>`
              : html`<ll-documents .vaultInfo=${info}></ll-documents>`}
        </dp-page>
      </dp-shell>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'll-app': LlApp
  }
}
