// End-to-end scenarios against the real app window: WebView2 driven over CDP, files checked on disk.
//
//   npm run build:e2e   builds the debug app with the e2e config (debugging port 9223)
//   npm run test:e2e    copies the fixture vault to a temp folder and runs every scenario
//
// The one seam: the folder picker is a native dialog, so the vault is opened through the same
// `open_vault` command the picker's result goes to. Everything after that is clicks and typing.

import { spawn } from 'node:child_process'
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
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
const TEMPLATE = '서식/버그 리포트.fd.md'
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
      const t = el.textContent.replace(/\s+/g, ' ').trim()
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
  constructor(cdp) {
    this.cdp = cdp
  }

  async ready() {
    await this.cdp.waitFor(`customElements.get('ll-app') && !!document.querySelector('ll-app')`, 'the app')
    await this.cdp.evaluate(HELPERS)
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

  value(selector) {
    return this.cdp.evaluate(`(() => { const el = __e2e.one(${q(selector)}); return el?.isContentEditable ? el.textContent : el?.value })()`)
  }

  checked(selector) {
    return this.cdp.evaluate(`__e2e.one(${q(selector)})?.checked`)
  }

  status(text) {
    return this.cdp.waitFor(`__e2e.all('[role=status]').some((el) => el.textContent.trim() === ${q(text)})`, `status "${text}"`)
  }

  async noAlert() {
    const alert = await this.cdp.evaluate(`__e2e.all('[role=alert]').map((el) => el.textContent.trim()).filter(Boolean).join(' / ')`)
    assert.equal(alert, '', 'no error shown')
  }
}

async function documentsIn(vault) {
  return (await readdir(join(vault, '문서'))).filter((n) => n.endsWith('.md'))
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
  async 'edits a template and saves it with Ctrl+S'(app, vault) {
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

  async 'creates a template from the starter, labelled in Korean'(app, vault) {
    await app.click('dc-button', '새 서식')
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
    await app.click('button', '버그 리포트')
    await app.cdp.waitFor(`__e2e.one('textarea')?.value.includes('id: bug-report')`, 'the fixture template')
  },

  async 'creates a document, edits it, and saves again in place'(app, vault) {
    await app.click('button', '문서')
    await app.choose('select#template', TEMPLATE)
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
    assert.deepEqual(
      { ...(await fileValues(path)) },
      { template: 'bug-report@1', 제목: '저장 후 멈춤', 심각도: '높음', 재현_절차: '1. 문서를 연다\n2. 저장한다', 재현됨: true, 환경: '맥' },
    )
    const bodyBefore = await fileBody(path)
    assert.match(bodyBefore, /# 버그 리포트/)

    await app.type(TITLE, '저장 후 화면이 멈춤')
    await app.click('dc-button', '저장')
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
    await app.click('button', '문서')
    const [name] = await documentsIn(vault)
    await app.click('button', name.replace(/\.md$/, ''))
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
    await app.click('button', '문서')
    await app.click('button', name.replace(/\.md$/, ''))
    await app.cdp.waitFor(`__e2e.one(${q(TITLE)})?.textContent === ${q(values.제목)}`, 'the document again')
    assert.equal(await app.checked('input[name="재현됨"]'), false, 'the checkbox reopens unchecked')
    await app.noAlert()
  },
}

async function main() {
  if (!existsSync(exe)) throw new Error(`no e2e build at ${exe} — run \`npm run build:e2e\` first`)
  const vault = await mkdtemp(join(tmpdir(), 'lowline-e2e-'))
  await cp(join(here, 'fixtures', 'vault'), vault, { recursive: true })

  const child = spawn(exe, [], { stdio: 'ignore' })
  let cdp
  let failed = 0
  try {
    const page = await findPage(PORT)
    cdp = await Cdp.connect(page.webSocketDebuggerUrl)
    const app = new App(cdp)
    await app.ready()
    await app.openVault(vault)
    // Scenarios run in order against one window: each builds on the files the last one left.
    for (const [name, run] of Object.entries(scenarios)) {
      try {
        await run(app, vault)
        console.log(`  ✓ ${name}`)
      } catch (e) {
        failed++
        console.log(`  ✗ ${name}\n    ${e.message.replaceAll('\n', '\n    ')}`)
        break
      }
    }
  } finally {
    cdp?.close()
    child.kill()
    await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)))
    await rm(vault, { recursive: true, force: true })
  }
  console.log(failed ? `\n${failed} scenario failed` : `\nall ${Object.keys(scenarios).length} scenarios passed`)
  process.exitCode = failed ? 1 : 0
}

await main()
