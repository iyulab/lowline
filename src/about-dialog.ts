import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { getVersion } from '@tauri-apps/api/app'
import { strings } from './strings.js'
import { about } from './vault-client.js'

/**
 * What Lowline is and under which terms: its version, its copyright and license, where its source is, and the
 * notices of the software it ships with — the notices read only when the person opens them.
 */
@customElement('ll-about')
export class LlAbout extends LitElement {
  static styles = css`
    dc-dialog {
      --dc-dialog-max-width: 560px;
    }
    h2 {
      margin: 0 0 var(--dc-space-1, 4px);
      font-size: 1.1em;
    }
    p {
      margin: 0 0 var(--dc-space-3, 12px);
    }
    .muted {
      color: var(--dc-color-text-muted, #666);
    }
    .source {
      user-select: text;
    }
    details {
      margin-bottom: var(--dc-space-3, 12px);
    }
    summary {
      cursor: pointer;
    }
    pre {
      max-height: 40vh;
      overflow: auto;
      margin: var(--dc-space-2, 8px) 0 0;
      padding: var(--dc-space-2, 8px);
      border: 1px solid var(--dc-color-border, #e2e2e4);
      border-radius: var(--dc-radius-md, 6px);
      font-size: 0.85em;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      user-select: text;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
    }
  `

  @property({ type: Boolean }) open = false
  @state() private version?: string
  @state() private notices?: string | 'loading' | 'failed'

  protected updated(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open && this.version === undefined)
      getVersion().then(
        (v) => (this.version = v),
        () => (this.version = ''),
      )
  }

  private async showNotices() {
    if (this.notices !== undefined && this.notices !== 'failed') return
    this.notices = 'loading'
    try {
      this.notices = await about.notices()
    } catch {
      this.notices = 'failed'
    }
  }

  private close() {
    this.open = false
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  render() {
    const notices = this.notices
    return html`<dc-dialog aria-label=${strings.about} .open=${this.open} @close=${() => this.close()}>
      <h2>${strings.appName}</h2>
      <p class="muted">${this.version ? strings.aboutVersion(this.version) : nothing} · ${strings.aboutCopyright}</p>
      <p>${strings.aboutLicense}</p>
      <p>${strings.aboutSource}: <span class="source">${strings.aboutSourceUrl}</span></p>
      <details @toggle=${(e: Event) => (e.target as HTMLDetailsElement).open && void this.showNotices()}>
        <summary>${strings.aboutNotices}</summary>
        ${notices === undefined || notices === 'loading'
          ? html`<p class="muted" role="status">${strings.aboutNoticesLoading}</p>`
          : notices === 'failed'
            ? html`<p class="muted" role="status">${strings.aboutNoticesFailed}</p>`
            : html`<pre>${notices}</pre>`}
      </details>
      <div class="actions"><dc-button variant="secondary" @click=${() => this.close()}>${strings.aboutClose}</dc-button></div>
    </dc-dialog>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'll-about': LlAbout
  }
}
