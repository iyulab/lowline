import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { fileName } from './documents.js'
import { describeError } from './errors.js'
import { DATE_TYPES, PATH_COLUMN, cellText, type ColumnFilter, type IngestResult, type ProjectionTable, type TemplateField, type TemplateSnapshot } from './projection.js'
import { strings } from './strings.js'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { tableCsv } from './export.js'
import { host, onVaultChanged, vault, type VaultChanged, type VaultInfo } from './vault-client.js'
import { SidecarUnavailable, syncVault } from './vault-snapshot.js'

/** How long typing into a filter pauses before the table is asked for again. */
const FILTER_DELAY_MS = 250

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
    .bar,
    .filters {
      display: flex;
      align-items: center;
      gap: var(--dc-space-2, 8px);
    }
    /* One row of compact controls above the table, wrapping only when the window is narrow. */
    .filters {
      flex-wrap: wrap;
    }
    .filters > * {
      flex: 0 1 11rem;
      min-width: 8rem;
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
    .skipped summary {
      cursor: pointer;
    }
    .skipped ul {
      margin: var(--dc-space-1, 4px) 0 0;
      padding: 0;
      list-style: none;
    }
  `

  @property({ attribute: false }) vaultInfo!: VaultInfo
  /** The template whose documents the table shows, by `id@version`. */
  @property({ attribute: false }) template!: string

  @state() private templates: TemplateSnapshot[] = []
  /** The template whose table is showing or on its way. */
  private selected?: string
  @state() private table?: ProjectionTable
  @state() private ingest?: IngestResult
  @state() private waiting = true
  @state() private error = ''
  /** What the last export wrote, said in place of the row count until the table changes. */
  @state() private exported = ''
  @state() private names = new Map<string, string>()
  /**
   * The table's filters, one per column and kind (`op:column`) — a name or a field's text it contains, a
   * choice field's value, a number field's lower and upper bound.
   */
  @state() private filters = new Map<string, ColumnFilter>()
  /** The text field whose text the text filter looks in. */
  @state() private textField = ''
  private filterTimer?: ReturnType<typeof setTimeout>

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

  willUpdate(changed: Map<string, unknown>) {
    // Another template picked while this one shows: its table, from the vault as last handed over.
    if (changed.has('template') && !this.waiting && this.template !== this.selected) {
      this.table = undefined
      this.filters = new Map()
      this.textField = ''
      void this.show(this.template)
    }
  }

  /** Reads the vault, hands it to the sidecar, and shows the template's table. */
  private async load(change?: VaultChanged) {
    this.error = ''
    try {
      const synced = await syncVault(change)
      this.templates = synced.templates
      this.names = synced.names
      this.ingest = synced.ingest
      this.waiting = false
      await this.show(this.template)
    } catch (e) {
      this.waiting = false
      this.error = e instanceof SidecarUnavailable ? strings.hostFailed(e.message) : describeError(e)
    }
  }

  private async show(template: string) {
    this.selected = template
    this.exported = ''
    try {
      const table = await host.projection(template, [...this.filters.values()])
      // Another template may have been picked while this one loaded: its table wins.
      if (this.selected === template) this.table = table
    } catch (e) {
      if (this.selected === template) this.error = describeError(e)
    }
  }

  /**
   * Saves the table as CSV where the person picks, named after the template. What was written is said
   * in the bar; a closed dialog says nothing.
   */
  private async exportTable() {
    const table = this.table
    if (!table) return
    this.exported = ''
    this.error = ''
    try {
      const name = `${this.names.get(table.template) ?? table.template}.csv`.replace(/[\\/:*?"<>|]/g, ' ')
      const file = await vault.exportFile(name, tableCsv(table, (f) => this.label(f), strings.tableExportDocument), strings.tableExportFilter, 'csv')
      if (file) this.exported = strings.tableExported(file)
    } catch (e) {
      this.error = describeError(e)
    }
  }

  /**
   * Sets one column's filter (none for an empty value) and asks for the table again once typing pauses —
   * the sidecar answers it from the projection.
   */
  private filter(column: string, op: ColumnFilter['op'], value: string) {
    const next = new Map(this.filters)
    if (value.trim()) next.set(`${op}:${column}`, { column, op, value: value.trim() })
    else next.delete(`${op}:${column}`)
    this.filters = next
    clearTimeout(this.filterTimer)
    this.filterTimer = setTimeout(() => void this.show(this.template), FILTER_DELAY_MS)
  }

  /** Moves the text filter to another field, keeping what was typed. */
  private pickTextField(field: string) {
    const typed = this.filters.get(`contains:${this.textField}`)?.value ?? ''
    if (this.textField) this.filter(this.textField, 'contains', '')
    this.textField = field
    if (typed) this.filter(field, 'contains', typed)
  }

  /**
   * Filters the template's fields allow: its name, each choice field's value, text within one text field,
   * and each number field's bounds.
   */
  private renderFilters(template: TemplateSnapshot | undefined) {
    if (!template) return nothing
    const choices = template.fields.filter((f) => (f.type === 'select' || f.type === 'radio') && f.options.length > 0)
    // Every other field but checkboxes, numbers and dates is text to the projection.
    const texts = template.fields.filter(
      (f) => !choices.includes(f) && !['checkbox', 'number', 'range', ...DATE_TYPES].includes(f.type),
    )
    const numbers = template.fields.filter((f) => f.type === 'number' || f.type === 'range')
    const dates = template.fields.filter((f) => DATE_TYPES.includes(f.type))
    const textField = this.textField || texts[0]?.name || ''
    const value = (column: string, op: ColumnFilter['op']) => this.filters.get(`${op}:${column}`)?.value ?? ''
    const input = (e: Event) => (e.target as HTMLInputElement).value
    return html`<div class="filters" role="search" aria-label=${strings.tableFilters}>
      <dc-input
        size="sm"
        type="search"
        aria-label=${strings.tableFilterName}
        placeholder=${strings.tableFilterName}
        .value=${value(PATH_COLUMN, 'contains')}
        @input=${(e: Event) => this.filter(PATH_COLUMN, 'contains', input(e))}
      ></dc-input>
      ${choices.map(
        (f: TemplateField) => html`<dc-select
          size="sm"
          aria-label=${f.label}
          .value=${value(f.name, 'equal')}
          .options=${[{ value: '', label: strings.tableFilterAny(f.label) }, ...f.options.map((o) => ({ value: o, label: o }))]}
          @change=${(e: Event) => this.filter(f.name, 'equal', input(e))}
        ></dc-select>`,
      )}
      ${texts.length > 0
        ? html`<dc-select
              size="sm"
              aria-label=${strings.tableFilterField}
              .value=${textField}
              .options=${texts.map((f) => ({ value: f.name, label: f.label }))}
              @change=${(e: Event) => this.pickTextField(input(e))}
            ></dc-select>
            <dc-input
              size="sm"
              type="search"
              aria-label=${strings.tableFilterText}
              placeholder=${strings.tableFilterText}
              .value=${value(textField, 'contains')}
              @input=${(e: Event) => {
                this.textField = textField
                this.filter(textField, 'contains', input(e))
              }}
            ></dc-input>`
        : nothing}
      ${numbers.map(
        (f: TemplateField) => html`<dc-input
            size="sm"
            type="number"
            aria-label=${strings.tableFilterAtLeast(f.label)}
            placeholder=${strings.tableFilterAtLeast(f.label)}
            .value=${value(f.name, 'atLeast')}
            @input=${(e: Event) => this.filter(f.name, 'atLeast', input(e))}
          ></dc-input>
          <dc-input
            size="sm"
            type="number"
            aria-label=${strings.tableFilterAtMost(f.label)}
            placeholder=${strings.tableFilterAtMost(f.label)}
            .value=${value(f.name, 'atMost')}
            @input=${(e: Event) => this.filter(f.name, 'atMost', input(e))}
          ></dc-input>`,
      )}
      ${dates.map(
        (f: TemplateField) => html`<dc-input
            size="sm"
            type=${f.type as 'date' | 'datetime-local'}
            aria-label=${strings.tableFilterFrom(f.label)}
            title=${strings.tableFilterFrom(f.label)}
            .value=${value(f.name, 'atLeast')}
            @input=${(e: Event) => this.filter(f.name, 'atLeast', input(e))}
          ></dc-input>
          <dc-input
            size="sm"
            type=${f.type as 'date' | 'datetime-local'}
            aria-label=${strings.tableFilterUntil(f.label)}
            title=${strings.tableFilterUntil(f.label)}
            .value=${value(f.name, 'atMost')}
            @input=${(e: Event) => this.filter(f.name, 'atMost', input(e))}
          ></dc-input>`,
      )}
    </div>`
  }

  /**
   * The fields of this template's rows left empty because their value could not be read as the field's
   * type — each names its document, which opens to fix it.
   */
  private renderSkippedFields() {
    const fields = (this.ingest?.skippedFields ?? []).filter((s) => s.template === this.selected)
    if (!fields.length) return nothing
    return html`<details class="skipped">
      <summary class="error">${strings.tableSkippedFields(fields.length)}</summary>
      <ul>
        ${fields.map(
          (s) => html`<li>
            <dc-button size="sm" variant="ghost" title=${s.reason} @click=${() => this.openRow(s.path)}
              >${strings.tableSkippedField(fileName(s.path, '.md'), this.label(s.field))}</dc-button
            >
          </li>`,
        )}
      </ul>
    </details>`
  }

  /** Asks for a row's document to be opened. */
  private openRow(path: string) {
    this.dispatchEvent(new CustomEvent('ll-open-document', { detail: { path, template: this.selected }, bubbles: true, composed: true }))
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
    const filtered = this.filters.size > 0
    return html`
      ${this.renderFilters(this.templates.find((t) => t.ref === this.template))}
      <div class="bar">
        ${table
          ? html`<span class="message" role="status"
              >${this.exported || (filtered ? strings.tableMatching(table.rows.length) : strings.tableCount(table.rows.length))}</span
            >`
          : nothing}
        ${table && table.rows.length
          ? html`<dc-button size="sm" variant="secondary" @click=${() => void this.exportTable()}>${strings.tableExport}</dc-button>`
          : nothing}
        ${skipped ? html`<span class="error">${strings.tableSkipped(skipped)}</span>` : nothing}
      </div>
      ${this.renderSkippedFields()}
      ${table
        ? html`<dc-data-table
            .columns=${table.columns.map((c) => ({ key: c.name, label: this.label(c.name) }))}
            .rows=${table.rows.map((row) => ({
              id: row.path,
              cells: Object.fromEntries(
                table.columns.map((c, i) => [c.name, cellText(row.values[c.name]) || (i === 0 ? fileName(row.path, '.md') : '')]),
              ),
            }))}
            empty-label=${filtered ? strings.tableNoMatch : strings.tableEmpty}
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
