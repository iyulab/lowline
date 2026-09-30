import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { strings } from './strings.js'

/**
 * Keeps the open sync conflict copy in place of its original: a button that asks first, saying that
 * the original goes to the system's trash and the copy takes its name (`original`, the name shown).
 * Confirmed, it sends `ll-keep-copy` `{ permanently: false }`. When the host reports that the trash
 * would not take the original (`untrashable`), it asks again whether to delete the original for good,
 * and sends `ll-keep-copy` `{ permanently: true }` only on that second answer. Cancelling either sends
 * `ll-keep-copy-cancel`; the host then clears `untrashable`.
 */
@customElement('ll-keep-copy')
export class LlKeepCopy extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }
  `

  @property() original = ''
  /** The trash did not take the original: both files are still there, and deleting it for good is the person's to choose. */
  @property({ type: Boolean }) untrashable = false
  @state() private asking = false

  private send(permanently: boolean) {
    this.asking = false
    this.dispatchEvent(new CustomEvent('ll-keep-copy', { detail: { permanently }, bubbles: true, composed: true }))
  }

  private cancel() {
    this.asking = false
    // The host clears `untrashable`: it owns that answer.
    this.dispatchEvent(new CustomEvent('ll-keep-copy-cancel', { bubbles: true, composed: true }))
  }

  render() {
    return html`<dc-button size="sm" variant="secondary" @click=${() => (this.asking = true)}>${strings.keepCopy}</dc-button>
      <dc-confirm-dialog
        heading=${strings.keepCopyHeading}
        confirm-label=${strings.keepCopyConfirm}
        cancel-label=${strings.cancel}
        .open=${this.asking}
        @confirm=${() => this.send(false)}
        @cancel=${this.cancel}
        >${strings.keepCopyBody(this.original)}</dc-confirm-dialog
      >
      <dc-confirm-dialog
        heading=${strings.notTrashedHeading}
        confirm-label=${strings.keepCopyPermanently}
        cancel-label=${strings.cancel}
        danger
        .open=${this.untrashable}
        @confirm=${() => this.send(true)}
        @cancel=${this.cancel}
        >${strings.keepCopyNotTrashedBody}</dc-confirm-dialog
      >`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'll-keep-copy': LlKeepCopy
  }
}
