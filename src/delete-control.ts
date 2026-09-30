import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { strings } from './strings.js'

/**
 * Deletes what is open: a button that asks first, saying what deleting does (`heading`, `body`).
 * Confirmed, it sends `ll-delete` `{ permanently: false }` — to the system's trash. When the host
 * reports that the trash would not take the file (`untrashable`), it asks again whether to delete it
 * for good, and sends `ll-delete` `{ permanently: true }` only on that second answer. Cancelling
 * either sends `ll-delete-cancel`; the host then clears `untrashable`.
 */
@customElement('ll-delete')
export class LlDelete extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }
  `

  @property() heading = ''
  @property() body = ''
  /** The trash did not take the file: it is still there, and deleting it for good is the person's to choose. */
  @property({ type: Boolean }) untrashable = false
  @state() private asking = false

  private send(permanently: boolean) {
    this.asking = false
    this.dispatchEvent(new CustomEvent('ll-delete', { detail: { permanently }, bubbles: true, composed: true }))
  }

  private cancel() {
    this.asking = false
    // The host clears `untrashable`: it owns that answer.
    this.dispatchEvent(new CustomEvent('ll-delete-cancel', { bubbles: true, composed: true }))
  }

  render() {
    return html`<dc-button size="sm" variant="ghost" @click=${() => (this.asking = true)}>${strings.delete}</dc-button>
      <dc-confirm-dialog
        heading=${this.heading}
        confirm-label=${strings.deleteConfirm}
        cancel-label=${strings.cancel}
        .open=${this.asking}
        @confirm=${() => this.send(false)}
        @cancel=${this.cancel}
        >${this.body}</dc-confirm-dialog
      >
      <dc-confirm-dialog
        heading=${strings.notTrashedHeading}
        confirm-label=${strings.deletePermanently}
        cancel-label=${strings.cancel}
        danger
        .open=${this.untrashable}
        @confirm=${() => this.send(true)}
        @cancel=${this.cancel}
        >${strings.notTrashedBody}</dc-confirm-dialog
      >`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'll-delete': LlDelete
  }
}
