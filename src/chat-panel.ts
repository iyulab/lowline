import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import '@iyulab/chat-components/dist/utilities/icons.js'
import '@iyulab/chat-components/dist/components/message/UMessage.js'
import '@iyulab/chat-components/dist/components/prompt/UPrompt.js'
import '@iyulab/chat-components/dist/components/blocks/UMarkedBlock.js'
import { strings } from './strings.js'
import { failureText, modelLabel } from './model-settings.js'
import { draftOf, draftProblems, fieldChanges, retryMessage, tidyDraft, wordsOf } from './chat-authoring.js'
import { model as models, type ChatTurn } from './vault-client.js'
import type { ModelSettings } from './settings.js'
import './model-settings.js'

/** A line of the conversation as shown: what was said, and — for a reply that put a draft in — what the editor held before. */
interface Shown {
  role: 'user' | 'assistant'
  text: string
  note?: string
  before?: string
  failed?: boolean
}

/**
 * The chat beside a template. Opened before a model is set up, it sets one up first: the chat needs one, and a
 * person who never opens it never has to choose. A reply that brings a template has it checked as the template's page
 * checks what is typed — asked again once when it has problems — and put into the editor as a draft (`ll-chat-draft`);
 * the person saves it. What the editor held before can be put back.
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
    }
    .model {
      display: flex;
      align-items: center;
      gap: var(--dc-space-2);
      font-size: var(--dc-font-size-sm);
      color: var(--dc-color-text-muted);
    }
    .log {
      flex: 1;
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-2);
    }
    .empty,
    .note {
      margin: 0;
      font-size: var(--dc-font-size-sm);
      color: var(--dc-color-text-secondary);
    }
    .note {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--dc-space-2);
    }
    .failed {
      color: var(--dc-color-danger-text);
    }
    /* What the person wrote, as written — wrapped to the panel. */
    .said {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: var(--dc-font-size-md);
    }
  `

  /** The model set up, if any. */
  @property({ attribute: false }) model: ModelSettings | null = null
  /** The template's source as it stands in the editor: what the chat talks about. */
  @property({ attribute: false }) template = ''

  @state() private settingUp = false
  @state() private shown: Shown[] = []
  @state() private writing = false
  @query('u-prompt') private prompt?: HTMLElement & { value?: string }
  /** Bumped by every message and by stopping: a reply to an older one is let go. */
  private asked = 0

  /** What is sent back to the model: the words of each turn, the drafts left out — the template itself goes with every request. */
  private get turns(): ChatTurn[] {
    return this.shown.filter((s) => !s.failed).map((s) => ({ role: s.role, text: s.text }))
  }

  private async send(text: string) {
    const model = this.model
    if (!model || !text.trim()) return
    if (this.prompt) this.prompt.value = ''
    const ask = ++this.asked
    this.shown = [...this.shown, { role: 'user', text }]
    this.writing = true
    try {
      const template = this.template
      let reply = await models.author(model, template, this.turns)
      if (ask !== this.asked) return
      let draft = reply.ok && reply.text ? draftOf(reply.text) : null
      let problems = draft ? draftProblems(tidyDraft(draft)) : []
      if (reply.ok && draft && problems.length > 0) {
        // Asked once more, with what is wrong — the conversation as it went, the retry not shown.
        const again = [...this.turns, { role: 'assistant' as const, text: reply.text! }, { role: 'user' as const, text: retryMessage(problems) }]
        const second = await models.author(model, template, again)
        if (ask !== this.asked) return
        const secondDraft = second.ok && second.text ? draftOf(second.text) : null
        if (secondDraft) {
          reply = second
          draft = secondDraft
          problems = draftProblems(tidyDraft(secondDraft))
        }
      }
      if (!reply.ok || reply.text === null) {
        this.shown = [...this.shown, { role: 'assistant', text: strings.chatFailed(failureText(reply.failure, reply.statusCode)), failed: true }]
        return
      }
      const words = wordsOf(reply.text)
      if (!draft) {
        this.shown = [...this.shown, { role: 'assistant', text: words }]
        return
      }
      const tidy = tidyDraft(draft)
      const { added, removed } = fieldChanges(template, tidy)
      const note = [strings.chatDraftPut(added, removed), problems.length ? strings.chatDraftProblems : ''].filter(Boolean).join(' ')
      this.shown = [...this.shown, { role: 'assistant', text: words, note, before: template }]
      this.put(tidy)
    } catch {
      if (ask === this.asked) this.shown = [...this.shown, { role: 'assistant', text: strings.chatFailed(strings.modelCheckFailed), failed: true }]
    } finally {
      if (ask === this.asked) this.writing = false
    }
  }

  private stop() {
    this.asked++
    this.writing = false
    this.shown = [...this.shown, { role: 'assistant', text: strings.chatStopped, failed: true }]
  }

  private put(source: string) {
    this.dispatchEvent(new CustomEvent<{ source: string }>('ll-chat-draft', { detail: { source }, bubbles: true, composed: true }))
  }

  private renderLine(line: Shown) {
    if (line.role === 'user') {
      return html`<u-message author="user" variant="bubble" position="right" fit="auto"><p class="said">${line.text}</p></u-message>`
    }
    return html`<u-message author="assistant">
      ${line.failed
        ? html`<p class="note failed" role="alert">${line.text}</p>`
        : line.text
          ? html`<u-marked-block .value=${line.text}></u-marked-block>`
          : nothing}
      ${line.note
        ? html`<p class="note" role="status">
            ${line.note}
            <dc-button size="sm" variant="ghost" @click=${() => this.put(line.before!)}>${strings.chatUndo}</dc-button>
          </p>`
        : nothing}
    </u-message>`
  }

  render() {
    if (!this.model || this.settingUp) {
      return html`<ll-model-settings .current=${this.model} @ll-model=${() => (this.settingUp = false)}></ll-model-settings>`
    }
    return html`
      <div class="model">
        <span>${modelLabel(this.model)}</span>
        <dc-button size="sm" variant="ghost" @click=${() => (this.settingUp = true)}>${strings.chatModelChange}</dc-button>
      </div>
      <div class="log" role="log" aria-live="polite">
        ${this.shown.length === 0 ? html`<p class="empty">${strings.chatEmpty}</p>` : nothing}
        ${this.shown.map((line) => this.renderLine(line))}
        ${this.writing ? html`<u-message author="assistant" loading></u-message>` : nothing}
      </div>
      <u-prompt
        placeholder=${strings.chatPlaceholder}
        ?loading=${this.writing}
        @send=${(e: CustomEvent<{ value: string }>) => void this.send(e.detail.value)}
        @stop=${this.stop}
      ></u-prompt>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'll-chat-panel': LlChatPanel
  }
}
