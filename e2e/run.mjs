// End-to-end scenarios against the real app window: WebView2 driven over CDP, files checked on disk.
//
//   npm run build:e2e   builds the debug app with the e2e config (debugging port 9223)
//   npm run test:e2e    copies the fixture vault to a temp folder and runs every scenario
//                       (E2E_SCREENSHOTS=<dir> saves a picture of the window after each one;
//                       E2E_COLOR_SCHEME=dark runs it in the dark scheme)
//
// The one seam: the folder picker is a native dialog, so the vault is opened through the same
// `open_vault` command the picker's result goes to. Everything after that is clicks and typing.

import { spawn } from 'node:child_process'
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { parseFormdown } from '@formdown/core'
import { Cdp, findPage } from './cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const exe = join(here, '..', 'src-tauri', 'target', 'debug', process.platform === 'win32' ? 'lowline.exe' : 'lowline')
const PORT = 9223
/** The e2e build's identifier (src-tauri/tauri.e2e.conf.json), which names its WebView2 profile. */
const IDENTIFIER = 'com.iyulab.lowline.e2e'
const TEMPLATE = '서식/버그 리포트.fd.md'
/** The fixture vault's templates: their names, references and files. */
const BUG = { name: '버그 리포트', ref: 'bug-report@1', path: TEMPLATE }
const INTAKE = { name: '접수', ref: 'intake@1', path: '서식/접수.fd.md' }
/** The template's inline title field (`제목: ___@제목`). */
const TITLE = '[data-field-name="제목"]'

/** In-page helpers: queries that pierce shadow roots, and element boxes for real clicks. */
const HELPERS = `window.__e2e = {
  all(selector, root = document) {
    const found = [...root.querySelectorAll(selector)]
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) found.push(...this.all(selector, el.shadowRoot))
    return found
  },
  one(selector, text) {
    // An item's text may lead with an icon ("▦ 문서"); the label is what follows.
    const matches = (el) => {
      const t = el.textContent.replace(/\\s+/g, ' ').trim()
      return t === text || t.endsWith(' ' + text)
    }
    return this.all(selector).find((el) => text === undefined || matches(el))
  },
  box(el) {
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  },
}; true`

const q = (s) => JSON.stringify(s)

class App {
  /** Starts the app and waits for its window. */
  static async launch() {
    const app = new App()
    app.child = spawn(exe, [], { stdio: 'ignore' })
    try {
      const page = await findPage(PORT)
      app.cdp = await Cdp.connect(page.webSocketDebuggerUrl)
      await app.ready()
      return app
    } catch (e) {
      // A window that never answered must not outlive the run (nor keep this process alive).
      await app.quit()
      throw e
    }
  }

  /** Ends the app the hard way — nothing it holds in memory survives. */
  async quit() {
    this.cdp?.close()
    const child = this.child
    if (!child) return
    child.kill()
    await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)))
    this.child = undefined
    // WebView2's browser process outlives the app by seconds, and closes its debugging port before
    // it exits. The next launch must start a browser of its own: one that joins a browser still
    // shutting down never opens the debugging port. So wait for the processes, not just the port.
    await portClosed(PORT)
    await webviewGone()
  }

  /**
   * Ends the app and starts it again on the same vault, in the same App — with the device's projection
   * caches dropped in between when `dropCaches`, so only the vault is left to rebuild from.
   */
  async restart(vault, { dropCaches = false } = {}) {
    await this.quit()
    assert.equal(await sidecarsRunning(), 0, 'the sidecar went with the app')
    if (dropCaches) await rm(join(process.env.LOCALAPPDATA ?? tmpdir(), IDENTIFIER, 'projections'), { recursive: true, force: true })
    const next = await App.launch()
    this.child = next.child
    this.cdp = next.cdp
    await this.openVault(vault)
  }

  async ready() {
    await this.cdp.waitFor(`customElements.get('ll-app') && !!document.querySelector('ll-app')`, 'the app')
    await this.cdp.evaluate(HELPERS)
    const scheme = process.env.E2E_COLOR_SCHEME
    if (scheme) await this.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
  }

  async openVault(path) {
    const name = await this.cdp.evaluate(`(async () => {
      const app = document.querySelector('ll-app')
      app.vaultInfo = await window.__TAURI_INTERNALS__.invoke('open_vault', { path: ${q(path)} })
      return app.vaultInfo.name
    })()`)
    assert.ok(name, 'vault opened')
  }

  /** Clicks the element matching `selector` (and `text`, if given) with the mouse. */
  async click(selector, text) {
    const box = await this.cdp.waitFor(
      `(() => { const el = __e2e.one(${q(selector)}, ${q(text)}); return el && !el.disabled && __e2e.box(el) })()`,
      `${selector}${text ? ` "${text}"` : ''} to be clickable`,
    )
    await this.cdp.clickAt(box)
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

/** Documents the fixture vault ships with: confirmed intake records suggestions learn from. */
const FIXTURE_DOCUMENT = /^접수-\d+\.md$/

/** The documents the scenarios created. */
async function documentsIn(vault) {
  return (await readdir(join(vault, '문서'))).filter((n) => n.endsWith('.md') && !FIXTURE_DOCUMENT.test(n))
}

/** Every suggestion event the vault holds, oldest first. */
async function events(vault) {
  const dir = join(vault, '.lowline', 'events')
  const files = existsSync(dir) ? await readdir(dir) : []
  const lines = []
  for (const f of files) lines.push(...(await readFile(join(dir, f), 'utf8')).split('\n').filter(Boolean))
  return lines.map((l) => JSON.parse(l))
}

/** This device's record of the suggestions it showed, outside the vault (one file per vault). */
async function presentations() {
  const dir = join(process.env.LOCALAPPDATA ?? tmpdir(), IDENTIFIER, 'presentations')
  const files = existsSync(dir) ? await readdir(dir) : []
  const lines = []
  for (const f of files) lines.push(...(await readFile(join(dir, f), 'utf8')).split('\n').filter(Boolean))
  return lines.map((l) => JSON.parse(l))
}

const fileValues = async (path) => parseFormdown(await readFile(path, 'utf8')).frontMatter?.data ?? {}

/** Everything after the front matter. */
async function fileBody(path) {
  const source = await readFile(path, 'utf8')
  const span = parseFormdown(source).frontMatter?.span
  assert.ok(span, `${path} has front matter`)
  return source.slice(span.end)
}

const scenarios = {
  async 'starts the sidecar with the app'(app) {
    const status = await app.cdp.waitFor(
      `window.__TAURI_INTERNALS__.invoke('host_status').then((s) => s.state !== 'starting' && s)`,
      'the sidecar to start',
      { timeoutMs: 30_000 },
    )
    assert.deepEqual(status, { state: 'ready' })
  },

  async 'edits a template and saves it with Ctrl+S'(app, vault) {
    await app.templateOf(BUG)
    await app.cdp.waitFor(`__e2e.one('textarea')?.value.includes('id: bug-report')`, 'the template source')
    await app.cdp.evaluate(`(() => { const t = __e2e.one('textarea'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); return true })()`)
    await app.cdp.insertText('\n메모: ___@메모\n')
    await app.cdp.press('s', { code: 'KeyS', modifiers: 2, keyCode: 83 })
    await app.status('저장했습니다')
    await app.noAlert()
    const onDisk = await readFile(join(vault, TEMPLATE), 'utf8')
    assert.equal(onDisk, await app.value('textarea'), 'file = editor text')
    assert.match(onDisk, /메모: ___@메모\n$/)
  },

  async 'says when the open template is removed outside, and saving makes it again'(app, vault) {
    const path = join(vault, TEMPLATE)
    const before = await readFile(path, 'utf8')
    await rm(path)
    await app.cdp.waitFor(
      `__e2e.all('[role=alert]').some((el) => el.textContent.includes('밖에서 지워졌습니다'))`,
      'the removal announced',
    )
    assert.equal(await app.value('textarea'), before, 'what was on screen is still there')

    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    assert.equal(await readFile(path, 'utf8'), before, 'made again with what was on screen')
    await app.noAlert()
  },

  async 'turns suggestions on for a field from the template page, and shows it on the document'(app, vault) {
    const path = join(vault, TEMPLATE)
    await app.templateOf(BUG)
    await app.cdp.waitFor(`__e2e.one('textarea')?.value.includes('id: bug-report')`, 'the template source')
    await app.click('dc-checkbox', '심각도')
    await app.cdp.waitFor(`/lowline:\\s*\\n\\s*suggest:/.test(__e2e.one('textarea')?.value)`, 'the choice written into the source')
    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    assert.deepEqual(parseFormdown(await readFile(path, 'utf8')).frontMatter?.data?.lowline, { suggest: ['심각도'] })

    await app.newDocument(BUG)
    await app.cdp.waitFor(
      `__e2e.all('p.judgment').some((el) => el.textContent.includes('제안 받는 칸: 심각도'))`,
      'the judgment field named on the document',
      { timeoutMs: 30_000 },
    )

    // Off again: the key goes, and the rest of the file is as it was.
    await app.templateOf(BUG)
    await app.cdp.waitFor(`__e2e.one('textarea')?.value.includes('suggest:')`, 'the template source')
    await app.click('dc-checkbox', '심각도')
    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    assert.equal(parseFormdown(await readFile(path, 'utf8')).frontMatter?.data?.lowline, undefined)
    await app.noAlert()
  },

  async 'edits the options of a choice field from the template page, in its place in the source'(app, vault) {
    const path = join(vault, TEMPLATE)
    await app.templateOf(BUG)
    await app.cdp.waitFor(`__e2e.one('textarea')?.value.includes('id: bug-report')`, 'the template source')
    const before = await app.value('textarea')
    const enter = () => app.cdp.press('Enter', { code: 'Enter', keyCode: 13 })
    assert.equal(await app.value('input[aria-label="심각도 선택지"]'), '낮음, 보통, 높음')

    await app.type('input[aria-label="심각도 선택지"]', '낮음, 보통, 높음, 긴급')
    await enter()
    await app.cdp.waitFor(`__e2e.one('textarea')?.value.includes('options="낮음,보통,높음,긴급"')`, 'the options written into the field')
    assert.equal(
      await app.value('textarea'),
      before.replace('options="낮음,보통,높음"', 'options="낮음,보통,높음,긴급"'),
      'nothing else in the source changed',
    )
    await app.cdp.waitFor(`__e2e.all('select[name="심각도"] option').some((o) => o.value === '긴급')`, 'the new option in the preview')

    // A field keeps at least one option: clearing them writes nothing and shows the source's again.
    await app.type('input[aria-label="환경 선택지"]', ' , ')
    await enter()
    await app.cdp.waitFor(`__e2e.one('input[aria-label="환경 선택지"]')?.value === '윈도우, 맥'`, 'the options as the source holds them')
    assert.ok((await app.value('textarea')).includes('@환경: [radio options="윈도우,맥"]'))

    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    assert.equal(await readFile(path, 'utf8'), await app.value('textarea'), 'file = editor text')

    // As it was, for the scenarios after this one.
    await app.type('input[aria-label="심각도 선택지"]', '낮음, 보통, 높음')
    await enter()
    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    assert.equal(await readFile(path, 'utf8'), before)
    await app.noAlert()
  },

  async 'completes a field as it is typed into the source, and one undo takes the completion away'(app, vault) {
    const path = join(vault, TEMPLATE)
    await app.templateOf(BUG)
    await app.cdp.waitFor(`__e2e.one('textarea')?.value.includes('id: bug-report')`, 'the template source')
    const before = await app.value('textarea')
    const source = () => app.value('textarea')
    await app.cdp.evaluate(`(() => { const t = __e2e.one('textarea'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); return true })()`)

    // Three underscores after text start an inline field: its name follows the @ put after them.
    await app.cdp.insertText('\n요청자: ___')
    await app.cdp.waitFor(`__e2e.one('textarea').value.endsWith('요청자: ___@')`, 'the @ after the underscores')
    await app.cdp.insertText('요청자')
    assert.ok((await source()).endsWith('\n요청자: ___@요청자'))

    // One undo takes the completion away and leaves what was typed.
    await app.cdp.insertText('\n비고: ___')
    await app.cdp.waitFor(`__e2e.one('textarea').value.endsWith('비고: ___@')`, 'the @ after the underscores')
    await app.cdp.press('z', { code: 'KeyZ', modifiers: 2, keyCode: 90 })
    await app.cdp.waitFor(`__e2e.one('textarea').value.endsWith('비고: ___')`, 'the completion undone')

    // A block field's brackets open after its name, with the caret inside for the type.
    await app.cdp.insertText('\n@분류: ')
    await app.cdp.waitFor(`__e2e.one('textarea').value.endsWith('@분류: []')`, 'the brackets after the name')
    await app.cdp.insertText('select options="가,나"')
    assert.ok((await source()).endsWith('\n@분류: [select options="가,나"]'))
    await app.cdp.waitFor(`__e2e.all('select[name="분류"] option').some((o) => o.value === '나')`, 'the new field in the preview')

    // A line of underscores alone is a Markdown rule: nothing is added.
    await app.cdp.evaluate(`(() => { const t = __e2e.one('textarea'); t.setSelectionRange(t.value.length, t.value.length); return true })()`)
    await app.cdp.insertText('\n___')
    await app.cdp.evaluate(`new Promise((resolve) => setTimeout(resolve, 200))`)
    assert.ok((await source()).endsWith('\n___'))

    // As it was, for the scenarios after this one.
    await app.cdp.evaluate(`(() => { const t = __e2e.one('textarea'); t.focus(); t.select(); return true })()`)
    await app.cdp.insertText(before)
    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    assert.equal(await readFile(path, 'utf8'), before)
    await app.noAlert()
  },

  async 'renames a template, and its documents stay with it'(app, vault) {
    const enter = () => app.cdp.press('Enter', { code: 'Enter', keyCode: 13 })
    const renamed = { ...BUG, name: '결함 보고', path: '서식/결함 보고.fd.md' }
    const before = await readFile(join(vault, TEMPLATE), 'utf8')
    await app.documentsOf(BUG)
    const documents = await app.documentLabels()

    await app.templateOf(BUG)
    await app.cdp.waitFor(`__e2e.one('textarea')?.value.includes('id: bug-report')`, 'the template source')
    await app.click('dc-button', '이름 바꾸기')
    // A name another template has is refused.
    await app.type('input[aria-label="새 이름"]', '접수')
    await enter()
    await app.cdp.waitFor(`__e2e.all('[role=alert]').some((el) => el.textContent.includes('같은 이름의 서식이 이미 있습니다'))`, 'the name refused')
    await app.type('input[aria-label="새 이름"]', renamed.name)
    await enter()
    await app.status('이름을 바꿨습니다')

    const files = await readdir(join(vault, '서식'))
    assert.ok(files.includes('결함 보고.fd.md') && !files.includes('버그 리포트.fd.md'), files.join(', '))
    assert.equal(await readFile(join(vault, renamed.path), 'utf8'), before, 'the same file under its new name')
    await app.cdp.waitFor(`!!__e2e.one('button.item', '결함 보고') && !__e2e.one('button.item', '버그 리포트')`, 'the sidebar showing its new name')
    await app.documentsOf(renamed)
    await app.cdp.waitFor(`__e2e.all('ll-documents').length === 1`, 'its documents')
    assert.deepEqual(await app.documentLabels(), documents, 'its documents are still its own')

    // As it was, for the scenarios after this one.
    await app.templateOf(renamed)
    await app.click('dc-button', '이름 바꾸기')
    await app.type('input[aria-label="새 이름"]', BUG.name)
    await enter()
    await app.status('이름을 바꿨습니다')
    assert.equal(await readFile(join(vault, TEMPLATE), 'utf8'), before)
    await app.noAlert()
  },

  async 'creates a template from the starter, labelled in Korean'(app, vault) {
    await app.newTemplate()
    await app.cdp.waitFor(`__e2e.one('textarea')?.value.includes('@상태:')`, 'the starter template')
    const created = (await readdir(join(vault, '서식'))).filter((n) => n.startsWith('새 서식'))
    assert.equal(created.length, 1, 'one starter template on disk')
    assert.equal(await readFile(join(vault, '서식', created[0]), 'utf8'), await app.value('textarea'), 'file = editor text')
    const labels = await app.cdp.waitFor(
      `(() => { const l = __e2e.all('label').map((el) => el.textContent.trim()); return l.includes('상태') && l })()`,
      'the preview labels',
    )
    assert.ok(labels.includes('메모'), `labels: ${labels.join(', ')}`)
    // Back to the fixture template for the scenarios that follow.
    await app.templateOf(BUG)
    await app.cdp.waitFor(`__e2e.one('textarea')?.value.includes('id: bug-report')`, 'the fixture template')
  },

  async 'creates a document, edits it, and saves again in place'(app, vault) {
    await app.newDocument(BUG)
    // Looking at an empty field is not an edit: focus in and out leaves nothing to save.
    await app.cdp.waitFor(`(() => { const t = __e2e.one(${q(TITLE)}); if (!t) return false; t.focus(); t.blur(); return true })()`, 'the empty title')
    await app.cdp.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
    assert.equal(await app.cdp.evaluate(`__e2e.one('dc-button', '저장').disabled`), true, 'a focus and blur alone leave Save off')
    await app.type(TITLE, '저장 후 멈춤')
    await app.choose('select[name="심각도"]', '높음')
    await app.type('textarea[name="재현_절차"]', '1. 문서를 연다\n2. 저장한다')
    await app.click('input[name="재현됨"]')
    await app.click('input[name="환경"][value="맥"]')
    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    await app.noAlert()

    const created = await documentsIn(vault)
    assert.equal(created.length, 1, 'one document created')
    const path = join(vault, '문서', created[0])
    assert.match(created[0], /^\d{4}-\d{2}-\d{2}-저장 후 멈춤\.md$/, 'named after the first text field')
    const { lowline, ...saved } = await fileValues(path)
    assert.match(lowline?.id ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'a new document names itself')
    assert.deepEqual(
      saved,
      { template: 'bug-report@1', 제목: '저장 후 멈춤', 심각도: '높음', 재현_절차: '1. 문서를 연다\n2. 저장한다', 재현됨: true, 환경: '맥' },
    )
    const bodyBefore = await fileBody(path)
    assert.match(bodyBefore, /# 버그 리포트/)

    await app.type(TITLE, '저장 후 화면이 멈춤')
    // Saved again with Ctrl+S, from inside the field being typed in — as a template is.
    await app.cdp.press('s', { code: 'KeyS', modifiers: 2, keyCode: 83 })
    await app.status('저장했습니다')
    await app.noAlert()
    assert.deepEqual(await documentsIn(vault), created, 'saved in place, no new file')
    const values = await fileValues(path)
    assert.equal(values.제목, '저장 후 화면이 멈춤')
    assert.equal(values.심각도, '높음')
    assert.equal(values.재현됨, true, 'an untouched checkbox keeps its value through a save')
    assert.equal(values.환경, '맥')
    assert.equal(await app.value(TITLE), values.제목, 'screen = file')
    const bodyAfter = await fileBody(path)
    assert.equal(bodyAfter, bodyBefore, 'the body is untouched by a value change')
  },

  async 'reopens the saved document with the values from the file'(app, vault) {
    await app.cdp.send('Page.reload')
    await app.ready()
    await app.openVault(vault)
    const [name] = await documentsIn(vault)
    await app.openDocument(BUG, name.replace(/\.md$/, ''))
    const values = await fileValues(join(vault, '문서', name))
    await app.cdp.waitFor(`__e2e.one(${q(TITLE)})?.textContent === ${q(values.제목)}`, 'the title from the file')
    assert.equal(await app.value('select[name="심각도"]'), values.심각도)
    assert.equal(await app.value('textarea[name="재현_절차"]'), values.재현_절차)
    assert.equal(await app.checked('input[name="재현됨"]'), true, 'the checkbox reopens checked')
    assert.equal(await app.checked('input[name="환경"][value="맥"]'), true, 'the radio reopens on its value')

    // Unchecking is a value too: it must reach the file and come back unchecked.
    await app.click('input[name="재현됨"]')
    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    assert.equal((await fileValues(join(vault, '문서', name))).재현됨, false)
    await app.cdp.send('Page.reload')
    await app.ready()
    await app.openVault(vault)
    await app.openDocument(BUG, name.replace(/\.md$/, ''))
    await app.cdp.waitFor(`__e2e.one(${q(TITLE)})?.textContent === ${q(values.제목)}`, 'the document again')
    assert.equal(await app.checked('input[name="재현됨"]'), false, 'the checkbox reopens unchecked')
    await app.noAlert()
  },

  async 'shows an edit made outside the app, and never replaces an unsaved one'(app, vault) {
    // The document is open from the scenario before, with nothing unsaved.
    const [name] = await documentsIn(vault)
    const path = join(vault, '문서', name)
    const severity = async (value) => writeFile(path, (await readFile(path, 'utf8')).replace(/^심각도: .*$/m, `심각도: ${value}`))

    await severity('낮음')
    await app.status('밖에서 바뀌어 다시 읽었습니다')
    assert.equal(await app.value('select[name="심각도"]'), '낮음', 'the open document shows the outside edit')

    // With an unsaved edit, an outside edit is announced and nothing typed is lost.
    await app.choose('select[name="심각도"]', '보통')
    await severity('높음')
    await app.cdp.waitFor(
      `__e2e.all('[role=alert]').some((el) => el.textContent.includes('밖에서 바뀌었습니다'))`,
      'the outside edit announced',
    )
    assert.equal(await app.value('select[name="심각도"]'), '보통', 'the unsaved edit is kept')

    // Saving decides. The save is the app's own write: it is not taken for an outside edit.
    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    assert.equal((await fileValues(path)).심각도, '보통')
    await app.cdp.evaluate(`new Promise((resolve) => setTimeout(resolve, 1500))`)
    await app.status('저장했습니다')
    await app.noAlert()

    // Or the person keeps what is on disk: reading it again drops the unsaved edit.
    await app.choose('select[name="심각도"]', '낮음')
    await severity('높음')
    await app.click('dc-button', '밖의 내용으로 다시 읽기')
    await app.status('밖에서 바뀌어 다시 읽었습니다')
    assert.equal(await app.value('select[name="심각도"]'), '높음', 'the outside edit is shown')
    assert.equal((await fileValues(path)).심각도, '높음', 'the file is left as the outside edit made it')
    await app.noAlert()
  },

  async 'says when the open document is removed outside, and saving makes it again'(app, vault) {
    // Another device removed the document this one has open; a sync client carries the removal here.
    const [name] = await documentsIn(vault)
    const path = join(vault, '문서', name)
    const before = await fileValues(path)
    await rm(path)
    await app.cdp.waitFor(
      `__e2e.all('[role=alert]').some((el) => el.textContent.includes('밖에서 지워졌습니다'))`,
      'the removal announced',
    )
    assert.equal(await app.value('select[name="심각도"]'), before.심각도, 'what was on screen is still there')

    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    assert.ok((await documentsIn(vault)).includes(name), 'made again under its own name')
    assert.deepEqual(await fileValues(path), before, 'with the values that were on screen')
    await app.noAlert()
  },

  async 'makes a copied document its own when the copy is saved'(app, vault) {
    // A file copied outside the app carries its original's id.
    const [name] = await documentsIn(vault)
    const original = join(vault, '문서', name)
    const copyName = name.replace(/\.md$/, ' - 복사본.md')
    const copy = join(vault, '문서', copyName)
    await writeFile(copy, await readFile(original, 'utf8'))
    const { lowline } = await fileValues(original)
    assert.equal((await fileValues(copy)).lowline.id, lowline.id)

    await app.openDocument(BUG, copyName.replace(/\.md$/, ''))
    await app.cdp.waitFor(`__e2e.all('nav button[aria-current="true"]').some((b) => b.textContent.includes('복사본'))`, 'the copy open')
    await app.choose('select[name="심각도"]', '보통')
    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    const saved = await fileValues(copy)
    assert.equal(saved.심각도, '보통')
    assert.notEqual(saved.lowline.id, lowline.id, 'the copy that was changed is a new document')
    assert.equal((await fileValues(original)).lowline.id, lowline.id, 'the original keeps its id')
    await app.noAlert()

    // The scenarios after this one expect the one document.
    await app.openDocument(BUG, name.replace(/\.md$/, ''))
    await rm(copy)
    await app.cdp.waitFor(`!__e2e.all('nav button').some((b) => b.textContent.includes('복사본'))`, 'the copy gone from the list')
    await app.noAlert()
  },
  async 'shows each document as one row of its template table'(app, vault) {
    await app.showTable(BUG)
    const [name] = await documentsIn(vault)
    const values = await fileValues(join(vault, '문서', name))
    const rows = await app.cdp.waitFor(
      `(() => { const rows = __e2e.all('tbody tr'); return rows.length > 0 && rows.map((tr) => [...tr.children].map((cell) => cell.textContent.trim())) })()`,
      'the table rows',
      { timeoutMs: 30_000 },
    )
    const headers = await app.cdp.evaluate(`__e2e.all('thead th').map((th) => th.textContent)`)
    assert.deepEqual(headers, ['제목', '심각도', '재현 절차', '재현됨', '환경', '메모'])
    assert.equal(rows.length, 1, 'one row per document, however often it was saved')
    const row = Object.fromEntries(headers.map((h, i) => [h, rows[0][i]]))
    assert.equal(row.제목, values.제목)
    assert.equal(row.심각도, values.심각도)
    assert.equal(row.재현됨, values.재현됨 ? '✓' : '')
    assert.equal(row.환경, values.환경)
    await app.noAlert()
  },
  async 'opens a document from its table row'(app, vault) {
    const [name] = await documentsIn(vault)
    const values = await fileValues(join(vault, '문서', name))
    // The row's first cell is a button: a keyboard opens the row the way a click does.
    await app.click('tbody th button', values.제목)
    await app.cdp.waitFor(
      `__e2e.one('nav button[aria-current="true"]')?.textContent.trim() === ${JSON.stringify(name.replace(/\.md$/, ''))}`,
      "the documents view with the row's document open",
    )
    assert.equal(await app.value('select[name="심각도"]'), values.심각도)
    await app.noAlert()
  },
  async 'suggests a judgment value from confirmed documents, and saves it once accepted'(app, vault) {
    const before = new Set(await documentsIn(vault))
    await app.newDocument(INTAKE)
    await app.type('[data-field-name="요청"]', '노트북 배터리가 금방 닳아요')
    await app.choose('select[name="부서"]', '영업')
    // The suggestion is drawn by the field it is for: its value to take, what it rests on, and a way to decline.
    const note = await app.cdp.waitFor(
      `__e2e.all('[data-formdown-note="담당"]').filter((el) => el.querySelector('.formdown-suggestion')).map((el) => el.textContent.replace(/\\s+/g, ' ').trim())[0]`,
      'a suggestion for 담당',
      { timeoutMs: 15_000 },
    )
    assert.match(note, /^제안 · 비슷한 기록: 접수-1/)
    assert.equal(await app.cdp.evaluate(`__e2e.one('.formdown-suggestion')?.textContent`), '장비')
    assert.equal(await app.cdp.evaluate(`__e2e.one('.formdown-decline')?.textContent`), '거절')
    assert.equal(await app.value('select[name="담당"]'), '', 'nothing is filled in before it is accepted')
    await app.click('.formdown-suggestion', '장비')
    await app.cdp.waitFor(`__e2e.one('select[name="담당"]')?.value === '장비'`, 'the accepted value in the form')
    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    await app.noAlert()

    const created = (await documentsIn(vault)).filter((n) => !before.has(n))
    assert.equal(created.length, 1)
    const values = await fileValues(join(vault, '문서', created[0]))
    assert.equal(values.담당, '장비')
    assert.equal(values.요청, '노트북 배터리가 금방 닳아요')

    const [accepted] = await events(vault)
    // The event names the document by its id, not by where its file is.
    assert.deepEqual(
      { doc: accepted.doc, field: accepted.field, kind: accepted.kind, suggested: accepted.suggested, value: accepted.value },
      { doc: values.lowline.id, field: '담당', kind: 'accept', suggested: '장비', value: '장비' },
    )
    // The fixture documents predate ids: they are known by their paths.
    assert.equal(accepted.recall, '문서/접수-1.md')
    // When it was shown and taken, and what was filled by then — names only.
    assert.equal(accepted.template, 'intake@1')
    // The suggestion may first show after 요청 alone or after both: either way, in the order they were filled.
    assert.ok(['["요청"]', '["요청","부서"]'].includes(JSON.stringify(accepted.filled)), JSON.stringify(accepted.filled))
    assert.ok(Date.parse(accepted.shownAt) <= Date.parse(accepted.decidedAt), 'shown before it was taken')
    assert.ok(Date.parse(accepted.decidedAt) <= Date.parse(accepted.at), 'taken before the save confirmed it')
    // What was shown is kept on this device, outside the vault, without the value.
    const shown = await presentations()
    assert.ok(shown.some((p) => p.template === 'intake@1' && p.field === '담당' && p.at === accepted.shownAt), JSON.stringify(shown))
    assert.ok(!JSON.stringify(shown).includes('장비'), 'no value in the record of what was shown')
  },

  async 'records a rejected suggestion when the document is saved without it'(app, vault) {
    await app.newDocument(INTAKE)
    // A new document from the same template starts empty: nothing carries over from the last one.
    await app.cdp.waitFor(
      `__e2e.one('select[name="부서"]')?.value === '' && __e2e.one('[data-field-name="요청"]')?.textContent === ''`,
      'an empty form',
    )
    await app.type('[data-field-name="요청"]', '급여 명세서를 다시 받고 싶어요')
    await app.choose('select[name="부서"]', '개발')
    await app.cdp.waitFor(`__e2e.all('.formdown-suggestion').length === 1`, 'a suggestion for 담당', { timeoutMs: 15_000 })
    await app.click('.formdown-decline', '거절')
    await app.cdp.waitFor(`__e2e.all('[data-formdown-note]').length === 0`, 'the suggestion to be set aside')
    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    await app.noAlert()

    await app.cdp.evaluate(`new Promise((resolve) => setTimeout(resolve, 1000))`)
    assert.equal(await app.cdp.evaluate(`__e2e.all('.formdown-suggestion').length`), 0, 'a rejected suggestion does not come back after saving')
    const all = await events(vault)
    assert.equal(all.length, 2, 'one event per confirmation, not per save')
    assert.deepEqual([all[1].kind, all[1].suggested, all[1].value], ['reject', '인사', null])

    // Reopened, the document still has the rejection: the sidecar learned it from the event file.
    // Opening it again starts a fresh draft: nothing of the last one is kept in the window.
    const rejectedIn = []
    for (const name of await documentsIn(vault)) {
      if ((await fileValues(join(vault, '문서', name))).lowline?.id === all[1].doc) rejectedIn.push(name)
    }
    assert.equal(rejectedIn.length, 1, 'the event names one document by its id')
    await app.pickDocument(rejectedIn[0].replace(/\.md$/, ''))
    await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent.includes('급여')`, 'the reopened document')
    await app.cdp.evaluate(`new Promise((resolve) => setTimeout(resolve, 2000))`)
    assert.equal(await app.cdp.evaluate(`__e2e.all('.formdown-suggestion').length`), 0, 'a rejected suggestion is not offered on reopening')
  },
  async 'shows nothing when no confirmed record is close enough to suggest from'(app, vault) {
    await app.newDocument(INTAKE)
    await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent === ''`, 'an empty form')
    await app.type('[data-field-name="요청"]', '사내 동호회 가입 신청서 양식')
    await app.choose('select[name="부서"]', '개발')
    // Suggestions are asked for once typing pauses; this waits well past that and the answer.
    await app.cdp.evaluate(`new Promise((resolve) => setTimeout(resolve, 2500))`)
    assert.equal(await app.cdp.evaluate(`__e2e.all('.formdown-suggestion').length`), 0, 'no suggestion is made up')
    assert.equal(await app.value('select[name="담당"]'), '', 'nothing is filled in')
    // Why the field is empty is said, with how much it has to learn from.
    const why = await app.cdp.evaluate(`__e2e.all('[data-formdown-note="담당"]').map((el) => el.textContent.trim())[0]`)
    assert.match(why ?? '', /^확정한 \d+건 중 비슷한 기록이 없어 제안하지 않습니다\.$/)

    // Saving it records no suggestion event: nothing was offered, so nothing was decided.
    const eventsBefore = (await events(vault)).length
    const documentsBefore = new Set(await documentsIn(vault))
    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    assert.equal((await events(vault)).length, eventsBefore, 'no suggestion event')
    const [saved] = (await documentsIn(vault)).filter((n) => !documentsBefore.has(n))
    assert.ok(saved, 'the document is saved')
    assert.ok(!(await fileValues(join(vault, '문서', saved))).담당, 'the file has no 담당 either')
    await app.noAlert()
  },
  async 'rebuilds the same table and the same suggestion after a restart, from its cache or from the vault alone'(app, vault) {
    const tableNow = async () => {
      await app.showTable(INTAKE)
      return app.cdp.waitFor(
        `(() => { const rows = __e2e.all('tbody tr'); const text = rows.map((tr) => tr.textContent.replace(/\\s+/g, ' ').trim()); return text.some((t) => t.includes('급여')) && text })()`,
        'the intake table',
        { timeoutMs: 30_000 },
      )
    }
    const suggestionNow = async () => {
      await app.newDocument(INTAKE)
      await app.type('[data-field-name="요청"]', '노트북 배터리가 또 금방 닳아요')
      return app.cdp.waitFor(
        `__e2e.all('.formdown-suggestion').map((el) => el.closest('[data-formdown-note]').textContent.replace(/\\s+/g, ' ').trim())[0]`,
        'a suggestion for 담당',
        { timeoutMs: 30_000 },
      )
    }

    const table = await tableNow()
    const suggestion = await suggestionNow()
    assert.equal(table.length, 5, 'two fixture records and the three made above')

    await app.restart(vault)
    assert.deepEqual(await tableNow(), table, 'the same table from the cache')
    assert.equal(await suggestionNow(), suggestion, 'the same suggestion')

    await app.restart(vault, { dropCaches: true })
    assert.deepEqual(await tableNow(), table, 'the same table from the vault alone')
    assert.equal(await suggestionNow(), suggestion, 'the same suggestion from the vault alone')
    await app.noAlert()
  },
  async 'asks before dropping unsaved edits'(app) {
    // The scenario before left a new document typed into and not saved.
    await app.documentsOf(INTAKE)
    const typed = await app.cdp.evaluate(`__e2e.one('[data-field-name="요청"]')?.textContent`)
    assert.ok(typed, 'an unsaved draft is open')

    await app.pickDocument('접수-1')
    await app.answerUnsaved('계속 편집')
    assert.equal(await app.cdp.evaluate(`__e2e.one('[data-field-name="요청"]')?.textContent`), typed, 'the edits are kept')

    // Another template or another tab asks too; keeping the edits keeps the sidebar and the tab where they are.
    await app.sidebar(BUG.name)
    await app.answerUnsaved('계속 편집')
    await app.click('button[role="tab"]', '표')
    await app.answerUnsaved('계속 편집')
    assert.deepEqual(await app.where(), { place: INTAKE.name, tab: '문서' }, 'still where the edits are')
    assert.equal(await app.cdp.evaluate(`__e2e.one('[data-field-name="요청"]')?.textContent`), typed, 'the edits are still kept')

    await app.pickDocument('접수-1')
    await app.answerUnsaved('편집 버리기')
    await app.cdp.waitFor(`__e2e.one('nav button[aria-current="true"]')?.textContent.trim() === '접수-1'`, 'the other document open')
    await app.noAlert()
  },
  async 'imports rows copied from a spreadsheet, and suggests from them'(app, vault) {
    const before = new Set(await documentsIn(vault))
    await app.documentsOf(INTAKE)
    await app.click('dc-button', '가져오기')
    const rows = [
      ['요청', '부서', '담당', '비고'],
      ['프린터 토너가 떨어졌어요', '영업', '총무', '지난달'],
      // A cell with a line break comes quoted, the way spreadsheets copy it.
      ['"회의실 프로젝터가\n안 켜져요"', '개발', '경비', ''],
      ['', '', '', '비고만 있는 행'],
    ]
    const text = rows.map((r) => r.join('\t')).join('\n')
    const zone = `__e2e.all('textarea').find((t) => t.getRootNode().host?.localName === 'dc-paste-rows-zone')`
    await app.cdp.waitFor(`Boolean(${zone})`, 'the paste zone')
    await app.cdp.evaluate(`(() => {
      const data = new DataTransfer()
      data.setData('text/plain', ${q(text)})
      ${zone}.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
      return true
    })()`)
    await app.status('문서 2건을 만듭니다 · 빈 행 1개는 건너뜁니다')
    assert.ok(
      await app.cdp.evaluate(`__e2e.all('li').some((li) => li.textContent.trim() === '3행 담당: 경비')`),
      'a value the field does not offer is shown',
    )
    assert.ok(
      await app.cdp.evaluate(`__e2e.all('td').some((td) => td.textContent.trim() === '가져오지 않음')`),
      'an unmatched column is shown',
    )
    await app.click('dc-button', '2건 가져오기')
    await app.status('2건을 가져왔습니다')
    await app.noAlert()

    const created = (await documentsIn(vault)).filter((n) => !before.has(n))
    assert.equal(created.length, 2, 'one document per row that fills a field')
    const values = await Promise.all(created.map((n) => fileValues(join(vault, '문서', n))))
    const toner = values.find((v) => v.요청 === '프린터 토너가 떨어졌어요')
    assert.deepEqual([toner?.template, toner?.부서, toner?.담당], ['intake@1', '영업', '총무'])
    assert.equal(values.find((v) => v.요청 === '회의실 프로젝터가\n안 켜져요')?.담당, '경비', 'kept as written, line break and all')

    // Imported records are confirmed values: a similar new record gets the imported answer suggested.
    await app.newDocument(INTAKE)
    await app.type('[data-field-name="요청"]', '프린터 토너가 또 떨어졌어요')
    await app.choose('select[name="부서"]', '영업')
    const suggestion = await app.cdp.waitFor(
      `__e2e.all('.formdown-suggestion').map((el) => el.closest('[data-formdown-note]').textContent.replace(/\\s+/g, ' ').trim())[0]`,
      'a suggestion for 담당',
      { timeoutMs: 30_000 },
    )
    assert.ok(suggestion.includes('총무'), `suggested from the import: ${suggestion}`)
    await app.noAlert()
  },
  async 'shows how often suggestions were right, from the event files'(app, vault) {
    // The scenario before left a new document typed into: leaving it asks first.
    await app.learning()
    await app.answerUnsaved('편집 버리기')
    const figures = await app.cdp.waitFor(
      `(() => { const h = __e2e.all('h2').find((el) => el.textContent.trim() === '접수 · 담당'); return h && h.parentElement.querySelector('.figures').textContent.replace(/\\s+/g, ' ').trim() })()`,
      'the curve of 접수 · 담당',
      { timeoutMs: 30_000 },
    )
    const decided = (await events(vault)).filter((e) => e.field === '담당')
    const accepted = decided.filter((e) => e.kind === 'accept').length
    const rejected = decided.filter((e) => e.kind === 'reject').length
    assert.equal(decided.length, 2, 'one accepted and one rejected suggestion so far')
    assert.ok(figures.includes(`수락 ${accepted} · 교정 0 · 거절 ${rejected}`), figures)
    assert.ok(figures.includes('제안이 나온 2건 중 1건 맞음'), figures) // too few for a share
    assert.ok(decided.every((e) => e.template === 'intake@1'), 'events name their template')

    // Weekly counts to hand over by hand: numbers only, the form's name shown beside them but not in them.
    const counts = JSON.parse(
      await app.cdp.waitFor(`__e2e.all('details.counts pre')[0]?.textContent`, 'the weekly counts', { timeoutMs: 30_000 }),
    )
    assert.equal(counts.format, 'lowline-weekly-counts/1')
    const intake = counts.counts.filter((c) => c.form === 1 && c.field === 1)
    assert.deepEqual(
      [intake.reduce((n, c) => n + c.accepted, 0), intake.reduce((n, c) => n + c.rejected, 0)],
      [accepted, rejected],
      'the decisions counted',
    )
    const presented = intake.reduce((n, c) => n + c.presented, 0)
    assert.ok(presented >= accepted + rejected, `each decision was shown first (${presented} shown)`)
    const text = JSON.stringify(counts)
    for (const secret of ['접수', '담당', 'intake', '문서', '장비', '인사']) assert.ok(!text.includes(secret), `no ${secret} in the counts`)
    const legend = await app.cdp.evaluate(`__e2e.all('details.counts li').map((li) => li.textContent.trim())`)
    assert.ok(legend[0].startsWith('서식 1 = 접수'), legend[0])
    await app.noAlert()
  },

  async 'shows a sync conflict copy beside its original, and learns from neither until one is kept'(app, vault) {
    // A sync client kept another device's edit of 접수-1 as a copy.
    const copy = join(vault, '문서', '접수-1 (다른 기기의 충돌된 사본 2026-09-29).md')
    const copyPath = '문서/접수-1 (다른 기기의 충돌된 사본 2026-09-29).md'
    const original = await readFile(join(vault, '문서', '접수-1.md'), 'utf8')
    // What the shell announces from here on. A copy made and removed within one debounce window is
    // no change at all, so each step waits until the app has heard of it before the next is taken.
    await app.cdp.evaluate(`(() => { window.__changes = []; const T = window.__TAURI_INTERNALS__
      return T.invoke('plugin:event|listen', { event: 'vault-changed', target: { kind: 'Any' }, handler: T.transformCallback((e) => window.__changes.push(e.payload)) }) })()`)
    const heard = (kind) =>
      app.cdp.waitFor(`window.__changes.some((c) => c.${kind}.includes(${q(copyPath)}))`, `the copy ${kind} announced`, { timeoutMs: 15_000 })
    await writeFile(copy, original.replace('담당: 장비', '담당: 총무'))
    try {
      await heard('written')
      await app.documentsOf(INTAKE)
      const listed = () => app.documentLabels()
      await app.cdp.waitFor(`__e2e.all('nav button').some((b) => b.textContent.includes('충돌 사본 — 원본: 접수-1'))`, 'the copy, with its original', { timeoutMs: 15_000 })
      assert.ok((await listed()).includes('접수-1 충돌 사본 있음'), 'the original, marked as having a copy')

      // The same request that was suggested 장비 from 접수-1 is now answered only from other records.
      await app.newDocument(INTAKE)
      await app.type('[data-field-name="요청"]', '노트북 배터리가 금방 닳아요')
      const note = await app.cdp.waitFor(
        `__e2e.all('.formdown-suggestion').map((el) => el.closest('[data-formdown-note]').textContent.replace(/\\s+/g, ' ').trim())[0]`,
        'a suggestion for 담당',
        { timeoutMs: 15_000 },
      )
      assert.doesNotMatch(note, /접수-1/, 'the unsettled original is not a similar record')
      assert.doesNotMatch(note, /총무/, 'nor is its copy')

      await app.pickDocument('접수-1 충돌 사본 있음')
      await app.answerUnsaved('편집 버리기')
      await app.cdp.waitFor(`__e2e.all('p.conflict').some((p) => p.textContent.includes('제안이 이 문서에서 배우지 않습니다'))`, 'what the conflict means')
      await app.noAlert()
    } finally {
      await rm(copy, { force: true })
    }
    // Keeping one file settles it.
    await heard('removed')
    await app.cdp.waitFor(`!__e2e.one('nav button', '접수-1 충돌 사본 있음') && __e2e.all('p.conflict').length === 0`, 'the conflict settled', { timeoutMs: 15_000 })
  },

  async "keeps a conflict copy in its original's place, and learns from it again"(app, vault) {
    const trashedFrom = (folder) => (process.platform === 'win32' ? takeFromRecycleBin(join(vault, folder)) : Promise.resolve(null))
    const asked = (heading) =>
      app.cdp.waitFor(`__e2e.all('dc-confirm-dialog').some((d) => d.open && d.heading === ${q(heading)})`, `the question "${heading}"`)
    await app.cdp.evaluate(`(() => { window.__changes = []; const T = window.__TAURI_INTERNALS__
      return T.invoke('plugin:event|listen', { event: 'vault-changed', target: { kind: 'Any' }, handler: T.transformCallback((e) => window.__changes.push(e.payload)) }) })()`)
    const written = (path) =>
      app.cdp.waitFor(`window.__changes.some((c) => c.written.includes(${q(path)}))`, `${path} announced`, { timeoutMs: 15_000 })

    // A document: another device's edit of 접수-1, kept from the original's page.
    const originalDoc = join(vault, '문서', '접수-1.md')
    const copyDocPath = '문서/접수-1 (다른 기기의 충돌된 사본 2026-09-30).md'
    const before = await readFile(originalDoc, 'utf8')
    await writeFile(join(vault, copyDocPath), before.replace('담당: 장비', '담당: 총무'))
    try {
      await written(copyDocPath)
      await app.documentsOf(INTAKE)
      await app.cdp.waitFor(`!!__e2e.one('nav button', '접수-1 충돌 사본 있음')`, 'the original with its copy', { timeoutMs: 15_000 })
      await app.pickDocument('접수-1 충돌 사본 있음')
      await app.click('dc-button', '사본 보기')
      await app.cdp.waitFor(`__e2e.one('nav button[aria-current="true"]')?.textContent.includes('충돌 사본 — 원본: 접수-1')`, 'the copy open')
      await app.click('dc-button', '이 사본을 남기기')
      await asked('이 사본을 남길까요?')
      await app.click('dc-button', '사본 남기기')
      await app.status('사본을 남겼습니다. 원본은 휴지통에 있습니다.')
      await app.noAlert()
      assert.ok(!existsSync(join(vault, copyDocPath)), 'the copy took the original’s name')
      assert.match(await readFile(originalDoc, 'utf8'), /담당: 총무/, 'the original’s name holds what the copy held')
      const trashed = await trashedFrom('문서')
      if (trashed) assert.deepEqual(trashed, ['접수-1.md'], 'the original in the Recycle Bin')
      await app.cdp.waitFor(
        `__e2e.one('nav button[aria-current="true"]')?.textContent.trim() === '접수-1' && __e2e.all('p.conflict').length === 0`,
        'the original’s name open, settled',
      )

      // Settled, it is a similar record again — with the value that was kept.
      await app.newDocument(INTAKE)
      await app.type('[data-field-name="요청"]', '노트북 배터리가 금방 닳아요')
      await app.cdp.waitFor(
        `__e2e.all('.formdown-suggestion').some((el) => { const n = el.closest('[data-formdown-note]').textContent; return n.includes('접수-1') && n.includes('총무') })`,
        '총무 suggested from 접수-1',
        { timeoutMs: 15_000 },
      )
      await app.templateOf(INTAKE)
      await app.answerUnsaved('편집 버리기')
    } finally {
      await rm(join(vault, copyDocPath), { force: true })
      await writeFile(originalDoc, before)
    }
    await written('문서/접수-1.md')

    // A template: its copy is not in the sidebar; the original's page shows it.
    const originalTemplate = join(vault, INTAKE.path)
    const copyTemplatePath = '서식/접수.fd.sync-conflict-20260930-101500-ABCDEFG.md'
    const templateBefore = await readFile(originalTemplate, 'utf8')
    const showCopy = async () => {
      await writeFile(join(vault, copyTemplatePath), `${templateBefore.trimEnd()}\n\n메모: ___@메모\n`)
      await written(copyTemplatePath)
      await app.templateOf(INTAKE)
      await app.click('dc-button', '사본 보기')
      await app.cdp.waitFor(`__e2e.one('textarea')?.value.includes('메모: ___@메모')`, 'the copy’s source')
    }
    try {
      // Deleting the copy keeps the original, which is shown again.
      await showCopy()
      await app.click('dc-button', '지우기')
      await asked('이 사본을 지울까요?')
      await app.click('dc-button', '휴지통으로 옮기기')
      await app.status('사본을 휴지통으로 옮기고 원본을 남겼습니다.')
      assert.ok(!existsSync(join(vault, copyTemplatePath)), 'the copy gone')
      assert.equal(await app.value('textarea'), templateBefore, 'the original shown again')
      const trashedCopy = await trashedFrom('서식')
      if (trashedCopy) assert.deepEqual(trashedCopy, ['접수.fd.sync-conflict-20260930-101500-ABCDEFG.md'])

      // Keeping the copy: the template the app knows under the original's name holds what the copy held.
      await showCopy()
      await app.click('dc-button', '이 사본을 남기기')
      await asked('이 사본을 남길까요?')
      await app.click('dc-button', '사본 남기기')
      await app.status('사본을 남겼습니다. 원본은 휴지통에 있습니다.')
      assert.ok(!existsSync(join(vault, copyTemplatePath)), 'the copy took the original’s name')
      assert.match(await readFile(originalTemplate, 'utf8'), /메모: ___@메모/)
      assert.match(await app.value('textarea'), /메모: ___@메모/, 'the kept template shown')
      const trashedOriginal = await trashedFrom('서식')
      if (trashedOriginal) assert.deepEqual(trashedOriginal, ['접수.fd.md'], 'the original in the Recycle Bin')
      await app.cdp.waitFor(`__e2e.all('p.conflict').length === 0`, 'settled')
      await app.noAlert()
    } finally {
      await rm(join(vault, copyTemplatePath), { force: true })
      await writeFile(originalTemplate, templateBefore)
    }
    await written(INTAKE.path)
  },

  async 'renames a document, and what was recorded about it stays with it'(app, vault) {
    const rows = async () => {
      await app.showTable(INTAKE)
      return app.cdp.waitFor(`(() => { const n = __e2e.all('tbody tr').length; return n > 0 && n })()`, 'the intake table', { timeoutMs: 30_000 })
    }
    const rowsBefore = await rows()
    const enter = () => app.cdp.press('Enter', { code: 'Enter', keyCode: 13 })
    const refused = (text) => app.cdp.waitFor(`__e2e.all('[role=alert]').some((el) => el.textContent.includes(${JSON.stringify(text)}))`, `refused: ${text}`)
    const original = join(vault, '문서', '접수-2.md')
    const before = await readFile(original, 'utf8')
    const valuesBefore = await fileValues(original)
    assert.ok(!valuesBefore.lowline?.id, 'a document known by its path')

    await app.documentsOf(INTAKE)
    await app.pickDocument('접수-2')
    await app.cdp.waitFor(`__e2e.one('nav button[aria-current="true"]')?.textContent.trim() === '접수-2'`, 'the document open')
    await app.click('dc-button', '이름 바꾸기')

    // A name another document has is refused, and so is one no file can have; nothing moves.
    await app.type('input[aria-label="새 이름"]', '접수-1')
    await enter()
    await refused('같은 이름의 문서가 이미 있습니다')
    await app.type('input[aria-label="새 이름"]', '프린터/토너')
    await enter()
    await refused('파일 이름에 쓸 수 없는 글자')
    assert.equal(await readFile(original, 'utf8'), before)

    await app.type('input[aria-label="새 이름"]', '프린터 토너 문의')
    await enter()
    await app.status('이름을 바꿨습니다')
    const names = await documentsIn(vault)
    assert.ok(names.includes('프린터 토너 문의.md') && !names.includes('접수-2.md'), names.join(', '))
    const moved = await fileValues(join(vault, '문서', '프린터 토너 문의.md'))
    // Known by its old path until now, it keeps that path as its id: its events still name it.
    assert.equal(moved.lowline?.id, '문서/접수-2.md')
    assert.equal(moved.요청, valuesBefore.요청, 'its values as they were')
    await app.cdp.waitFor(`__e2e.one('nav button[aria-current="true"]')?.textContent.trim() === '프린터 토너 문의'`, 'the list showing its new name')
    assert.equal(await rows(), rowsBefore, 'still one row in its table')
    await app.noAlert()
  },

  async 'lists apart the documents whose template is not in the vault, while there are any'(app, vault) {
    const stray = join(vault, '문서', '옛 서식 문서.md')
    await writeFile(stray, '---\ntemplate: retired@1\n제목: 남은 기록\n---\n# 옛 서식\n\n제목: ___@제목\n')
    try {
      await app.sidebar('서식 없는 문서', { timeoutMs: 15_000 })
      await app.cdp.waitFor(`__e2e.all('nav button').some((b) => b.textContent.trim() === '옛 서식 문서')`, 'the stray document listed')
      assert.ok(!(await app.documentLabels()).includes('접수-1'), "a template's documents are not listed there")
      await app.pickDocument('옛 서식 문서')
      await app.cdp.waitFor(`__e2e.one('[data-field-name="제목"]')?.textContent === '남은 기록'`, 'the stray document open')
    } finally {
      await rm(stray, { force: true })
    }
    // Once none is left, the place goes, and so does the app from it.
    await app.cdp.waitFor(`!__e2e.one('button.item:not(.group-toggle)', '서식 없는 문서')`, 'the place gone', { timeoutMs: 15_000 })
    assert.equal((await app.where()).place, BUG.name, 'back at the first template')
    await app.noAlert()
  },

  async "deletes a document and a template to the system trash; the template's documents stay"(app, vault) {
    const trashedFrom = (folder) => (process.platform === 'win32' ? takeFromRecycleBin(join(vault, folder)) : Promise.resolve(null))
    const asked = (heading) =>
      app.cdp.waitFor(`__e2e.all('dc-confirm-dialog').some((d) => d.open && d.heading === ${q(heading)})`, `the question "${heading}"`)
    const doc = join(vault, '문서', '지울 문의.md')
    await writeFile(doc, `---\ntemplate: intake@1\n요청: 지울 기록\n---\n${(await fileBody(join(vault, INTAKE.path))).trimStart()}`)
    await app.documentsOf(INTAKE)
    await app.cdp.waitFor(`__e2e.all('nav button').some((b) => b.textContent.trim() === '지울 문의')`, 'the document listed', { timeoutMs: 15_000 })
    const others = (await app.documentLabels()).filter((l) => l !== '지울 문의')
    await app.pickDocument('지울 문의')
    await app.cdp.waitFor(`__e2e.one('nav button[aria-current="true"]')?.textContent.trim() === '지울 문의'`, 'the document open')

    // Asked first; cancelling leaves it.
    await app.click('dc-button', '지우기')
    await asked('이 문서를 지울까요?')
    await app.click('dc-button', '취소')
    await app.cdp.waitFor(`!__e2e.all('dc-confirm-dialog').some((d) => d.open)`, 'the question gone')
    assert.ok(existsSync(doc), 'kept when cancelled')

    // Unsaved edits: the question says they go too.
    await app.type('[data-field-name="요청"]', '고치던 중')
    await app.click('dc-button', '지우기')
    await asked('이 문서를 지울까요?')
    await app.cdp.waitFor(
      `__e2e.all('dc-confirm-dialog').some((d) => d.open && d.textContent.includes('저장하지 않은 편집은 함께 사라집니다'))`,
      'the unsaved edits named',
    )
    await app.click('dc-button', '휴지통으로 옮기기')
    await app.status('휴지통으로 옮겼습니다')
    assert.ok(!existsSync(doc), 'gone from the vault')
    const trashedDoc = await trashedFrom('문서')
    if (trashedDoc) assert.deepEqual(trashedDoc, ['지울 문의.md'], 'in the Recycle Bin, not deleted')
    assert.deepEqual(await app.documentLabels(), others, 'the other documents stay')
    // Deleting its edits with it was asked about: nothing is left unsaved to ask about again.
    await app.showTable(INTAKE)
    assert.equal((await app.where()).tab, '표')

    // A template: its documents are not deleted with it, and are listed apart.
    const template = join(vault, '서식', '지울 서식.fd.md')
    const templateDoc = join(vault, '문서', '지울 서식 기록.md')
    await writeFile(template, '---\nid: retiring\nversion: 1\n---\n# 지울 서식\n\n제목: ___@제목\n')
    await writeFile(templateDoc, '---\ntemplate: retiring@1\n제목: 남길 기록\n---\n# 지울 서식\n\n제목: ___@제목\n')
    try {
      await app.tabOf({ name: '지울 서식' }, '서식', { timeoutMs: 15_000 })
      await app.cdp.waitFor(`__e2e.one('textarea')?.value.includes('id: retiring')`, 'the template source')
      await app.click('dc-button', '지우기')
      await asked('이 서식을 지울까요?')
      await app.click('dc-button', '휴지통으로 옮기기')
      await app.cdp.waitFor(
        `__e2e.all('[role=status]').some((el) => el.textContent.includes('서식을 휴지통으로 옮겼습니다') && el.textContent.includes('서식 없는 문서'))`,
        'the template deleted, its documents pointed to',
      )
      assert.ok(!existsSync(template), 'the template gone from the vault')
      assert.ok(existsSync(templateDoc), 'its document stays')
      const trashedTemplate = await trashedFrom('서식')
      if (trashedTemplate) assert.deepEqual(trashedTemplate, ['지울 서식.fd.md'], 'in the Recycle Bin, not deleted')
      await app.cdp.waitFor(`!__e2e.one('button.item', '지울 서식')`, 'the template gone from the sidebar')
      await app.sidebar('서식 없는 문서', { timeoutMs: 15_000 })
      await app.cdp.waitFor(`__e2e.all('nav button').some((b) => b.textContent.trim() === '지울 서식 기록')`, 'its document listed apart')
    } finally {
      await rm(template, { force: true })
      await rm(templateDoc, { force: true })
    }
    await app.cdp.waitFor(`!__e2e.one('button.item:not(.group-toggle)', '서식 없는 문서')`, 'the place gone', { timeoutMs: 15_000 })
    await app.noAlert()
  },

  async 'writes an error report with the kind of failure and nothing of what was on screen'(app) {
    const reports = join(process.env.LOCALAPPDATA ?? tmpdir(), IDENTIFIER, 'logs', 'reports.jsonl')
    const before = existsSync(reports) ? (await readFile(reports, 'utf8')).split('\n').filter(Boolean).length : 0
    await app.cdp.evaluate(`setTimeout(() => { throw new RangeError('문서/비밀 회의록.md — 담당: 장비') }), true`)
    await app.cdp.evaluate(`Promise.reject({ kind: 'outside-vault', message: 'C:\\\\Users\\\\홍길동' }), true`)
    // A request the sidecar fails: a template with no reference cannot be a form type.
    await app.cdp.evaluate(`window.__TAURI_INTERNALS__.invoke('host_ingest', { snapshot: { templates: [{ ref: '', fields: [] }],
      documents: [{ path: '문서/비밀 회의록.md', template: '', values: { 담당: '장비' } }] } }).catch(() => {}), true`)
    const deadline = Date.now() + 10_000
    let lines = []
    while (Date.now() < deadline) {
      lines = existsSync(reports) ? (await readFile(reports, 'utf8')).split('\n').filter(Boolean).slice(before) : []
      if (lines.length >= 3) break
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    const written = lines.map((line) => JSON.parse(line))
    assert.deepEqual(written.slice(0, 2).map((r) => [r.layer, r.kind]), [['ui', 'RangeError'], ['ui', 'outside-vault']])
    const host = written.find((r) => r.layer === 'host')
    assert.ok(host && host.kind !== 'Unrecognized' && host.frames.length > 0, `the sidecar's failure: ${JSON.stringify(host)}`)
    assert.ok(!lines.join('\n').match(/비밀|회의록|장비|홍길동|Users/), `nothing of the page: ${lines.join(' ')}`)
    await app.noAlert()
  },

  async 'makes a new vault in an empty folder, starting from a sample with a judgment field'(app, vault) {
    const empty = await mkdtemp(join(tmpdir(), 'lowline-e2e-new-'))
    const taken = await mkdtemp(join(tmpdir(), 'lowline-e2e-taken-'))
    await writeFile(join(taken, 'note.md'), 'mine')
    // The folder picker is the seam: the folder it answers with goes to the same method.
    const make = (path) => app.cdp.evaluate(`document.querySelector('ll-app').makeVault(${JSON.stringify(path)}).then(() => true)`)
    try {
      // The first screen says what a vault is, and offers the two ways in.
      await app.cdp.evaluate(`(document.querySelector('ll-app').vaultInfo = undefined, true)`)
      await app.cdp.waitFor(`!!__e2e.one('dc-button', '새 볼트 만들기') && !!__e2e.one('dc-button', '기존 폴더 열기')`, 'the two ways in')
      assert.ok(await app.cdp.evaluate(`__e2e.all('.welcome p').some((p) => p.textContent.includes('서식과 문서를 담는 폴더'))`))

      // A folder that holds anything is not made a vault: nothing is written beside someone's files.
      await make(taken)
      await app.cdp.waitFor(`__e2e.all('[role=alert]').some((el) => el.textContent.includes('빈 폴더를 고르세요'))`, 'the folder refused')
      assert.deepEqual(await readdir(taken), ['note.md'])

      await make(empty)
      await app.cdp.waitFor(`!!__e2e.one('dc-button', '새 문서')`, "the sample's documents")
      assert.deepEqual(await readdir(join(empty, '서식')), ['문의 접수.fd.md'])
      const sample = parseFormdown(await readFile(join(empty, '서식', '문의 접수.fd.md'), 'utf8'))
      assert.deepEqual(sample.frontMatter?.data?.lowline, { suggest: ['담당'] })
      assert.ok(!existsSync(join(empty, '문서')), 'no documents: suggestions learn only from what a person confirms')

      await app.click('dc-button', '새 문서')
      await app.cdp.waitFor(`__e2e.all('p.judgment').some((el) => el.textContent.includes('제안 받는 칸: 담당'))`, 'its judgment field', { timeoutMs: 30_000 })
      const why = await app.cdp.waitFor(`__e2e.all('[data-formdown-note="담당"]').map((el) => el.textContent.trim())[0]`, 'why 담당 has no suggestion yet')
      assert.match(why, /^확정한 문서가 아직 없어/)
      await app.noAlert()
    } finally {
      await app.openVault(vault) // back to the vault the scenarios after this one use
      await rm(empty, { recursive: true, force: true })
      await rm(taken, { recursive: true, force: true })
    }
  },

  // With LOWLINE_PERF=1: what reading one file through the shell costs, the step a full read of
  // the vault repeats once per document.
  ...(process.env.LOWLINE_PERF === '1' && {
    async 'measures reading files through the shell'(app, vault) {
      const [name] = await documentsIn(vault)
      const path = `문서/${name}`
      const ms = await app.cdp.evaluate(`(async () => {
        const invoke = window.__TAURI_INTERNALS__.invoke
        for (let i = 0; i < 50; i++) await invoke('read_file', { path: ${JSON.stringify(path)} })
        const started = performance.now()
        for (let i = 0; i < 1000; i++) await invoke('read_file', { path: ${JSON.stringify(path)} })
        const sequential = performance.now() - started
        const again = performance.now()
        await Promise.all(Array.from({ length: 1000 }, () => invoke('read_file', { path: ${JSON.stringify(path)} })))
        const all = performance.now() - again
        const batch = performance.now()
        await invoke('read_files', { paths: Array.from({ length: 1000 }, () => ${JSON.stringify(path)}) })
        return [Math.round(sequential), Math.round(all), Math.round(performance.now() - batch)]
      })()`)
      console.log(`    1000 reads through the shell · one at a time ${ms[0]} ms · all at once ${ms[1]} ms · in one call ${ms[2]} ms`)
    },
    async 'measures one outside edit in a vault of 10,000 documents'(app, vault) {
      const COUNT = 10_000
      const file = (i) => join(vault, '문서', `perf-${String(i).padStart(5, '0')}.md`)
      const source = await readFile(join(vault, '문서', '접수-1.md'), 'utf8')
      for (let i = 0; i < COUNT; i += 500) {
        await Promise.all(
          Array.from({ length: Math.min(500, COUNT - i) }, (_, j) =>
            writeFile(file(i + j), source.replace('노트북 배터리가 금방 닳아요', `노트북 배터리가 금방 닳아요 (${i + j})`)),
          ),
        )
      }
      // A fresh start reads the full vault once, filling the cache.
      const filled = Date.now()
      await app.restart(vault)
      await app.showTable(INTAKE, { timeoutMs: 300_000 })
      await app.cdp.waitFor(`__e2e.all('tbody tr').some((tr) => tr.textContent.includes('(0)'))`, 'the large table', { timeoutMs: 300_000 })
      const first = Date.now() - filled

      await app.cdp.evaluate(`performance.clearMeasures()`)
      const edited = Date.now()
      await writeFile(file(0), source.replace('노트북 배터리가 금방 닳아요', '노트북 충전기가 고장났어요 (고침)'))
      await app.cdp.waitFor(`__e2e.all('tbody tr').some((tr) => tr.textContent.includes('(고침)'))`, 'the edit in the table', { timeoutMs: 120_000 })
      const edit = Date.now() - edited
      const steps = await app.cdp.evaluate(
        `Object.fromEntries(performance.getEntriesByType('measure').filter((m) => m.name.startsWith('vault:')).map((m) => [m.name.slice(6), Math.round(m.duration)]))`,
      )
      console.log(
        `    ${COUNT} documents · restart to table ${first} ms · one outside edit to table ${edit} ms · last sync ${Object.entries(steps).map(([k, v]) => `${k} ${v} ms`).join(' · ')}`,
      )
    },
  }),
}

/** Waits until nothing answers on the debugging port: the last window's browser has gone. */
async function portClosed(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`the browser on debugging port ${port} did not go away`)
}

/**
 * What a failed scenario leaves behind, so an intermittent failure can be read afterwards: a
 * picture of the window and what the page was saying (alerts and status lines). In E2E_SCREENSHOTS
 * when set, otherwise in the system temp folder.
 */
async function failureEvidence(app, name) {
  try {
    const dir =
      process.env.E2E_SCREENSHOTS ?? join(tmpdir(), 'lowline-e2e-failures', new Date().toISOString().replace(/[:.]/g, '-'))
    await screenshot(app.cdp, dir, `FAILED ${name}`)
    const said = await app.cdp.evaluate(
      `[
        ...__e2e.all('dc-confirm-dialog').filter((d) => d.open).map((d) => 'dialog: ' + d.heading),
        ...__e2e.all('[role=alert], [role=status]').map((el) => el.getAttribute('role') + ': ' + el.textContent.trim()),
      ].filter((t) => !t.endsWith(': '))`,
    )
    // What the sidecar says: a failure there is kept off the screen (suggestions are optional).
    const sidecar = await app.cdp.evaluate(
      `(async () => { const T = window.__TAURI_INTERNALS__; const out = {}
        for (const cmd of ['host_status', 'host_curves']) {
          try { out[cmd] = JSON.stringify(await T.invoke(cmd)).slice(0, 300) } catch (e) { out[cmd] = 'error: ' + JSON.stringify(e) }
        }
        return out })()`,
    )
    // The error reports hold a failure's kind and frames only, nothing of the page: safe to print.
    const reports = join(process.env.LOCALAPPDATA ?? tmpdir(), IDENTIFIER, 'logs', 'reports.jsonl')
    const reported = existsSync(reports) ? (await readFile(reports, 'utf8')).split('\n').filter(Boolean).slice(-3) : []
    console.log(
      `    page: ${JSON.stringify(said)}\n    sidecar: ${JSON.stringify(sidecar)}\n    reports: ${reported.join('\n             ')}\n    evidence: ${dir}`,
    )
  } catch (e) {
    console.log(`    (no evidence: ${e.message})`)
  }
}

/** With E2E_SCREENSHOTS=<dir>, each passed scenario leaves a picture of the window. */
async function screenshot(cdp, dir, name) {
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(dir, { recursive: true })
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(dir, `${name.replace(/[^\p{L}\p{N}]+/gu, '-')}.png`), Buffer.from(data, 'base64'))
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

/**
 * The names of what the Recycle Bin holds from `folder`, taken out of it for good — so a scenario
 * checks that a file went to the trash (and was not just deleted) and leaves nothing behind there.
 */
async function takeFromRecycleBin(folder) {
  const { execFileSync } = await import('node:child_process')
  const script = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
    $bin = (New-Object -ComObject Shell.Application).NameSpace(10)
    $names = @()
    foreach ($item in @($bin.Items())) {
      if ($bin.GetDetailsOf($item, 1) -ne $env:E2E_TRASHED_FROM) { continue }
      $names += $bin.GetDetailsOf($item, 0)
      # Each item is two files: $R… holds the content, $I… where it came from.
      Remove-Item -LiteralPath $item.Path -Recurse -Force
      Remove-Item -LiteralPath (Join-Path (Split-Path $item.Path) ('$I' + (Split-Path $item.Path -Leaf).Substring(2))) -Force -ErrorAction SilentlyContinue
    }
    ConvertTo-Json -InputObject @($names) -Compress`
  const out = execFileSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    env: { ...process.env, E2E_TRASHED_FROM: folder },
  })
  return JSON.parse(out.trim() || '[]')
}

async function sidecarsRunning() {
  const { execFileSync } = await import('node:child_process')
  for (let i = 0; i < 20; i++) {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Lowline.Host.exe', '/NH'], { encoding: 'utf8' })
    if (!out.includes('Lowline.Host.exe')) return 0
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return 1
}

async function main() {
  if (!existsSync(exe)) throw new Error(`no e2e build at ${exe} — run \`npm run build:e2e\` first`)
  const vault = await mkdtemp(join(tmpdir(), 'lowline-e2e-'))
  await cp(join(here, 'fixtures', 'vault'), vault, { recursive: true })
  // Each run's vault is a new folder, so an earlier run's projection cache and record of suggestions
  // shown would only pile up.
  for (const dir of ['projections', 'presentations'])
    await rm(join(process.env.LOCALAPPDATA ?? tmpdir(), IDENTIFIER, dir), { recursive: true, force: true })

  let app
  let failed = 0
  try {
    app = await App.launch()
    await app.openVault(vault)
    // Scenarios run in order against one window: each builds on the files the last one left.
    for (const [name, run] of Object.entries(scenarios)) {
      try {
        await run(app, vault)
        console.log(`  ✓ ${name}`)
        if (process.env.E2E_SCREENSHOTS) await screenshot(app.cdp, process.env.E2E_SCREENSHOTS, name)
      } catch (e) {
        failed++
        console.log(`  ✗ ${name}\n    ${e.message.replaceAll('\n', '\n    ')}`)
        await failureEvidence(app, name)
        break
      }
    }
  } finally {
    await app?.quit()
    await rm(vault, { recursive: true, force: true })
  }
  // The sidecar lives in the app's job object: when the app is gone, so is the sidecar.
  if (process.platform === 'win32' && (await sidecarsRunning()) > 0) {
    failed++
    console.log('  ✗ the sidecar outlived the app')
  }
  console.log(failed ? `\n${failed} scenario failed` : `\nall ${Object.keys(scenarios).length} scenarios passed`)
  process.exitCode = failed ? 1 : 0
}

await main()
