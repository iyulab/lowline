import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { guard } from 'lit/directives/guard.js'
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
import { strings } from './strings.js'
import { vault, type VaultEntry, type VaultInfo } from './vault-client.js'

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
    } catch (e) {
      this.error = describeError(e)
    }
  }

  private reset() {
    this.error = ''
    this.message = ''
    this.dirty = false
  }

  private async startNew(templatePath: string) {
    this.reset()
    try {
      const templateSource = await vault.read(templatePath)
      const { ref } = templateInfo(templateSource)
      this.values = this.initialValues = {}
      this.draft = { kind: 'new', templateSource, templateRef: ref }
      this.opened++
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
      this.dirty = false
      this.message = strings.saved
      this.dispatchEvent(new CustomEvent('ll-confirmed', { bubbles: true, composed: true }))
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
                ${draft.templateRef ? html`<span class="message">${strings.documentFrom(draft.templateRef)}</span>` : nothing}
                ${this.error
                  ? html`<span class="error" role="alert">${this.error}</span>`
                  : html`<span class="message" role="status">${this.message}</span>`}
              </div>
              <formdown-ui
                .content=${draft.kind === 'new' ? templateBody(draft.templateSource) : draft.source}
                .data=${guard([this.opened], () => this.initialValues)}
                .showSubmitButton=${false}
                @formdown-data-update=${this.onData}
              ></formdown-ui>
            `
          : this.error
            ? html`<p class="error" role="alert">${this.error}</p>`
            : nothing}
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'll-documents': LlDocuments
  }
}
