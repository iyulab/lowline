import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { TemplateError } from './documents.js'
import { describeError } from './errors.js'
import {
  cellText,
  documentSnapshot,
  templateSnapshot,
  type DocumentSnapshot,
  type IngestResult,
  type ProjectionTable,
  type TemplateSnapshot,
} from './projection.js'
import { strings } from './strings.js'
import { host, vault, type VaultInfo } from './vault-client.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A template's documents as a table, projected by the sidecar from what is in the vault now. */
@customElement('ll-table')
export class LlTable extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-3, 12px);
      min-height: 0;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: var(--dc-space-2, 8px);
    }
    select {
      font: inherit;
      padding: var(--dc-space-1, 4px);
    }
    .scroll {
      overflow: auto;
      border: 1px solid var(--dc-color-border, #d0d0d0);
      border-radius: var(--dc-radius-md, 6px);
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 13px;
    }
    th,
    td {
      text-align: left;
      padding: var(--dc-space-2, 8px);
      border-bottom: 1px solid var(--dc-color-border, #e4e4e4);
      white-space: pre-line;
      vertical-align: top;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--dc-color-bg-subtle, #f4f4f4);
      font-weight: 600;
    }
    .message {
      color: var(--dc-color-text-muted, #666);
    }
    .error {
      color: var(--dc-color-danger, #b00020);
    }
  `

  @property({ attribute: false }) vaultInfo!: VaultInfo

  @state() private templates: TemplateSnapshot[] = []
  /** Each template's name as the vault shows it (its file name), by reference. */
  @state() private names = new Map<string, string>()
  @state() private selected?: string
  @state() private table?: ProjectionTable
  @state() private ingest?: IngestResult
  @state() private waiting = true
  @state() private error = ''

  connectedCallback() {
    super.connectedCallback()
    void this.load()
  }

  /** Reads the vault, hands it to the sidecar, and shows the first template's table. */
  private async load() {
    this.error = ''
    try {
      await this.sidecarReady()
      const snapshot = await this.snapshot()
      this.templates = snapshot.templates
      this.ingest = await host.ingest(snapshot)
      this.waiting = false
      const first = this.selected ?? this.templates[0]?.ref
      if (first) await this.show(first)
    } catch (e) {
      this.waiting = false
      this.error = typeof e === 'string' ? strings.hostFailed(e) : describeError(e)
    }
  }

  private async sidecarReady() {
    for (;;) {
      const status = await host.status()
      if (status.state === 'ready') return
      if (status.state === 'failed') throw status.message
      await sleep(200)
    }
  }

  private async snapshot() {
    const [templateEntries, documentEntries] = await Promise.all([vault.listTemplates(), vault.listDocuments()])
    const templates: TemplateSnapshot[] = []
    const names = new Map<string, string>()
    for (const entry of templateEntries) {
      try {
        const template = templateSnapshot(await vault.read(entry.path))
        templates.push(template)
        names.set(template.ref, entry.name.replace(/\.fd\.md$/, ''))
      } catch (e) {
        if (!(e instanceof TemplateError)) throw e // a template without an identity has no table
      }
    }
    const documents: DocumentSnapshot[] = []
    for (const entry of documentEntries) {
      const document = documentSnapshot(entry.path, await vault.read(entry.path))
      if (document) documents.push(document)
    }
    this.names = names
    return { templates, documents }
  }

  private async show(template: string) {
    this.selected = template
    try {
      this.table = await host.projection(template)
    } catch (e) {
      this.error = describeError(e)
    }
  }

  /** A column's heading: the field's label in the selected template. */
  private label(field: string): string {
    return this.templates.find((t) => t.ref === this.selected)?.fields.find((f) => f.name === field)?.label ?? field
  }

  render() {
    if (this.error) return html`<p class="error" role="alert">${this.error}</p>`
    if (this.waiting) return html`<p class="message" role="status">${strings.hostStarting}</p>`
    const table = this.table
    const skipped = this.ingest?.skipped.length ?? 0
    return html`
      <div class="bar">
        <label for="template">${strings.tableTemplate}</label>
        <select id="template" @change=${(e: Event) => this.show((e.target as HTMLSelectElement).value)}>
          ${this.templates.map(
            (t) => html`<option value=${t.ref} ?selected=${t.ref === this.selected}>${this.names.get(t.ref) ?? t.ref}</option>`,
          )}
        </select>
        ${table ? html`<span class="message" role="status">${strings.tableCount(table.rows.length)}</span>` : nothing}
        ${skipped ? html`<span class="error">${strings.tableSkipped(skipped)}</span>` : nothing}
      </div>
      ${table && table.rows.length === 0 ? html`<p class="message">${strings.tableEmpty}</p>` : nothing}
      ${table && table.rows.length > 0
        ? html`<div class="scroll">
            <table>
              <thead>
                <tr>
                  ${table.columns.map((c) => html`<th scope="col">${this.label(c.name)}</th>`)}
                </tr>
              </thead>
              <tbody>
                ${table.rows.map(
                  (row) => html`<tr data-path=${row.path}>
                    ${table.columns.map((c) => html`<td>${cellText(row.values[c.name])}</td>`)}
                  </tr>`,
                )}
              </tbody>
            </table>
          </div>`
        : nothing}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'll-table': LlTable
  }
}
