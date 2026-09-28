import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { templateInfo } from './documents.js'
import { describeError } from './errors.js'
import { starterTemplate, strings } from './strings.js'
import { vault, type VaultEntry, type VaultInfo } from './vault-client.js'

/** Templates: pick one, edit its Formdown source next to a live preview, save. */
@customElement('ll-templates')
export class LlTemplates extends LitElement {
  static styles = css`
    :host {
      display: grid;
      grid-template-columns: 14rem 1fr 1fr;
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
    section {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-2, 8px);
      min-height: 0;
    }
    textarea {
      flex: 1;
      min-height: 20rem;
      font-family: var(--dc-font-mono, ui-monospace, monospace);
      font-size: 13px;
      padding: var(--dc-space-2, 8px);
      resize: none;
    }
    .preview {
      flex: 1;
      overflow: auto;
      border: 1px solid var(--dc-color-border, #d0d0d0);
      border-radius: var(--dc-radius-md, 6px);
      padding: var(--dc-space-3, 12px);
    }
    .bar {
      display: flex;
      align-items: center;
      gap: var(--dc-space-2, 8px);
    }
    .message {
      color: var(--dc-color-text-muted, #666);
    }
    .error {
      color: var(--dc-color-danger, #b00020);
    }
    h3 {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
    }
  `

  @property({ attribute: false }) vaultInfo!: VaultInfo

  @state() private entries: VaultEntry[] = []
  @state() private selected?: string
  @state() private source = ''
  @state() private dirty = false
  @state() private message = ''
  @state() private error = ''

  connectedCallback() {
    super.connectedCallback()
    void this.refresh()
  }

  private async refresh() {
    try {
      this.entries = await vault.listTemplates()
      if (!this.selected && this.entries.length > 0) await this.select(this.entries[0].path)
    } catch (e) {
      this.error = describeError(e)
    }
  }

  private async select(path: string) {
    this.error = ''
    this.message = ''
    this.source = await vault.read(path)
    this.selected = path
    this.dirty = false
  }

  private async save() {
    if (!this.selected) return
    this.error = ''
    try {
      templateInfo(this.source) // a template must name itself
      await vault.write(this.selected, this.source)
      this.dirty = false
      this.message = strings.saved
    } catch (e) {
      this.error = describeError(e)
    }
  }

  private async create() {
    this.error = ''
    const id = `template-${Date.now().toString(36)}`
    const dir = this.vaultInfo.templatesDir
    for (let attempt = 1; attempt < 100; attempt++) {
      const name = attempt === 1 ? strings.newTemplateName : `${strings.newTemplateName} ${attempt}`
      const path = `${dir}/${name}.fd.md`
      try {
        await vault.create(path, starterTemplate(id))
        this.selected = undefined
        await this.refresh()
        await this.select(path)
        return
      } catch (e) {
        if ((e as { kind?: string }).kind !== 'already-exists') {
          this.error = describeError(e)
          return
        }
      }
    }
  }

  render() {
    return html`
      <nav aria-label=${strings.navTemplates}>
        <dc-button variant="secondary" size="sm" @click=${this.create}>${strings.newTemplate}</dc-button>
        ${this.entries.length === 0
          ? html`<p class="message">${strings.noTemplates}</p>`
          : this.entries.map(
              (e) => html`<button aria-current=${e.path === this.selected} @click=${() => this.select(e.path)}>
                ${e.name.replace(/\.fd\.md$/, '')}
              </button>`,
            )}
      </nav>
      ${this.selected
        ? html`
            <section>
              <div class="bar">
                <h3>${strings.templateSource}</h3>
                <dc-button size="sm" ?disabled=${!this.dirty} @click=${this.save}>${strings.save}</dc-button>
                ${this.error
                  ? html`<span class="error" role="alert">${this.error}</span>`
                  : html`<span class="message" role="status">${this.message}</span>`}
              </div>
              <textarea
                spellcheck="false"
                aria-label=${strings.templateSource}
                .value=${this.source}
                @input=${(e: InputEvent) => {
                  this.source = (e.target as HTMLTextAreaElement).value
                  this.dirty = true
                  this.message = ''
                }}
                @keydown=${(e: KeyboardEvent) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault()
                    void this.save()
                  }
                }}
              ></textarea>
            </section>
            <section>
              <h3>${strings.preview}</h3>
              <div class="preview">
                <formdown-ui .content=${this.source} .showSubmitButton=${false}></formdown-ui>
              </div>
            </section>
          `
        : nothing}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'll-templates': LlTemplates
  }
}
