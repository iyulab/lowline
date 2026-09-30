import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { createDocumentFile } from './document-files.js'
import { documentTitle, newDocument } from './documents.js'
import { newDocumentId } from './identity.js'
import { describeError } from './errors.js'
import { importFields, planImport, type ColumnUse, type ImportField, type ImportPlan } from './import.js'
import { strings } from './strings.js'
import type { TemplateItem } from './template-scope.js'
import { vault, type VaultInfo } from './vault-client.js'

/** How many values that do not fit are listed; the rest are counted. */
const PROBLEMS_SHOWN = 10

/**
 * Brings existing records in: rows copied from a spreadsheet, the first naming the columns,
 * become documents of the template. Nothing is written until the person confirms what the
 * preview shows.
 */
@customElement('ll-import')
export class LlImport extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-3, 12px);
      font-size: 13px;
    }
    p {
      margin: 0;
    }
    h2 {
      margin: 0;
      font-size: 15px;
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
    dc-paste-rows-zone {
      --dc-font-size-sm: 13px;
    }
    table {
      border-collapse: collapse;
      font-size: 13px;
    }
    th,
    td {
      text-align: left;
      padding: var(--dc-space-1, 4px) var(--dc-space-3, 12px) var(--dc-space-1, 4px) 0;
    }
    .unmatched {
      color: var(--dc-color-text-muted, #666);
    }
    ul {
      margin: 0;
      padding-left: 1.2em;
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
  /** The template the rows become documents of. */
  @property({ attribute: false }) template!: TemplateItem

  @state() private templatePath = ''
  @state() private templateSource = ''
  @state() private fields: ImportField[] = []
  @state() private plan?: ImportPlan
  /** The pasted rows, kept to plan again when the person changes what a column is kept for. */
  private rows: string[][] = []
  @state() private busy = false
  /** Documents created so far in the running import. */
  @state() private created = 0
  @state() private error = ''

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('template') && this.template.path !== this.templatePath) void this.readTemplate(this.template.path)
  }

  private async readTemplate(path: string) {
    this.error = ''
    this.plan = undefined
    this.templatePath = path
    this.fields = []
    try {
      this.templateSource = await vault.read(path)
      this.fields = importFields(this.templateSource)
    } catch (e) {
      this.error = describeError(e)
    }
  }

  private onRows(e: CustomEvent<{ rows: string[][] }>) {
    this.error = ''
    this.rows = e.detail.rows
    this.plan = planImport(this.rows, this.fields)
  }

  /** A column that fills no field is kept for `use` — one column for each use. */
  private keepFor(index: number, use: ColumnUse | undefined) {
    if (!this.plan) return
    const uses = this.plan.columns.map((c, i) => (i === index ? use : c.use === use ? undefined : c.use))
    this.plan = planImport(this.rows, this.fields, uses)
  }

  /** A field's label; a problem about a day names the column, which is no field. */
  private label(field: string | undefined): string {
    return this.fields.find((f) => f.name === field)?.label ?? field ?? ''
  }

  private async importDocuments() {
    const plan = this.plan
    if (!plan || plan.documents.length === 0) return
    this.busy = true
    this.error = ''
    this.created = 0
    let created = 0
    try {
      const today = new Date()
      for (const record of plan.documents) {
        const source = newDocument(this.templateSource, record.values, newDocumentId())
        // Named as the record was: its own day, and its code before the title the fields give.
        const title = [record.name, documentTitle(this.templateSource, record.values)].filter(Boolean).join(' ') || undefined
        await createDocumentFile(this.vaultInfo.documentsDir, source, title, record.date ?? today)
        created++
        this.created = created
      }
      this.dispatchEvent(new CustomEvent('ll-imported', { detail: { created }, bubbles: true, composed: true }))
    } catch (e) {
      // What was created stays: each document is a file of its own.
      this.error = strings.importStopped(created, describeError(e))
      this.plan = undefined
    } finally {
      this.busy = false
    }
  }

  private cancel() {
    this.dispatchEvent(new CustomEvent('ll-import-cancel', { bubbles: true, composed: true }))
  }

  render() {
    const plan = this.plan
    return html`
      <h2>${strings.importTitle}</h2>
      <div class="bar">
        <dc-button size="sm" variant="ghost" ?disabled=${this.busy} @click=${this.cancel}>${strings.cancel}</dc-button>
      </div>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      ${this.templatePath && this.fields.length
        ? html`<p class="message">${strings.importHint}</p>
            <dc-paste-rows-zone placeholder=${strings.importPaste} @rows=${this.onRows}></dc-paste-rows-zone>`
        : nothing}
      ${plan ? this.renderPlan(plan) : nothing}
    `
  }

  private renderPlan(plan: ImportPlan) {
    const problems = plan.problems
    return html`
      <table>
        <thead>
          <tr>
            <th scope="col">${strings.importColumn}</th>
            <th scope="col">${strings.importField}</th>
          </tr>
        </thead>
        <tbody>
          ${plan.columns.map(
            (c, i) => html`<tr>
              <td>${c.heading}</td>
              <td class=${c.field || c.use ? '' : 'unmatched'}>
                ${c.field
                  ? this.label(c.field)
                  : html`<select
                      aria-label=${strings.importUseOf(c.heading)}
                      .value=${c.use ?? ''}
                      @change=${(e: Event) => this.keepFor(i, ((e.target as HTMLSelectElement).value || undefined) as ColumnUse | undefined)}
                    >
                      <option value="" ?selected=${!c.use}>${strings.importUnmatched}</option>
                      <option value="date" ?selected=${c.use === 'date'}>${strings.importUseDate}</option>
                      <option value="name" ?selected=${c.use === 'name'}>${strings.importUseName}</option>
                    </select>`}
              </td>
            </tr>`,
          )}
        </tbody>
      </table>
      <p class="message" role="status">${strings.importSummary(plan.documents.length, plan.skipped)}</p>
      ${problems.length
        ? html`<p>${strings.importProblems(problems.length)}</p>
            <ul>
              ${problems
                .slice(0, PROBLEMS_SHOWN)
                .map((p) => html`<li>${strings.importProblem(p.row, this.label(p.field), p.value)}</li>`)}
            </ul>`
        : nothing}
      <div class="bar">
        <dc-button
          size="sm"
          ?disabled=${this.busy || plan.documents.length === 0}
          @click=${this.importDocuments}
          >${this.busy
            ? strings.importing(this.created, plan.documents.length)
            : strings.importConfirm(plan.documents.length)}</dc-button
        >
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'll-import': LlImport
  }
}
