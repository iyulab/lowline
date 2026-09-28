import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { createDocumentFile } from './document-files.js'
import { documentTitle, newDocument } from './documents.js'
import { describeError } from './errors.js'
import { importFields, planImport, type ImportField, type ImportPlan } from './import.js'
import { strings } from './strings.js'
import { vault, type VaultEntry, type VaultInfo } from './vault-client.js'

/** How many values that do not fit are listed; the rest are counted. */
const PROBLEMS_SHOWN = 10

/**
 * Brings existing records in: rows copied from a spreadsheet, the first naming the columns,
 * become documents of the chosen template. Nothing is written until the person confirms what the
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
  @property({ attribute: false }) templates: VaultEntry[] = []

  @state() private templatePath = ''
  @state() private templateSource = ''
  @state() private fields: ImportField[] = []
  @state() private plan?: ImportPlan
  @state() private busy = false
  @state() private error = ''

  private async chooseTemplate(path: string) {
    this.error = ''
    this.plan = undefined
    this.templatePath = path
    if (!path) return
    try {
      this.templateSource = await vault.read(path)
      this.fields = importFields(this.templateSource)
    } catch (e) {
      this.error = describeError(e)
    }
  }

  private onRows(e: CustomEvent<{ rows: string[][] }>) {
    this.error = ''
    this.plan = planImport(e.detail.rows, this.fields)
  }

  private label(field: string | undefined): string {
    return this.fields.find((f) => f.name === field)?.label ?? ''
  }

  private async importDocuments() {
    const plan = this.plan
    if (!plan || plan.documents.length === 0) return
    this.busy = true
    this.error = ''
    let created = 0
    try {
      const date = new Date()
      for (const values of plan.documents) {
        const source = newDocument(this.templateSource, values)
        await createDocumentFile(this.vaultInfo.documentsDir, source, documentTitle(this.templateSource, values), date)
        created++
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
        <label for="import-template">${strings.importTemplate}</label>
        <select id="import-template" @change=${(e: Event) => this.chooseTemplate((e.target as HTMLSelectElement).value)}>
          <option value="">${strings.pickTemplate}</option>
          ${this.templates.map((t) => html`<option value=${t.path}>${t.name.replace(/\.fd\.md$/, '')}</option>`)}
        </select>
        <dc-button size="sm" variant="ghost" @click=${this.cancel}>${strings.cancel}</dc-button>
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
            (c) => html`<tr>
              <td>${c.heading}</td>
              <td class=${c.field ? '' : 'unmatched'}>${c.field ? this.label(c.field) : strings.importUnmatched}</td>
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
          >${strings.importConfirm(plan.documents.length)}</dc-button
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
