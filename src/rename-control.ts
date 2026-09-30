import { LitElement, css, html } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { strings } from './strings.js'

/**
 * Renames what is open: a button that becomes a field holding the current name. Enter (or the
 * confirm button) asks for the rename with `ll-rename` `{ name }`; the host does it and says what
 * went wrong. Escape (or cancel) sends `ll-rename-cancel`. A new `name` — the rename landed, or
 * something else opened — closes the field.
 */
@customElement('ll-rename')
export class LlRename extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }
    dc-input {
      /* A place with little room (a row of the template's field list) sets it narrower. */
      width: var(--ll-rename-width, 16rem);
    }
  `

  @property() name = ''
  @state() private editing = false
  @query('dc-input') private input?: HTMLElement & { value: string }

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('name') && changed.get('name') !== undefined) this.editing = false
  }

  private ask() {
    if ((this.input?.value ?? '').trim() === this.name) return this.cancel() // nothing to change
    this.dispatchEvent(new CustomEvent('ll-rename', { detail: { name: this.input?.value ?? '' }, bubbles: true, composed: true }))
  }

  private cancel() {
    this.editing = false
    this.dispatchEvent(new CustomEvent('ll-rename-cancel', { bubbles: true, composed: true }))
  }

  render() {
    if (!this.editing) return html`<dc-button size="sm" variant="ghost" @click=${() => (this.editing = true)}>${strings.rename}</dc-button>`
    return html`<dc-input
        aria-label=${strings.newName}
        .value=${this.name}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Enter') this.ask()
          else if (e.key === 'Escape') this.cancel()
        }}
      ></dc-input>
      <dc-button size="sm" variant="secondary" @click=${this.ask}>${strings.renameConfirm}</dc-button>
      <dc-button size="sm" variant="ghost" @click=${this.cancel}>${strings.cancel}</dc-button>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'll-rename': LlRename
  }
}
