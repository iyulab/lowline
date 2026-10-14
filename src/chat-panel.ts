import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { strings } from './strings.js'
import { presetOf } from './model-settings.js'
import type { ModelSettings } from './settings.js'
import './model-settings.js'

/**
 * The chat beside a template. Opened before a model is set up, it sets one up first: the chat needs one, and a
 * person who never opens it never has to choose.
 */
@customElement('ll-chat-panel')
export class LlChatPanel extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-2);
      min-height: 0;
      padding: var(--dc-space-3);
      border: 1px solid var(--dc-color-border);
      border-radius: var(--dc-radius-md);
      background: var(--dc-color-surface);
      overflow: auto;
    }
    .model {
      display: flex;
      align-items: center;
      gap: var(--dc-space-2);
      font-size: var(--dc-font-size-sm);
      color: var(--dc-color-text-muted);
    }
  `

  /** The model set up, if any. */
  @property({ attribute: false }) model: ModelSettings | null = null

  @state() private settingUp = false

  render() {
    if (!this.model || this.settingUp) {
      return html`<ll-model-settings .current=${this.model} @ll-model=${() => (this.settingUp = false)}></ll-model-settings>`
    }
    return html`<div class="model">
      <span>${presetOf(this.model.preset)?.label ?? this.model.preset} · ${this.model.model}</span>
      <dc-button size="sm" variant="ghost" @click=${() => (this.settingUp = true)}>${strings.chatModelChange}</dc-button>
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'll-chat-panel': LlChatPanel
  }
}
