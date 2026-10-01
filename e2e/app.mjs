// The app's window, driven over CDP: launching the e2e build, opening a vault, clicking and typing
// the way a person does, and ending it the hard way. The scenarios in run.mjs use it; so can a
// one-off script that walks a flow and takes pictures:
//
//   import { App, screenshot } from '<lowline>/e2e/app.mjs'
//   const app = await App.launch()
//   await app.openVault(folder)
//   ...
//   await screenshot(app.cdp, dir, 'name')
//   await app.quit()

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { App as Window, helpers, pictureName } from '@iyulab/tauri-kit-dev/app'

const here = dirname(fileURLToPath(import.meta.url))
/** The e2e build (`npm run build:e2e`). */
export const exe = join(here, '..', 'src-tauri', 'target', 'debug', process.platform === 'win32' ? 'lowline.exe' : 'lowline')
/** The e2e build's debugging port, opened by its own WebView2 arguments (src-tauri/tauri.e2e.conf.json). */
const PORT = 9223
/** The e2e build's identifier (src-tauri/tauri.e2e.conf.json), which names its WebView2 profile. */
export const IDENTIFIER = 'com.iyulab.lowline.e2e'
/** Where the debug shell saves exports instead of asking in a save dialog no script can answer. */
export const EXPORTS = join(tmpdir(), 'lowline-e2e-exports')

export const q = (s) => JSON.stringify(s)

/** The window is ready once the app element is there. */
const READY = `customElements.get('ll-app') && !!document.querySelector('ll-app')`

// TODO(upstream: @iyulab/tauri-kit-dev — launch as a subclass, fill editable elements, webviewProfile) — once
// @iyulab/tauri-kit-dev ships `new this()` in launch, `fill` for editable elements and `webviewProfile`, this
// class extends its App instead of holding one, `type` becomes its `fill`, and `webviewGone` goes.
export class App {
  /** Starts the app and waits for its window. */
  static async launch() {
    const app = new App()
    app.window = await Window.launch({
      exe,
      port: PORT,
      ready: READY,
      env: { LOWLINE_EXPORT_TO: EXPORTS },
      debugPortFromEnv: false,
    })
    await app.ready()
    return app
  }

  /** Waits for the app in the window and sets the window up for the scenarios — again after a page reload. */
  async ready() {
    await this.cdp.waitFor(READY, 'the app')
    await this.cdp.evaluate(helpers())
    const scheme = process.env.E2E_COLOR_SCHEME
    if (scheme) await this.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
  }

  get cdp() {
    return this.window?.cdp
  }

  /** Ends the app the hard way — nothing it holds in memory survives. */
  async quit() {
    await this.window?.quit()
    this.window = undefined
    // WebView2's browser process outlives the app by seconds, and closes its debugging port before
    // it exits. The next launch must start a browser of its own: one that joins a browser still
    // shutting down never opens the debugging port. So wait for the processes, not just the port.
    await webviewGone()
  }

  /** Ends the app and starts it again, in this same App, without opening anything for it. */
  async relaunch() {
    await this.quit()
    this.window = (await App.launch()).window
  }

  /**
   * Ends the app and starts it again on the same vault, in the same App — with the device's projection
   * caches dropped in between when `dropCaches`, so only the vault is left to rebuild from.
   */
  async restart(vault, { dropCaches = false } = {}) {
    await this.quit()
    assert.equal(await sidecarsRunning(), 0, 'the sidecar went with the app')
    if (dropCaches) await rm(join(process.env.LOCALAPPDATA ?? tmpdir(), IDENTIFIER, 'projections'), { recursive: true, force: true })
    this.window = (await App.launch()).window
    await this.openVault(vault)
  }

  async openVault(path) {
    const name = await this.cdp.evaluate(`(async () => {
      const app = document.querySelector('ll-app')
      app.vaultInfo = await window.__TAURI_INTERNALS__.invoke('open_vault', { path: ${q(path)} })
      return app.vaultInfo.name
    })()`)
    assert.ok(name, 'vault opened')
  }

  /** Clicks the element matching `selector` (and `text`, if given) with the mouse, once a click there lands on it. */
  async click(selector, text) {
    await this.window.click(selector, text)
  }

  /** Focuses a field — a form control or an inline (contenteditable) field — and replaces its value by typing. */
  async type(selector, text) {
    await this.cdp.waitFor(
      `(() => { const el = __e2e.one(${q(selector)}); if (!el) return false; el.focus()
        if (el.isContentEditable) { const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r) }
        else el.select?.()
        return true })()`,
      selector,
    )
    await this.cdp.insertText(text)
  }

  /** Picks an option the way a dropdown does: set the value, report the change. */
  async choose(selector, value) {
    await this.cdp.waitFor(
      `(() => { const el = __e2e.one(${q(selector)}); if (!el || ![...el.options].some((o) => o.value === ${q(value)})) return false
        el.value = ${q(value)}; el.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true })); return true })()`,
      `${selector} to offer "${value}"`,
    )
  }

  // Where things are, in the app's own terms — which template, then what of it. Scenarios go through
  // these, so a change of layout changes them and not every scenario.

  /** Picks `label` in the sidebar — a template, or another place; the group heading is not one. */
  async sidebar(label, { timeoutMs } = {}) {
    const item = 'button.item:not(.group-toggle)'
    if (timeoutMs) await this.cdp.waitFor(`!!__e2e.one(${q(item)}, ${q(label)})`, `${label} in the sidebar`, { timeoutMs })
    await this.click(item, label)
  }

  /** Shows `tab` (표, 서식 or 문서) of `template`. */
  async tabOf(template, tab, options) {
    await this.sidebar(template.name, options)
    await this.click('button[role="tab"]', tab)
  }

  /** Shows the source of `template`. */
  async templateOf(template) {
    await this.tabOf(template, '서식')
  }

  /** Makes a template from the starter. */
  async newTemplate() {
    await this.sidebar('새 서식 만들기')
  }

  /** Starts a new document from `template`. */
  async newDocument(template) {
    await this.documentsOf(template)
    await this.click('dc-button', '새 문서')
  }

  /** Shows the documents of `template`: their list, and the document open, if any. */
  async documentsOf(template) {
    await this.tabOf(template, '문서')
  }

  /** Opens the document labelled `name` of `template`. */
  async openDocument(template, name) {
    await this.documentsOf(template)
    await this.pickDocument(name)
  }

  /** Clicks the document labelled `name` in the list on screen. */
  async pickDocument(name) {
    await this.click('nav button', name)
  }

  /** The labels of the document list on screen. */
  documentLabels() {
    return this.cdp.evaluate(`__e2e.all('ll-documents').flatMap((d) => [...d.shadowRoot.querySelectorAll('nav button')]).map((b) => b.textContent.replace(/\\s+/g, ' ').trim())`)
  }

  /** Shows the table of `template`; `timeoutMs` bounds the wait for a large vault to be read. */
  async showTable(template, { timeoutMs } = {}) {
    await this.tabOf(template, '표', { timeoutMs })
  }

  /** Shows how suggestions have fared. */
  async learning() {
    await this.sidebar('학습')
  }

  /** Where the sidebar and the tabs say the app is. */
  where() {
    return this.cdp.evaluate(`({
      place: __e2e.one('button.item[aria-current="page"]')?.textContent.replace(/\\s+/g, ' ').trim().replace(/^\\S+ /, ''),
      tab: __e2e.one('button[role="tab"][aria-selected="true"]')?.textContent.trim(),
    })`)
  }

  value(selector) {
    return this.cdp.evaluate(`(() => { const el = __e2e.one(${q(selector)}); return el?.isContentEditable ? el.textContent : el?.value })()`)
  }

  checked(selector) {
    return this.cdp.evaluate(`__e2e.one(${q(selector)})?.checked`)
  }

  status(text) {
    return this.cdp.waitFor(`__e2e.all('[role=status]').some((el) => el.textContent.trim() === ${q(text)})`, `status "${text}"`)
  }

  /** Waits for the unsaved-edits question and answers it with the button labelled `choice`. */
  async answerUnsaved(choice) {
    await this.cdp.waitFor(`__e2e.all('dc-confirm-dialog').some((d) => d.open)`, 'the unsaved-edits question')
    await this.click('dc-button', choice)
    await this.cdp.waitFor(`!__e2e.all('dc-confirm-dialog').some((d) => d.open)`, 'the question answered')
  }

  async noAlert() {
    const alert = await this.cdp.evaluate(`__e2e.all('[role=alert]').map((el) => el.textContent.trim()).filter(Boolean).join(' / ')`)
    assert.equal(alert, '', 'no error shown')
  }
}

/**
 * Waits until no WebView2 process runs on the e2e app's profile. The app was killed, so its
 * browser only notices after a while — sometimes longer than a scenario should wait. After a
 * grace period the leftovers, which belong to the e2e profile alone, are ended too.
 */
async function webviewGone(graceMs = 10_000) {
  if (process.platform !== 'win32') return // WebView2 is Windows' webview
  const { execFileSync } = await import('node:child_process')
  // The process table can still list a process that has exited while something holds a handle to
  // it; only ones Get-Process can open are running.
  const on = `Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${IDENTIFIER}*' -and (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue) }`
  const left = () => Number(execFileSync('powershell', ['-NoProfile', '-Command', `@(${on}).Count`], { encoding: 'utf8' }).trim())
  const deadline = Date.now() + graceMs
  while (Date.now() < deadline) {
    if (left() === 0) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  execFileSync('powershell', ['-NoProfile', '-Command', `${on} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`])
  for (let i = 0; i < 20; i++) {
    if (left() === 0) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`WebView2 on the ${IDENTIFIER} profile did not exit`)
}

export async function sidecarsRunning() {
  const { execFileSync } = await import('node:child_process')
  for (let i = 0; i < 20; i++) {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Lowline.Host.exe', '/NH'], { encoding: 'utf8' })
    if (!out.includes('Lowline.Host.exe')) return 0
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return 1
}

/** Saves a picture of the window as `<dir>/<name>.png`. */
export async function screenshot(cdp, dir, name) {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, pictureName(name)), await cdp.screenshot())
}
