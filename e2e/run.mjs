// End-to-end scenarios against the real app window: WebView2 driven over CDP, files checked on disk.
//
//   npm run build:e2e   builds the debug app with the e2e config (debugging port 9223)
//   npm run test:e2e    copies the fixture vault to a temp folder and runs every scenario
//                       (E2E_SCREENSHOTS=<dir> saves a picture of the window after each one)
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
  /** Starts the app and waits for its window. */
  static async launch() {
    const app = new App()
    app.child = spawn(exe, [], { stdio: 'ignore' })
    const page = await findPage(PORT)
    app.cdp = await Cdp.connect(page.webSocketDebuggerUrl)
    await app.ready()
    return app
  }

  /** Ends the app the hard way — nothing it holds in memory survives. */
  async quit() {
    this.cdp?.close()
    const child = this.child
    if (!child) return
    child.kill()
    await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)))
    this.child = undefined
  }

  /** Ends the app and starts it again on the same vault, in the same App. */
  async restart(vault) {
    await this.quit()
    assert.equal(await sidecarsRunning(), 0, 'the sidecar went with the app')
    const next = await App.launch()
    this.child = next.child
    this.cdp = next.cdp
    await this.openVault(vault)
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

  async 'shows each document as one row of its template table'(app, vault) {
    await app.click('button', '표')
    await app.choose('select#template', 'bug-report@1')
    const [name] = await documentsIn(vault)
    const values = await fileValues(join(vault, '문서', name))
    const rows = await app.cdp.waitFor(
      `(() => { const rows = __e2e.all('tbody tr'); return rows.length > 0 && rows.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)) })()`,
      'the table rows',
      { timeoutMs: 30_000 },
    )
    const headers = await app.cdp.evaluate(`__e2e.all('th').map((th) => th.textContent)`)
    assert.deepEqual(headers, ['제목', '심각도', '재현 절차', '재현됨', '환경', '메모'])
    assert.equal(rows.length, 1, 'one row per document, however often it was saved')
    const row = Object.fromEntries(headers.map((h, i) => [h, rows[0][i]]))
    assert.equal(row.제목, values.제목)
    assert.equal(row.심각도, values.심각도)
    assert.equal(row.재현됨, values.재현됨 ? '✓' : '')
    assert.equal(row.환경, values.환경)
    await app.noAlert()
  },
  async 'suggests a judgment value from confirmed documents, and saves it once accepted'(app, vault) {
    const before = new Set(await documentsIn(vault))
    await app.click('button', '문서')
    await app.choose('select#template', '서식/접수.fd.md')
    await app.type('[data-field-name="요청"]', '노트북 배터리가 금방 닳아요')
    await app.choose('select[name="부서"]', '영업')
    const note = await app.cdp.waitFor(
      `__e2e.all('[role=note][data-field="담당"]').map((el) => el.textContent.replace(/\\s+/g, ' ').trim())[0]`,
      'a suggestion for 담당',
      { timeoutMs: 15_000 },
    )
    assert.match(note, /담당 제안: 장비/)
    assert.match(note, /비슷한 기록: 접수-1/)
    assert.equal(await app.value('select[name="담당"]'), '', 'nothing is filled in before it is accepted')

    await app.click('dc-button', '수락')
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
    assert.deepEqual(
      { doc: accepted.doc, field: accepted.field, kind: accepted.kind, suggested: accepted.suggested, value: accepted.value },
      { doc: `문서/${created[0]}`, field: '담당', kind: 'accept', suggested: '장비', value: '장비' },
    )
    assert.equal(accepted.recall, '문서/접수-1.md')
  },

  async 'records a rejected suggestion when the document is saved without it'(app, vault) {
    await app.choose('select#template', '서식/접수.fd.md')
    // A new document from the same template starts empty: nothing carries over from the last one.
    await app.cdp.waitFor(
      `__e2e.one('select[name="부서"]')?.value === '' && __e2e.one('[data-field-name="요청"]')?.textContent === ''`,
      'an empty form',
    )
    await app.type('[data-field-name="요청"]', '급여 명세서를 다시 받고 싶어요')
    await app.choose('select[name="부서"]', '개발')
    await app.cdp.waitFor(`__e2e.all('[role=note][data-field="담당"]').length === 1`, 'a suggestion for 담당', { timeoutMs: 15_000 })
    await app.click('dc-button', '거절')
    await app.cdp.waitFor(`__e2e.all('[role=note]').length === 0`, 'the suggestion to be set aside')
    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    await app.noAlert()

    await app.cdp.evaluate(`new Promise((resolve) => setTimeout(resolve, 1000))`)
    assert.equal(await app.cdp.evaluate(`__e2e.all('[role=note]').length`), 0, 'a rejected suggestion does not come back after saving')
    const all = await events(vault)
    assert.equal(all.length, 2, 'one event per confirmation, not per save')
    assert.deepEqual([all[1].kind, all[1].suggested, all[1].value], ['reject', '인사', null])

    // Reopened, the document still has the rejection: the sidecar learned it from the event file.
    // Opening it again starts a fresh draft: nothing of the last one is kept in the window.
    await app.click('nav button', all[1].doc.split('/').pop().replace(/\.md$/, ''))
    await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent.includes('급여')`, 'the reopened document')
    await app.cdp.evaluate(`new Promise((resolve) => setTimeout(resolve, 2000))`)
    assert.equal(await app.cdp.evaluate(`__e2e.all('[role=note]').length`), 0, 'a rejected suggestion is not offered on reopening')
  },
  async 'rebuilds the same table and the same suggestion after a restart, with nothing kept but the vault'(app, vault) {
    const tableNow = async () => {
      await app.click('button', '표')
      await app.choose('select#template', 'intake@1')
      return app.cdp.waitFor(
        `(() => { const rows = __e2e.all('tbody tr'); const text = rows.map((tr) => tr.textContent.replace(/\\s+/g, ' ').trim()); return text.some((t) => t.includes('급여')) && text })()`,
        'the intake table',
        { timeoutMs: 30_000 },
      )
    }
    const suggestionNow = async () => {
      await app.click('button', '문서')
      await app.choose('select#template', '서식/접수.fd.md')
      await app.type('[data-field-name="요청"]', '노트북 배터리가 또 금방 닳아요')
      return app.cdp.waitFor(
        `__e2e.all('[role=note][data-field="담당"]').map((el) => el.textContent.replace(/\\s+/g, ' ').trim())[0]`,
        'a suggestion for 담당',
        { timeoutMs: 30_000 },
      )
    }

    const table = await tableNow()
    const suggestion = await suggestionNow()
    assert.equal(table.length, 4, 'two fixture records and the two made above')

    await app.restart(vault)
    assert.deepEqual(await tableNow(), table, 'the same table')
    assert.equal(await suggestionNow(), suggestion, 'the same suggestion')
    await app.noAlert()
  },
}

/** With E2E_SCREENSHOTS=<dir>, each passed scenario leaves a picture of the window. */
async function screenshot(cdp, dir, name) {
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(dir, { recursive: true })
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(dir, `${name.replace(/[^\p{L}\p{N}]+/gu, '-')}.png`), Buffer.from(data, 'base64'))
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
        if (process.env.E2E_SCREENSHOTS) await screenshot(app.cdp, process.env.E2E_SCREENSHOTS, `FAILED ${name}`)
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
