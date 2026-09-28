import { LitElement, css, html, nothing, svg } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { describeError } from './errors.js'
import type { FieldCurve, TemplateSnapshot } from './projection.js'
import { strings } from './strings.js'
import { host, onVaultChanged, type VaultInfo } from './vault-client.js'
import { SidecarUnavailable, syncVault } from './vault-snapshot.js'

/** The decisions each rate is taken over — the sidecar's window. */
const WINDOW = 10

/** Plot area, in viewBox units. */
const W = 600
const H = 120
const PAD = { top: 8, right: 44, bottom: 8, left: 36 }

/**
 * Whether suggestions get better with use: for each judgment field, the share of recent
 * suggestions people took as offered, decision by decision — the vault's event files, read again.
 */
@customElement('ll-learning')
export class LlLearning extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-5, 24px);
      font-size: 13px;
    }
    section {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-2, 8px);
    }
    h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
    }
    .figures {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--dc-space-2, 8px) var(--dc-space-4, 16px);
    }
    .headline {
      font-size: 20px;
      font-variant-numeric: tabular-nums;
    }
    .secondary {
      color: var(--dc-color-text-secondary, #5e5c57);
      font-variant-numeric: tabular-nums;
    }
    svg {
      width: 100%;
      height: auto;
      max-width: 720px;
      overflow: visible;
    }
    .grid {
      stroke: var(--dc-color-border, #e2ded5);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }
    .axis {
      fill: var(--dc-color-text-muted, #6b6964);
      font-size: 11px;
    }
    .line {
      fill: none;
      stroke: var(--ll-chart-line, #3c67a3);
      stroke-width: 2;
      stroke-linejoin: round;
      stroke-linecap: round;
      vector-effect: non-scaling-stroke;
    }
    .end {
      fill: var(--ll-chart-line, #3c67a3);
      stroke: var(--dc-color-bg, #f7f5f0);
      stroke-width: 2;
    }
    .value {
      fill: var(--dc-color-text, #1a1a1a);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
    .hit {
      fill: transparent;
    }
    .hit:hover {
      fill: var(--ll-chart-line, #3c67a3);
      fill-opacity: 0.15;
    }
    details table {
      border-collapse: collapse;
      font-variant-numeric: tabular-nums;
    }
    details th,
    details td {
      text-align: right;
      padding: 2px var(--dc-space-3, 12px) 2px 0;
    }
    .message {
      color: var(--dc-color-text-muted, #666);
      max-width: 60ch;
    }
    .error {
      color: var(--dc-color-danger, #b00020);
    }
  `

  @property({ attribute: false }) vaultInfo!: VaultInfo

  @state() private curves: FieldCurve[] = []
  @state() private templates: TemplateSnapshot[] = []
  @state() private names = new Map<string, string>()
  @state() private waiting = true
  @state() private error = ''

  private unlisten?: Promise<UnlistenFn>

  connectedCallback() {
    super.connectedCallback()
    void this.load()
    this.unlisten = onVaultChanged(() => void this.load())
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    void this.unlisten?.then((stop) => stop())
  }

  private async load() {
    try {
      const synced = await syncVault()
      this.templates = synced.templates
      this.names = synced.names
      this.curves = await host.curves()
      this.error = ''
    } catch (e) {
      this.error = e instanceof SidecarUnavailable ? strings.hostFailed(e.message) : describeError(e)
    } finally {
      this.waiting = false
    }
  }

  private label(curve: FieldCurve): string {
    const template = this.templates.find((t) => t.ref === curve.template)
    return template?.fields.find((f) => f.name === curve.field)?.label ?? curve.field
  }

  render() {
    if (this.error) return html`<p class="error" role="alert">${this.error}</p>`
    if (this.waiting) return html`<p class="message" role="status">${strings.hostStarting}</p>`
    if (this.curves.length === 0) return html`<p class="message">${strings.learningEmpty}</p>`
    return this.curves.map((c) => this.renderCurve(c))
  }

  private renderCurve(curve: FieldCurve) {
    const label = this.label(curve)
    const points = curve.points
    const last = points[points.length - 1]
    const recent = Math.min(points.length, WINDOW)
    // The first full window, shown beside the latest once the two no longer overlap.
    const first = points.length >= 2 * WINDOW ? points[WINDOW - 1] : undefined
    return html`<section>
      <h2>${strings.learningTitle(this.names.get(curve.template) ?? curve.template, label)}</h2>
      <div class="figures">
        <span class="headline">${strings.learningRate(last.rate, recent)}</span>
        ${first ? html`<span class="secondary">${strings.learningFirst(first.rate, WINDOW)}</span>` : nothing}
        <span class="secondary">${strings.learningCounts(curve.accepted, curve.corrected, curve.rejected)}</span>
      </div>
      ${this.renderChart(curve, label)}
      <details>
        <summary>${strings.learningTable}</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">${strings.learningN}</th>
              <th scope="col">${strings.learningAt}</th>
              <th scope="col">${strings.learningShare}</th>
            </tr>
          </thead>
          <tbody>
            ${points.map(
              (p) => html`<tr>
                <td>${p.n}</td>
                <td>${new Date(p.at).toLocaleString()}</td>
                <td>${Math.round(p.rate * 100)}%</td>
              </tr>`,
            )}
          </tbody>
        </table>
      </details>
    </section>`
  }

  /** One series: the share over decisions, 0–100%, with the latest value labelled at its end. */
  private renderChart(curve: FieldCurve, label: string) {
    const points = curve.points
    const span = Math.max(points.length - 1, 1)
    const x = (i: number) => PAD.left + ((W - PAD.left - PAD.right) * (points.length === 1 ? 0.5 : i / span))
    const y = (rate: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - rate)
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.rate).toFixed(1)}`).join(' ')
    const last = points[points.length - 1]
    const step = (W - PAD.left - PAD.right) / Math.max(points.length, 1)
    return html`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label=${strings.learningChart(label)}>
      ${[0, 0.5, 1].map(
        (r) => svg`<line class="grid" x1=${PAD.left} x2=${W - PAD.right} y1=${y(r)} y2=${y(r)}></line>
          <text class="axis" x=${PAD.left - 6} y=${y(r) + 4} text-anchor="end">${r * 100}%</text>`,
      )}
      ${points.length > 1 ? svg`<path class="line" d=${path}></path>` : nothing}
      <circle class="end" cx=${x(points.length - 1)} cy=${y(last.rate)} r="4.5"></circle>
      <text class="value" x=${x(points.length - 1) + 10} y=${y(last.rate) + 4}>${Math.round(last.rate * 100)}%</text>
      ${points.map(
        (p, i) => svg`<rect class="hit" x=${x(i) - step / 2} y=${PAD.top} width=${step} height=${H - PAD.top - PAD.bottom}>
          <title>${strings.learningPoint(p.n, p.rate)}</title>
        </rect>`,
      )}
    </svg>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'll-learning': LlLearning
  }
}
