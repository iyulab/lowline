import { LitElement, css, svg, html, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { SYMBOL, WORDMARK, type Rect } from './geometry.ts'
import { WORDMARK_GLYPHS } from './wordmark-glyphs.ts'

export type MarkVariant = 'symbol' | 'wordmark'

/** At this size and below the symbol drops to one color so the dashes stay visible. */
const MONO_AT = 24
/** Caret blink half-period — the common desktop default. */
const BLINK_MS = 530
/** Like a system caret, stop blinking after a while without input, and rest visible. */
const REST_AFTER_MS = 5000

/** The Lowline mark as an element; what it is drawn from, and why, is in `geometry.ts`. */
@customElement('ll-mark')
export class LlMark extends LitElement {
  static styles = css`
    :host {
      display: inline-block;
      line-height: 0;
      --_ink: var(--ll-ink, #1a1a1a);
      --_caret: var(--ll-caret, #2f4a6d);
      --_pending: var(--ll-pending, #b4b1aa);
    }
    :host([tone='mono']) {
      --_caret: var(--_ink);
      --_pending: var(--_ink);
    }
    svg {
      overflow: visible;
    }
    .word {
      fill: var(--_ink);
    }
    .line {
      fill: var(--_ink);
    }
    .caret {
      fill: var(--_caret);
      transition: fill 200ms ease;
    }
    .dash {
      fill: var(--_pending);
    }
    :host([blinking]) .caret {
      animation: blink calc(var(--ll-blink-ms, ${BLINK_MS}ms) * 2) steps(1, end) infinite;
    }
    /* An unfocused window keeps its caret, dimmed and still. */
    :host([inactive]) .caret {
      animation: none;
      fill: var(--_pending);
    }
    .confirming .dash {
      animation: confirm 900ms ease both;
      animation-delay: calc(var(--i) * 70ms);
    }
    @keyframes blink {
      0% {
        opacity: 1;
      }
      50% {
        opacity: 0;
      }
    }
    /* "Not yet" briefly becomes "confirmed", then waits for the next one. */
    @keyframes confirm {
      0% {
        fill: var(--_pending);
      }
      25%,
      60% {
        fill: var(--_ink);
      }
      100% {
        fill: var(--_pending);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      :host([blinking]) .caret,
      .confirming .dash {
        animation: none;
      }
    }
  `

  @property({ reflect: true }) variant: MarkVariant = 'symbol'
  /** Rendered height in CSS pixels; the width follows. */
  @property({ type: Number }) size = 24
  /** Whether the caret blinks after input. A resting caret stays visible. */
  @property({ type: Boolean }) blink = true
  /** Accessible name; empty makes the mark decorative. */
  @property() label = 'Lowline'

  @property({ reflect: true }) tone: 'color' | 'mono' = 'color'
  @property({ type: Boolean, reflect: true }) blinking = false
  @property({ type: Boolean, reflect: true }) inactive = false
  @state() private confirming = false

  private restTimer?: ReturnType<typeof setTimeout>
  private holdTimer?: ReturnType<typeof setTimeout>
  private confirmTimer?: ReturnType<typeof setTimeout>

  private readonly onFocus = () => {
    this.inactive = false
    this.wake()
  }
  private readonly onBlur = () => {
    this.inactive = true
    this.rest()
  }

  connectedCallback() {
    super.connectedCallback()
    window.addEventListener('focus', this.onFocus)
    window.addEventListener('blur', this.onBlur)
    this.inactive = !document.hasFocus()
    if (!this.inactive) this.wake()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('focus', this.onFocus)
    window.removeEventListener('blur', this.onBlur)
    clearTimeout(this.restTimer)
    clearTimeout(this.holdTimer)
    clearTimeout(this.confirmTimer)
  }

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has('size') || changed.has('variant')) {
      this.tone = this.variant === 'symbol' && this.size <= MONO_AT ? 'mono' : 'color'
    }
  }

  /** Starts (or restarts) blinking, which rests again after a quiet spell. */
  wake() {
    if (!this.blink || this.inactive) return
    clearTimeout(this.restTimer)
    this.blinking = true
    this.restTimer = setTimeout(() => this.rest(), REST_AFTER_MS)
  }

  /**
   * Input is happening: like a caret while typing, stay solid, and start blinking again
   * once input pauses.
   */
  hold() {
    clearTimeout(this.holdTimer)
    clearTimeout(this.restTimer)
    this.blinking = false
    this.holdTimer = setTimeout(() => this.wake(), BLINK_MS)
  }

  /** Something was confirmed: the dashes fill in, one after another, then return. */
  confirm() {
    this.confirming = false
    clearTimeout(this.confirmTimer)
    // Restart the animation on the next frame so repeated confirmations each show.
    requestAnimationFrame(() => {
      this.confirming = true
      const dashes = (this.variant === 'symbol' ? SYMBOL : WORDMARK).dashes.length
      this.confirmTimer = setTimeout(() => (this.confirming = false), 900 + dashes * 70)
    })
    this.wake()
  }

  private rest() {
    clearTimeout(this.restTimer)
    this.blinking = false
  }

  render() {
    const g = this.variant === 'symbol' ? SYMBOL : WORDMARK
    const [, , w, h] = g.viewBox.split(' ').map(Number)
    const rect = (r: Rect, cls: string, i = 0) =>
      svg`<rect class=${cls} style="--i:${i}" x=${r.x} y=${r.y} width=${r.w} height=${r.h}></rect>`
    return html`<svg
      viewBox=${g.viewBox}
      height=${this.size}
      width=${(this.size * w) / h}
      shape-rendering=${this.variant === 'symbol' ? 'crispEdges' : 'auto'}
      role=${this.label ? 'img' : 'presentation'}
      aria-label=${this.label || nothing}
      aria-hidden=${this.label ? nothing : 'true'}
      class=${this.confirming ? 'confirming' : ''}
    >
      ${this.variant === 'wordmark'
        ? WORDMARK_GLYPHS.map((g) => svg`<path class="word" transform="translate(${g.x} 0)" d=${g.d}></path>`)
        : nothing}
      ${rect(g.line, 'line')} ${g.dashes.map((d, i) => rect(d, 'dash', i))} ${rect(g.caret, 'caret')}
    </svg>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'll-mark': LlMark
  }
}
