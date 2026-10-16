import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import '@iyulab/chat-components/dist/utilities/icons.js'
import '@iyulab/chat-components/dist/components/message/UMessage.js'
import '@iyulab/chat-components/dist/components/prompt/UPrompt.js'
import '@iyulab/chat-components/dist/components/blocks/UMarkedBlock.js'
import { strings } from './strings.js'
import { failureText, modelLabel } from './model-settings.js'
import { draftOf, draftProblems, fieldChanges, retryMessage, tidyDraft, wordsOf } from './chat-authoring.js'
import { planWords, queryPlan, type ReadPlan } from './chat-query.js'
import { fileName } from './documents.js'
import { cellText, countColumns, templateSnapshot, type AggregateAnswer, type CountColumn, type TemplateSnapshot } from './projection.js'
import { host, model as models, type ChatTurn } from './vault-client.js'
import { SidecarUnavailable, readVault, syncVault } from './vault-snapshot.js'
import { templateId } from './template-revision.js'
import { describeError } from './errors.js'
import type { ModelSettings } from './settings.js'
import './model-settings.js'

/** A line of the conversation as shown: what was said, and — for a reply that put a draft in — what the editor held before. */
interface Shown {
  role: 'user' | 'assistant'
  text: string
  note?: string
  before?: string
  failed?: boolean
  /** An answer from the vault: what was counted, in words, and the counts with the documents behind each. */
  answer?: Answer
}

/** What a question was answered with: every number from the vault's aggregate, none from the model. */
interface Answer {
  template: TemplateSnapshot
  /** What it could be counted by: the template's fields and those of the documents they refer to. */
  columns: CountColumn[]
  /** The name of each document a reference field may hold, by its template's id and its own (`<id>\n<document>`). */
  names: ReadonlyMap<string, string>
  counted: string
  counts: AggregateAnswer
  total: number
}

/** What the chat does: change the template, or ask its records — one task for a model at a time. */
type Mode = 'author' | 'ask'

/** What a reply that is not a plan to count says, in the app's words. */
function notCounted(read: Exclude<ReadPlan, { plan: unknown }>): string {
  if ('unanswerable' in read) return strings.queryUnanswerable(read.unanswerable)
  if (read.problem === 'no-plan') return strings.queryNoPlan
  return read.problem === 'unknown-field' ? strings.queryUnknownField(read.field) : strings.queryBadFilter(read.field)
}

/**
 * The chat beside a template. Opened before a model is set up, it sets one up first: the chat needs one, and a
 * person who never opens it never has to choose. A reply that brings a template has it checked as the template's page
 * checks what is typed — asked again once when it has problems — and put into the editor as a draft (`ll-chat-draft`);
 * the person saves it. What the editor held before can be put back.
 *
 * Asking the records, the model only turns the question into what to count — the template goes with it, never a
 * document — and the vault counts it: the answer says what was counted, then the counts, each with the documents it is
 * made of to open (`ll-open-document`).
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
    .answer {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-1);
      font-size: var(--dc-font-size-md);
    }
    .answer p {
      margin: 0;
    }
    .counted {
      font-size: var(--dc-font-size-sm);
      color: var(--dc-color-text-secondary);
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th,
    td {
      padding: var(--dc-space-1) var(--dc-space-2);
      border-bottom: 1px solid var(--dc-color-border);
      text-align: left;
      vertical-align: top;
      /* A value breaks only where it is longer than the panel is wide, so a short one keeps its width. */
      overflow-wrap: break-word;
      word-break: keep-all;
    }
    th {
      font-weight: normal;
      color: var(--dc-color-text-secondary);
      white-space: nowrap;
    }
    /* The documents take what width is left. */
    td:last-child {
      width: 100%;
    }
    td.count {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .evidence {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0 var(--dc-space-1);
    }
    .more {
      color: var(--dc-color-text-muted);
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
  /** The template as saved: whose records a question is asked of. */
  @property({ attribute: false }) saved = ''

  @state() private settingUp = false
  @state() private mode: Mode = 'author'
  /** Each task's conversation, kept while the other is shown. */
  @state() private logs: Record<Mode, Shown[]> = { author: [], ask: [] }
  @state() private writing = false
  @query('u-prompt') private prompt?: HTMLElement & { value?: string }
  /** Bumped by every message and by stopping: a reply to an older one is let go. */
  private asked = 0

  /** The conversation of the task shown. */
  private get shown(): Shown[] {
    return this.logs[this.mode]
  }

  private set shown(lines: Shown[]) {
    this.logs = { ...this.logs, [this.mode]: lines }
  }

  /** What is sent back to the model: the words of each turn, the drafts left out — the template itself goes with every request. */
  private get turns(): ChatTurn[] {
    return this.logs.author.filter((s) => !s.failed).map((s) => ({ role: s.role, text: s.text }))
  }

  private send(text: string) {
    if (this.mode === 'ask') void this.ask(text)
    else void this.author(text)
  }

  /** A question of the saved template's records: what to count from the model, the counts from the vault. */
  private async ask(question: string) {
    const model = this.model
    if (!model || !question.trim()) return
    if (this.prompt) this.prompt.value = ''
    const ask = ++this.asked
    this.shown = [...this.shown, { role: 'user', text: question }]
    const fail = (text: string) => (this.shown = [...this.shown, { role: 'assistant', text, failed: true }])
    let template: TemplateSnapshot
    try {
      template = templateSnapshot(this.saved)
    } catch {
      fail(strings.queryNotSaved)
      return
    }
    this.writing = true
    try {
      // What the template's documents can be counted by — its fields, and those of the documents they refer to — is
      // told the model by name and choices, never a value.
      const vaultNow = await readVault()
      const columns = countColumns(template, vaultNow.templates)
      const referred = columns.filter((c) => c.via).map((c) => ({ name: c.name, type: c.type, options: c.options }))
      const names = new Map(vaultNow.documents.map((d) => [`${templateId(d.template)}\n${d.id}`, fileName(d.path, '.md')]))
      // The vault handed to the sidecar as it stands, as the table does before it counts — while the model reads.
      const [reply] = await Promise.all([models.query(model, this.saved, question, referred), syncVault()])
      if (ask !== this.asked) return
      if (!reply.ok || reply.text === null) {
        fail(strings.chatFailed(failureText(reply.failure, reply.statusCode)))
        return
      }
      const read = queryPlan(reply.text, columns)
      if (!('plan' in read)) {
        fail(notCounted(read))
        return
      }
      const counts = await host.aggregate(template.ref, read.plan.groupBy, read.plan.filters)
      if (ask !== this.asked) return
      const total = counts.groups.reduce((sum, g) => sum + g.count, 0)
      const top = read.plan.top ? { ...counts, groups: counts.groups.slice(0, read.plan.top) } : counts
      this.shown = [
        ...this.shown,
        { role: 'assistant', text: '', answer: { template, columns, names, counted: planWords(read.plan, columns), counts: top, total } },
      ]
    } catch (e) {
      if (ask === this.asked) fail(e instanceof SidecarUnavailable ? strings.hostFailed(e.message) : describeError(e))
    } finally {
      if (ask === this.asked) this.writing = false
    }
  }

  private async author(text: string) {
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

  /** A new line, or the line being written, is shown: the conversation scrolls to its end, as a chat does. */
  protected updated(changed: Map<string, unknown>) {
    if (changed.has('logs') || changed.has('writing') || changed.has('mode')) {
      // After the messages inside have laid themselves out.
      requestAnimationFrame(() => {
        const log = this.renderRoot.querySelector<HTMLElement>('.log')
        if (log) log.scrollTop = log.scrollHeight
      })
    }
  }

  private open(path: string, template: string) {
    this.dispatchEvent(new CustomEvent('ll-open-document', { detail: { path, template }, bubbles: true, composed: true }))
  }

  private renderAnswer({ template, columns, names, counted, counts, total }: Answer) {
    const field = (name: string) => columns.find((f) => f.name === name)
    const shown = (name: string, value: unknown) => {
      if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return strings.queryBlank
      // A reference holds a document's id: shown by that document's name, as the table shows it.
      const target = field(name)?.reference
      if (target && typeof value === 'string') return names.get(`${target}\n${value}`) ?? value
      const labels = field(name)?.optionLabels
      return Array.isArray(value) ? value.map((v) => labels?.[String(v)] ?? String(v)).join(', ') : (labels?.[String(value)] ?? cellText(value))
    }
    const documents = (group: AggregateAnswer['groups'][number]) => html`<span class="evidence">
      ${group.evidence.map(
        (path) => html`<dc-button size="sm" variant="ghost" @click=${() => this.open(path, template.ref)}>${fileName(path, '.md')}</dc-button>`,
      )}
      ${group.count > group.evidence.length ? html`<span class="more">${strings.queryMore(group.count - group.evidence.length)}</span>` : nothing}
    </span>`
    return html`<div class="answer">
      <p class="counted">${strings.queryCounted(counted)}</p>
      <p>${total === 0 ? strings.queryNone : strings.queryTotal(total)}</p>
      ${total > 0 && counts.groupBy.length === 0 ? documents(counts.groups[0]) : nothing}
      ${total > 0 && counts.groupBy.length > 0
        ? html`<table>
            <thead>
              <tr>
                ${counts.groupBy.map((name) => html`<th scope="col">${field(name)?.label ?? name}</th>`)}
                <th scope="col">${strings.queryCount}</th>
                <th scope="col">${strings.queryEvidence}</th>
              </tr>
            </thead>
            <tbody>
              ${counts.groups.map(
                (group) => html`<tr>
                  ${counts.groupBy.map((name) => html`<td>${shown(name, group.key[name])}</td>`)}
                  <td class="count">${group.count}</td>
                  <td>${documents(group)}</td>
                </tr>`,
              )}
            </tbody>
          </table>`
        : nothing}
    </div>`
  }

  private renderLine(line: Shown) {
    if (line.role === 'user') {
      return html`<u-message author="user" variant="bubble" position="right" fit="auto"><p class="said">${line.text}</p></u-message>`
    }
    return html`<u-message author="assistant">
      ${line.failed
        ? html`<p class="note failed" role="alert">${line.text}</p>`
        : line.answer
          ? this.renderAnswer(line.answer)
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
      <dc-segmented-control
        size="sm"
        aria-label=${strings.chatModes}
        .value=${this.mode}
        .options=${[
          { value: 'author', label: strings.chatModeAuthor },
          { value: 'ask', label: strings.chatModeAsk },
        ]}
        ?disabled=${this.writing}
        @change=${(e: Event) => (this.mode = (e.target as HTMLElement & { value: Mode }).value)}
      ></dc-segmented-control>
      <div class="log" role="log" aria-live="polite">
        ${this.shown.length === 0 ? html`<p class="empty">${this.mode === 'ask' ? strings.chatAskEmpty : strings.chatEmpty}</p>` : nothing}
        ${this.shown.map((line) => this.renderLine(line))}
        ${this.writing ? html`<u-message author="assistant" loading></u-message>` : nothing}
      </div>
      <u-prompt
        placeholder=${this.mode === 'ask' ? strings.chatAskPlaceholder : strings.chatPlaceholder}
        ?loading=${this.writing}
        @send=${(e: CustomEvent<{ value: string }>) => this.send(e.detail.value)}
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
