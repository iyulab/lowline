import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { describeError } from './errors.js'
import { cellText, type IngestResult, type ProjectionTable, type TemplateSnapshot } from './projection.js'
import { strings } from './strings.js'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { host, onVaultChanged, type VaultChanged, type VaultInfo } from './vault-client.js'
import { SidecarUnavailable, syncVault } from './vault-snapshot.js'

/** A document's name as the vault shows it: its file name without the extension. */
function documentName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '')
}

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
    dc-data-table {
      font-size: 13px;
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

  private unlisten?: Promise<UnlistenFn>

  connectedCallback() {
    super.connectedCallback()
    void this.load()
    // Another program changed the vault: the table is projected again from what is there now.
    this.unlisten = onVaultChanged((change) => void this.load(change))
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    void this.unlisten?.then((stop) => stop())
  }

  /** Reads the vault, hands it to the sidecar, and shows the first template's table. */
  private async load(change?: VaultChanged) {
    this.error = ''
    try {
      const synced = await syncVault(change)
      this.templates = synced.templates
      this.names = synced.names
      this.ingest = synced.ingest
      this.waiting = false
      const first = this.selected ?? this.templates[0]?.ref
      if (first) await this.show(first)
    } catch (e) {
      this.waiting = false
      this.error = e instanceof SidecarUnavailable ? strings.hostFailed(e.message) : describeError(e)
    }
  }

  private async show(template: string) {
    this.selected = template
    try {
      const table = await host.projection(template)
      // Another template may have been picked while this one loaded: its table wins.
      if (this.selected === template) this.table = table
    } catch (e) {
      if (this.selected === template) this.error = describeError(e)
    }
  }

  /** Asks for a row's document to be opened. */
  private openRow(path: string) {
    this.dispatchEvent(new CustomEvent('ll-open-document', { detail: { path }, bubbles: true, composed: true }))
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
      ${table
        ? html`<dc-data-table
            .columns=${table.columns.map((c) => ({ key: c.name, label: this.label(c.name) }))}
            .rows=${table.rows.map((row) => ({
              id: row.path,
              cells: Object.fromEntries(
                table.columns.map((c, i) => [c.name, cellText(row.values[c.name]) || (i === 0 ? documentName(row.path) : '')]),
              ),
            }))}
            empty-label=${strings.tableEmpty}
            @activate=${(e: CustomEvent<{ id: string }>) => this.openRow(e.detail.id)}
          ></dc-data-table>`
        : nothing}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'll-table': LlTable
  }
}
