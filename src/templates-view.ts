import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { formdownTheme } from './formdown-theme.js'
import { parseFormdown, readFrontMatter, setFieldAttribute } from '@formdown/core'
import { setSuggest, templateInfo } from './documents.js'
import { conflictNotice, noticeFor } from './conflicts.js'
import { describeError } from './errors.js'
import { markUnsaved } from './unsaved.js'
import { strings } from './strings.js'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { onVaultChanged, removedBy, touches, vault, type VaultChanged, type VaultEntry, type VaultInfo } from './vault-client.js'

/** A template: its Formdown source next to a live preview, saved in place. */
@customElement('ll-templates')
export class LlTemplates extends LitElement {
  static styles = [
    formdownTheme,
    css`
    :host {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--dc-space-4, 16px);
      height: 100%;
      min-height: 0;
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
      font-family: ui-monospace, monospace;
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
    .options {
      display: grid;
      grid-template-columns: max-content 1fr;
      align-items: center;
      gap: var(--dc-space-1, 4px) var(--dc-space-2, 8px);
    }
    .options h3,
    .options p {
      grid-column: 1 / -1;
    }
    .judgment {
      display: flex;
      flex-direction: column;
      align-items: flex-start; /* a checkbox is as wide as its label, so a click beside it does nothing */
      gap: var(--dc-space-1, 4px);
    }
    h3 {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
    }
  `,
  ]

  @property({ attribute: false }) vaultInfo!: VaultInfo
  /** The template's file. The app asks before leaving unsaved edits, so a new one is simply shown. */
  @property({ attribute: false }) path!: string

  /** The template files, conflict copies included: what tells whether this one has a copy. */
  @state() private entries: VaultEntry[] = []
  @state() private selected?: string
  @state() private source = ''
  /** The open template as it was last read or saved: what the file holds unless changed outside. */
  private loaded = ''
  @state() private dirty = false
  /** The open template changed outside while it had unsaved edits: the person chooses which to keep. */
  @state() private changedOutside = false
  @state() private message = ''
  @state() private error = ''

  private unlisten?: Promise<UnlistenFn>

  connectedCallback() {
    super.connectedCallback()
    void this.refresh()
    this.unlisten = onVaultChanged((change) => void this.outsideChange(change))
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    void this.unlisten?.then((stop) => stop())
    markUnsaved('templates', false)
  }

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('path') && this.path !== this.selected) void this.select(this.path).catch((e) => (this.error = describeError(e)))
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('dirty')) markUnsaved('templates', this.dirty)
  }

  /** Shows what another program did to the templates; an edit in progress is never replaced. */
  private async outsideChange(change: VaultChanged) {
    try {
      await this.refresh()
      const selected = this.selected
      if (!selected || !touches(change, selected)) return
      if (removedBy(change, selected, this.entries.map((e) => e.path))) {
        // What is on screen is now held nowhere else: it is unsaved, whatever was typed.
        this.dirty = true
        this.error = strings.removedOutside
        this.message = '' // an earlier "saved" no longer holds
      } else {
        const source = await vault.read(selected)
        // A notice that changed nothing leaves the screen alone. An edit made while the file was being
        // read is not replaced: the notice was about the file, not about what was typed since.
        if (this.selected !== selected || source === this.loaded) return
        if (this.dirty) {
          this.error = strings.changedOutsideDirty
          this.message = ''
          this.changedOutside = true
        } else {
          this.show(selected, source)
          if (!change.rescan) this.message = strings.reloadedOutside
        }
      }
    } catch (e) {
      this.error = describeError(e)
    }
  }

  private async refresh() {
    try {
      this.entries = await vault.listTemplates()
    } catch (e) {
      this.error = describeError(e)
    }
  }

  private async select(path: string) {
    this.show(path, await vault.read(path))
  }

  private show(path: string, source: string) {
    this.error = ''
    this.message = ''
    this.source = source
    this.loaded = source
    this.selected = path
    this.dirty = false
    this.changedOutside = false
  }

  /** Drops the unsaved edits and shows the template as it is on disk now. */
  private async readOutside() {
    if (!this.selected) return
    try {
      await this.select(this.selected)
      this.message = strings.reloadedOutside
    } catch (e) {
      this.error = describeError(e)
    }
  }

  /** The source's fields, and whether each is a judgment field; nothing while the source does not parse. */
  private judgmentFields(): { name: string; label: string; on: boolean }[] {
    try {
      const lowline = readFrontMatter(this.source)?.frontMatter.data.lowline as { suggest?: unknown } | undefined
      const on = new Set(Array.isArray(lowline?.suggest) ? lowline.suggest : [])
      return parseFormdown(this.source).forms.map((f) => ({ name: f.name, label: f.label ?? f.name, on: on.has(f.name) }))
    } catch {
      return []
    }
  }

  /** Turns suggestions on or off for a field: an edit of the source like any other, kept by saving. */
  private toggleJudgment(field: string, on: boolean) {
    try {
      this.source = setSuggest(this.source, field, on)
      this.dirty = true
      this.message = ''
      this.error = ''
    } catch (e) {
      this.error = describeError(e)
    }
  }

  /** The source's choice fields — a select, or a radio or checkbox group — with their options. */
  private choiceFields(): { name: string; label: string; options: string[] }[] {
    try {
      return parseFormdown(this.source)
        .forms.filter((f) => ['select', 'radio', 'checkbox'].includes(f.type) && f.options?.length)
        .map((f) => ({ name: f.name, label: f.label ?? f.name, options: f.options! }))
    } catch {
      return []
    }
  }

  /**
   * Writes a field's options, as typed (split at commas), into its place in the source: an edit of the
   * source like any other, kept by saving. A field is left with at least one option.
   */
  private setOptions(field: string, typed: string, input: HTMLInputElement & { value: string }) {
    const current = this.choiceFields().find((f) => f.name === field)?.options ?? []
    const options = typed.split(',').map((o) => o.trim()).filter(Boolean)
    if (options.length === 0 || options.join(',') === current.join(',')) {
      input.value = current.join(', ') // nothing to write: show what the source holds
      return
    }
    try {
      this.source = setFieldAttribute(this.source, field, 'options', options.join(','))
      this.dirty = true
      this.message = ''
      this.error = ''
    } catch (e) {
      this.error = describeError(e)
    }
  }

  private renderChoices() {
    const fields = this.choiceFields()
    if (fields.length === 0) return nothing
    const commit = (field: string) => (e: Event) => {
      const input = e.currentTarget as HTMLInputElement
      this.setOptions(field, input.value, input)
    }
    return html`<div class="options" role="group" aria-label=${strings.optionsTitle}>
      <h3>${strings.optionsTitle}</h3>
      <p class="message">${strings.optionsHelp}</p>
      ${fields.map(
        (f) => html`<span>${f.label}</span>
          <dc-input
            aria-label=${strings.optionsOf(f.label)}
            .value=${f.options.join(', ')}
            @focusout=${commit(f.name)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter') commit(f.name)(e)
            }}
          ></dc-input>`,
      )}
    </div>`
  }

  /** Saves the template as it is on screen; the app's save shortcut calls this too. */
  async save() {
    if (!this.selected) return
    this.error = ''
    this.message = '' // "saved" is said again only once this save has landed
    try {
      templateInfo(this.source) // a template must name itself
      await vault.write(this.selected, this.source)
      this.loaded = this.source
      // The app's own writes are not reported back: a template made again after it was removed
      // outside rejoins the list here.
      await this.refresh()
      this.dirty = false
      this.changedOutside = false
      this.message = strings.saved
      this.dispatchEvent(new CustomEvent('ll-confirmed', { bubbles: true, composed: true }))
    } catch (e) {
      this.error = describeError(e)
    }
  }

  private renderJudgment() {
    const fields = this.judgmentFields()
    return html`<div class="judgment" role="group" aria-label=${strings.judgmentTitle}>
      <h3>${strings.judgmentTitle}</h3>
      <p class="message">${strings.judgmentHelp}</p>
      ${fields.length === 0
        ? html`<p class="message">${strings.judgmentNone}</p>`
        : fields.map(
            (f) => html`<dc-checkbox
              name=${f.name}
              .checked=${f.on}
              @change=${(e: Event) => this.toggleJudgment(f.name, (e.target as HTMLInputElement).checked)}
              >${f.label}</dc-checkbox
            >`,
          )}
    </div>`
  }

  render() {
    return html`
      ${this.selected
        ? html`
            <section>
              <div class="bar">
                <h3>${strings.templateSource}</h3>
                <dc-button size="sm" ?disabled=${!this.dirty} @click=${this.save}>${strings.save}</dc-button>
                ${this.error
                  ? html`<span class="error" role="alert">${this.error}</span>`
                  : html`<span class="message" role="status">${this.message}</span>`}
                ${this.changedOutside
                  ? html`<dc-button size="sm" variant="secondary" @click=${this.readOutside}>${strings.readOutside}</dc-button>`
                  : nothing}
              </div>
              ${noticeFor(conflictNotice(this.selected, this.entries, '.fd.md', strings.conflictedTemplate))}
              <textarea
                spellcheck="false"
                aria-label=${strings.templateSource}
                .value=${this.source}
                @input=${(e: InputEvent) => {
                  this.source = (e.target as HTMLTextAreaElement).value
                  this.dirty = true
                  this.message = ''
                }}
              ></textarea>
            </section>
            <section>
              <h3>${strings.preview}</h3>
              <div class="preview">
                <formdown-ui .content=${this.source}></formdown-ui>
              </div>
              ${this.renderChoices()}
              ${this.renderJudgment()}
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
