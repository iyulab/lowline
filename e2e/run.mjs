// End-to-end scenarios against the real app window: WebView2 driven over CDP, files checked on disk.
//
//   npm run build:e2e   builds the debug app with the e2e config (debugging port 9223)
//   npm run test:e2e    copies the fixture vault to a temp folder and runs every scenario
//                       (E2E_SCREENSHOTS=<dir> saves a picture of the window after each one;
//                       E2E_COLOR_SCHEME=dark runs it in the dark scheme;
//                       E2E_VAULT_UNC=1 opens the vault through this PC's administrative share,
//                       \\localhost\C$\..., so every file operation goes over SMB — Windows only;
//                       `-- --only <text>` runs the scenarios whose names hold the text, `-- --through
//                       <text>` those up to the first such, `-- --repeat <n>` n times, each on a fresh
//                       vault in a fresh window; a failure's picture is kept in the temp folder)
//
// The window itself — launching, clicking, typing, quitting — is app.mjs, for one-off scripts too.
//
// The one seam: the folder picker is a native dialog, so the vault is opened through the same
// `open_vault` command the picker's result goes to. Everything after that is clicks and typing.

import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { parseFormdown } from '@formdown/core'
import { runScenarios } from '@iyulab/tauri-kit-dev/app'
import { App, EXPORTS, IDENTIFIER, SETTINGS, exe, q, sidecarsRunning, updates } from './app.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const TEMPLATE = '서식/버그 리포트.fd.md'
/** The fixture vault's templates: their names, references and files. */
const BUG = { name: '버그 리포트', ref: 'bug-report@1', path: TEMPLATE }
const INTAKE = { name: '접수', ref: 'intake@1', path: '서식/접수.fd.md' }
/** The template's inline title field (`제목: ___@제목`). */
const TITLE = '[data-field-name="제목"]'

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

    await app.fill('input[aria-label="심각도 선택지"]', '낮음, 보통, 높음, 긴급')
    await enter()
    await app.cdp.waitFor(`__e2e.one('textarea')?.value.includes('options="낮음,보통,높음,긴급"')`, 'the options written into the field')
    assert.equal(
      await app.value('textarea'),
      before.replace('options="낮음,보통,높음"', 'options="낮음,보통,높음,긴급"'),
      'nothing else in the source changed',
    )
    await app.cdp.waitFor(`__e2e.all('select[name="심각도"] option').some((o) => o.value === '긴급')`, 'the new option in the preview')

    // A field keeps at least one option: clearing them writes nothing and shows the source's again.
    await app.fill('input[aria-label="환경 선택지"]', ' , ')
    await enter()
    await app.cdp.waitFor(`__e2e.one('input[aria-label="환경 선택지"]')?.value === '윈도우, 맥'`, 'the options as the source holds them')
    assert.ok((await app.value('textarea')).includes('@환경: [radio options="윈도우,맥"]'))

    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    assert.equal(await readFile(path, 'utf8'), await app.value('textarea'), 'file = editor text')

    // As it was, for the scenarios after this one.
    await app.fill('input[aria-label="심각도 선택지"]', '낮음, 보통, 높음')
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
    await app.fill('input[aria-label="새 이름"]', '접수')
    await enter()
    await app.cdp.waitFor(`__e2e.all('[role=alert]').some((el) => el.textContent.includes('같은 이름의 서식이 이미 있습니다'))`, 'the name refused')
    await app.fill('input[aria-label="새 이름"]', renamed.name)
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
    await app.fill('input[aria-label="새 이름"]', BUG.name)
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

    // A second one takes the name numbered before the template ending, so it is still a template.
    await app.newTemplate()
    await app.cdp.waitFor(`!!__e2e.one('button.item', '새 서식 (1)')`, 'the second starter in the sidebar')
    const both = (await readdir(join(vault, '서식'))).filter((n) => n.startsWith('새 서식')).sort()
    assert.deepEqual(both, ['새 서식 (1).fd.md', '새 서식.fd.md'])
    // Back to the fixture template for the scenarios that follow, without the second starter.
    await app.templateOf(BUG)
    await app.cdp.waitFor(`__e2e.one('textarea')?.value.includes('id: bug-report')`, 'the fixture template')
    await rm(join(vault, '서식', '새 서식 (1).fd.md'))
    await app.cdp.waitFor(`!__e2e.one('button.item', '새 서식 (1)')`, 'the second starter gone from the sidebar')
  },

  async 'creates a document, edits it, and saves again in place'(app, vault) {
    await app.newDocument(BUG)
    // Looking at an empty field is not an edit: focus in and out leaves nothing to save.
    await app.cdp.waitFor(`(() => { const t = __e2e.one(${q(TITLE)}); if (!t) return false; t.focus(); t.blur(); return true })()`, 'the empty title')
    await app.cdp.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
    assert.equal(await app.cdp.evaluate(`__e2e.one('dc-button', '저장').disabled`), true, 'a focus and blur alone leave Save off')
    await app.fill(TITLE, '저장 후 멈춤')
    await app.choose('select[name="심각도"]', '높음')
    await app.fill('textarea[name="재현_절차"]', '1. 문서를 연다\n2. 저장한다')
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

    await app.fill(TITLE, '저장 후 화면이 멈춤')
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

    // Saved straight after an outside edit the watch has not reported yet: the file is not overwritten unseen.
    // (It ends at 높음, as the scenarios after this one expect.)
    await app.choose('select[name="심각도"]', '보통')
    await severity('낮음')
    await app.click('dc-button', '저장')
    await app.cdp.waitFor(
      `__e2e.all('[role=alert]').some((el) => el.textContent.includes('밖에서 바뀌었습니다'))`,
      'the outside edit announced at saving',
    )
    assert.equal((await fileValues(path)).심각도, '낮음', 'the outside edit is still in the file')
    assert.equal(await app.value('select[name="심각도"]'), '보통', 'and the unsaved edit on screen')
    // Told, the person decides: saving again replaces it.
    await app.choose('select[name="심각도"]', '높음')
    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    assert.equal((await fileValues(path)).심각도, '높음')
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
    assert.equal(row.재현됨, values.재현됨 === undefined ? '' : values.재현됨 ? '✓' : '✗')
    assert.equal(row.환경, values.환경)

    // Exporting writes the table as CSV where the person picks; the debug shell saves it in EXPORTS.
    await rm(EXPORTS, { recursive: true, force: true })
    await mkdir(EXPORTS, { recursive: true })
    await app.click('dc-button', 'CSV로 내보내기')
    await app.status('버그 리포트.csv(으)로 내보냈습니다')
    const lines = (await readFile(join(EXPORTS, '버그 리포트.csv'), 'utf8')).split('\r\n')
    assert.equal(lines[0], '\uFEFF문서,제목,심각도,재현 절차,재현됨,환경,메모', 'labels as the table shows them, after the document')
    assert.equal(lines.filter(Boolean).length, 2, 'the heading and one line per document')
    assert.ok(lines[1].startsWith(`${name.replace(/\.md$/, '')},${values.제목},${values.심각도},`), lines[1])
    await rm(EXPORTS, { recursive: true, force: true })
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
    await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent === ''`, 'an empty form')
    await app.fill('[data-field-name="요청"]', '노트북 화면이 어두워요')
    await app.choose('select[name="부서"]', '영업')
    // The suggestion is drawn by the field it is for: its value to take, what it rests on, and a way to decline.
    const note = await app.cdp.waitFor(
      `__e2e.all('[data-formdown-note="담당"]').filter((el) => el.querySelector('.formdown-suggestion')).map((el) => el.textContent.replace(/\\s+/g, ' ').trim())[0]`,
      'a suggestion for 담당',
      { timeoutMs: 15_000 },
    )
    assert.match(note, /^제안 · 함께 확정된 값: 부서: 영업/)
    assert.equal(await app.cdp.evaluate(`__e2e.one('.formdown-suggestion')?.textContent`), '장비')
    assert.equal(await app.cdp.evaluate(`__e2e.one('.formdown-decline')?.textContent`), '거절')
    assert.equal(await app.value('select[name="담당"]'), '', 'nothing is filled in before it is accepted')
    await app.click('.formdown-suggestion', '장비')
    await app.cdp.waitFor(`__e2e.one('select[name="담당"]')?.value === '장비'`, 'the accepted value in the form')
    // Straight after the click: the offered value is gone, and Ctrl+S still saves.
    await app.cdp.press('s', { code: 'KeyS', modifiers: 2, keyCode: 83 })
    await app.status('저장했습니다')
    await app.noAlert()

    const created = (await documentsIn(vault)).filter((n) => !before.has(n))
    assert.equal(created.length, 1)
    const values = await fileValues(join(vault, '문서', created[0]))
    assert.equal(values.담당, '장비')
    assert.equal(values.요청, '노트북 화면이 어두워요')

    const [accepted] = await events(vault)
    // The event names the document by its id, not by where its file is.
    assert.deepEqual(
      { doc: accepted.doc, field: accepted.field, kind: accepted.kind, suggested: accepted.suggested, value: accepted.value },
      { doc: values.lowline.id, field: '담당', kind: 'accept', suggested: '장비', value: '장비' },
    )
    // What it rested on: the value it was settled alongside.
    assert.equal(accepted.recall, '부서: 영업')
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
    await app.fill('[data-field-name="요청"]', '급여 명세서를 다시 받고 싶어요')
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
  async 'shows nothing when the values filled in settle nothing, not even a similar record'(app, vault) {
    await app.newDocument(INTAKE)
    await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent === ''`, 'an empty form')
    // Nearly a confirmed request word for word, with no 부서: a similar record is not offered as a suggestion.
    await app.fill('[data-field-name="요청"]', '모니터가 깜빡여요!')
    // Suggestions are asked for once typing pauses; this waits well past that and the answer.
    await app.cdp.evaluate(`new Promise((resolve) => setTimeout(resolve, 2500))`)
    assert.equal(await app.cdp.evaluate(`__e2e.all('.formdown-suggestion').length`), 0, 'no suggestion is made up')
    assert.equal(await app.value('select[name="담당"]'), '', 'nothing is filled in')
    // Why the field is empty is said, with how much it has to learn from.
    const why = await app.cdp.evaluate(`__e2e.all('[data-formdown-note="담당"]').map((el) => el.textContent.trim())[0]`)
    assert.equal(why, '지금 입력한 값들로는 함께 확정된 값이 정해지지 않아 비워 둡니다.')

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
      await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent === ''`, 'an empty form')
      await app.fill('[data-field-name="요청"]', '노트북 배터리가 또 금방 닳아요')
      await app.choose('select[name="부서"]', '영업')
      return app.cdp.waitFor(
        `__e2e.all('.formdown-suggestion').map((el) => el.closest('[data-formdown-note]').textContent.replace(/\\s+/g, ' ').trim())[0]`,
        'a suggestion for 담당',
        { timeoutMs: 30_000 },
      )
    }

    const table = await tableNow()
    const suggestion = await suggestionNow()
    assert.equal(table.length, 18, 'fifteen fixture records and the three made above')

    await app.reopen(vault)
    assert.deepEqual(await tableNow(), table, 'the same table from the cache')
    assert.equal(await suggestionNow(), suggestion, 'the same suggestion')

    await app.reopen(vault, { dropCaches: true })
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
      ['번호', '접수일', '요청', '부서', '담당', '비고'],
      ['A-1', '2026-01-15', '프린터 토너가 떨어졌어요', '영업', '총무', '지난달'],
      // A cell with a line break comes quoted, the way spreadsheets copy it.
      ['A-2', '2026. 1. 16.', '"회의실 프로젝터가\n안 켜져요"', '개발', '경비', ''],
      ['', '', '', '', '', '비고만 있는 행'],
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
    // Columns that fill no field: the day each record was made, its code, and one left out.
    assert.deepEqual(
      await app.cdp.evaluate(`__e2e.all('td select').map((s) => s.value)`),
      ['name', 'date', ''],
      'a column of codes names the records, a column of days dates them, the rest is not imported',
    )
    await app.click('dc-button', '2건 가져오기')
    await app.status('2건을 가져왔습니다')
    await app.noAlert()

    const created = (await documentsIn(vault)).filter((n) => !before.has(n))
    assert.equal(created.length, 2, 'one document per row that fills a field')
    assert.deepEqual(
      created.map((n) => n.slice(0, 15)).sort(),
      ['2026-01-15-A-1 ', '2026-01-16-A-2 '],
      'named by the day each record was made and its code',
    )
    const values = await Promise.all(created.map((n) => fileValues(join(vault, '문서', n))))
    const toner = values.find((v) => v.요청 === '프린터 토너가 떨어졌어요')
    assert.deepEqual([toner?.template, toner?.부서, toner?.담당], ['intake@1', '영업', '총무'])
    assert.equal(values.find((v) => v.요청 === '회의실 프로젝터가\n안 켜져요')?.담당, '경비', 'kept as written, line break and all')

    // Imported records are confirmed values: the same request again gets the imported answer suggested.
    await app.newDocument(INTAKE)
    await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent === ''`, 'an empty form')
    await app.fill('[data-field-name="요청"]', '프린터 토너가 떨어졌어요')
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
    // Each source of suggestions read apart, as the event files record it.
    for (const source of new Set(decided.map((e) => e.source))) {
      const of = decided.filter((e) => e.source === source)
      const name = source === 'key' ? '함께 확정된 값' : '비슷한 기록'
      const line = `${name}에서 낸 제안 ${of.length}건 중 ${of.filter((e) => e.kind === 'accept').length}건 수락`
      assert.ok(figures.includes(line), `${line} in ${figures}`)
    }
    assert.ok(decided.every((e) => e.template === 'intake@1'), 'events name their template')

    // Weekly counts to hand over by hand: numbers only, the form's name shown beside them but not in them.
    const counts = JSON.parse(
      await app.cdp.waitFor(`__e2e.all('details.counts pre')[0]?.textContent`, 'the weekly counts', { timeoutMs: 30_000 }),
    )
    assert.equal(counts.format, 'lowline-weekly-counts/1')
    const intake = counts.counts.filter((c) => c.form === 1 && c.field === 1)
    assert.equal(
      intake.reduce((n, c) => n + Object.values(c.bySource).reduce((m, s) => m + s.decided, 0), 0),
      decided.length,
      'every decision counted under its source',
    )
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

  async 'filters a table by name, by a choice field, and by text in a field'(app, vault) {
    const intake = []
    for (const name of (await readdir(join(vault, '문서'))).filter((n) => n.endsWith('.md'))) {
      const values = await fileValues(join(vault, '문서', name))
      if (values.template === 'intake@1') intake.push({ name: name.replace(/\.md$/, ''), ...values })
    }
    const shows = (n, what) =>
      app.cdp.waitFor(
        `__e2e.all('[role=status]').some((el) => el.textContent.trim() === ${q(what)}) && (${n} === 0 || __e2e.all('tbody tr').length === ${n})`,
        what,
        { timeoutMs: 15_000 },
      )
    const pick = (label, value) =>
      app.cdp.evaluate(`(() => { const s = __e2e.all('dc-select').find((el) => el.getAttribute('aria-label') === ${q(label)})
        const inner = s.shadowRoot.querySelector('select'); inner.value = ${q(value)}; inner.dispatchEvent(new Event('change')); return true })()`)
    const typeIn = (label, text) =>
      app.cdp.evaluate(`(() => { const i = __e2e.all('dc-input').find((el) => el.getAttribute('aria-label') === ${q(label)})
        const inner = i.shadowRoot.querySelector('input'); inner.value = ${q(text)}
        inner.dispatchEvent(new Event('input', { bubbles: true, composed: true })); return true })()`)

    await app.showTable(INTAKE)
    await shows(intake.length, `문서 ${intake.length}건`)

    // A choice field's value: the rows whose 부서 is 영업.
    const sales = intake.filter((d) => d.부서 === '영업')
    assert.ok(sales.length > 1, 'more than one document of 영업 to filter')
    await pick('부서', '영업')
    await shows(sales.length, `조건에 맞는 문서 ${sales.length}건`)
    const column = await app.cdp.evaluate(`__e2e.all('thead th').map((th) => th.textContent).indexOf('부서')`)
    const shown = await app.cdp.evaluate(`__e2e.all('tbody tr').map((tr) => tr.children[${column}].textContent.trim())`)
    assert.deepEqual([...new Set(shown)], ['영업'])

    // And a name: every filter holds.
    const named = sales.filter((d) => d.name.includes('A-1'))
    assert.equal(named.length, 1)
    await typeIn('이름에 든 글자', 'A-1')
    await shows(1, '조건에 맞는 문서 1건')

    // Text within a field, alone.
    await pick('부서', '')
    await typeIn('이름에 든 글자', '')
    await pick('글자를 찾을 칸', '요청')
    await typeIn('칸에 든 글자', '토너')
    const toner = intake.filter((d) => String(d.요청 ?? '').includes('토너'))
    assert.ok(toner.length > 0)
    await shows(toner.length, `조건에 맞는 문서 ${toner.length}건`)

    // Nothing matching says so; cleared, every document is back.
    await typeIn('칸에 든 글자', '어디에도 없는 말')
    await shows(0, '조건에 맞는 문서 0건')
    assert.ok(await app.cdp.evaluate(`__e2e.all('dc-data-table').some((t) => t.shadowRoot.textContent.includes('조건에 맞는 문서가 없습니다'))`))
    await typeIn('칸에 든 글자', '')
    await shows(intake.length, `문서 ${intake.length}건`)

    // The document list narrows by name as it is typed.
    await app.documentsOf(INTAKE)
    await app.cdp.waitFor(
      `__e2e.all('ll-documents').flatMap((d) => [...d.shadowRoot.querySelectorAll('nav button')]).length === ${intake.length}`,
      'the whole list',
    )
    const all = await app.documentLabels()
    // Names are looked in at once; values after the sidecar answers — no value here holds "a-1".
    const searched = `!__e2e.all('ll-documents').some((d) => [...d.shadowRoot.querySelectorAll('p.message')].some((p) => p.textContent.includes('칸 값에서 찾는 중')))`
    await typeIn('이름이나 칸 값으로 찾기', 'a-1')
    await app.cdp.waitFor(`(${JSON.stringify(all.filter((l) => l.toLowerCase().includes('a-1')))}).join('|') === __e2e.all('ll-documents').flatMap((d) => [...d.shadowRoot.querySelectorAll('nav button')]).map((b) => b.textContent.replace(/\\s+/g, ' ').trim()).join('|') && ${searched}`, 'the list narrowed to A-1, ignoring case', { timeoutMs: 15_000 })
    await typeIn('이름이나 칸 값으로 찾기', '어디에도 없는 이름')
    await app.cdp.waitFor(`__e2e.all('p.message').some((p) => p.textContent.includes('이름이나 칸 값이 맞는 문서가 없습니다'))`, 'nothing matching said', { timeoutMs: 15_000 })
    await typeIn('이름이나 칸 값으로 찾기', '')
    assert.deepEqual(await app.documentLabels(), all)
    await app.noAlert()
  },

  async 'finds documents by the words of their values, and opens one of the cases most like a document'(app, vault) {
    const CASES = { name: '사례', ref: 'cases@1', path: '서식/사례.fd.md' }
    const body = '# 사례\n\n요청: ___@요청\n\n@담당: [select options="장비,인사"]\n'
    const files = [join(vault, CASES.path)]
    await writeFile(files[0], `---\nid: cases\nversion: 1\nlowline:\n  suggest: [담당]\n---\n${body}`)
    const cases = [
      ['프린터', '프린터 토너가 떨어졌어요', '장비'],
      ['복합기', '복합기 토너 교체 요청', '장비'],
      ['연차', '연차를 이월하고 싶어요', '인사'],
    ]
    for (const [name, request, owner] of cases) {
      const file = join(vault, '문서', `${name}.md`)
      files.push(file)
      await writeFile(file, `---\ntemplate: cases@1\n요청: ${request}\n담당: ${owner}\n---\n${body}`)
    }
    const typeIn = (text) =>
      app.cdp.evaluate(`(() => { const i = __e2e.all('dc-input').find((el) => el.getAttribute('aria-label') === '이름이나 칸 값으로 찾기')
        const inner = i.shadowRoot.querySelector('input'); inner.value = ${q(text)}
        inner.dispatchEvent(new Event('input', { bubbles: true, composed: true })); return true })()`)
    const listed = `__e2e.all('ll-documents').flatMap((d) => [...d.shadowRoot.querySelectorAll('nav button')]).map((b) => b.textContent.replace(/\\s+/g, ' ').trim())`
    try {
      await app.tabOf(CASES, '문서', { timeoutMs: 30_000 })
      await app.cdp.waitFor(`(${listed}).length === 3`, 'the three documents', { timeoutMs: 30_000 })

      // No name holds "토너"; two documents' values do, and each shows the line that matched.
      await typeIn('토너')
      const found = await app.cdp.waitFor(`(() => { const l = ${listed}; return l.length === 2 && l })()`, 'the documents holding 토너', { timeoutMs: 30_000 })
      assert.deepEqual([...found].sort(), ['복합기 복합기 토너 교체 요청', '프린터 프린터 토너가 떨어졌어요'])
      // A stem finds a word with its ending: "이월" in "이월하고".
      await typeIn('이월')
      await app.cdp.waitFor(`(${listed}).join('|') === '연차 연차를 이월하고 싶어요'`, 'the document holding 이월', { timeoutMs: 15_000 })
      await typeIn('')
      await app.cdp.waitFor(`(${listed}).length === 3`, 'the whole list again')

      // The cases most like a document: asked for by opening them, the same template's, itself left out.
      await app.pickDocument('프린터')
      await app.cdp.waitFor(`__e2e.one('select[name="담당"]')?.value === '장비'`, 'the document open')
      await app.click('summary', '비슷한 사례')
      const similar = await app.cdp.waitFor(
        `(() => { const b = __e2e.all('.similar button').map((b) => b.textContent.replace(/\\s+/g, ' ').trim()); return b.length ? b : null })()`,
        'the similar cases',
        { timeoutMs: 30_000 },
      )
      // Each with what it confirmed in the judgment field: evidence to read, not a suggestion.
      assert.equal(similar[0], '복합기 복합기 토너 교체 요청 확정: 담당 장비')
      assert.ok(!similar.some((s) => s.startsWith('프린터')), 'itself left out')
      await app.click('.similar button', similar[0])
      await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent === '복합기 토너 교체 요청'`, 'the similar case open')
      await app.noAlert()
    } finally {
      // Leave the vault as the scenarios after this one expect it.
      await app.learning()
      await Promise.all(files.map((f) => rm(f, { force: true })))
    }
    await app.cdp.waitFor(`!__e2e.one('button.item:not(.group-toggle)', '사례')`, 'the template gone from the sidebar', { timeoutMs: 30_000 })
  },

  async "filters a table by a number field's bounds"(app, vault) {
    const SCORES = { name: '점수표', ref: 'scores@1', path: '서식/점수표.fd.md' }
    const body = '# 점수표\n\n제목: ___@제목\n\n@점수: [number]\n'
    const files = [join(vault, SCORES.path)]
    await writeFile(files[0], `---\nid: scores\nversion: 1\n---\n${body}`)
    for (const [i, score] of ['1', '2.5', '3', ''].entries()) {
      const file = join(vault, '문서', `점수-${i + 1}.md`)
      files.push(file)
      await writeFile(file, `---\ntemplate: scores@1\n제목: 기록 ${i + 1}\n${score ? `점수: ${score}\n` : ''}---\n${body}`)
    }
    const shows = (n, what) =>
      app.cdp.waitFor(
        `__e2e.all('[role=status]').some((el) => el.textContent.trim() === ${q(what)}) && __e2e.all('tbody tr').length === ${n}`,
        what,
        { timeoutMs: 15_000 },
      )
    const typeIn = (label, text) =>
      app.cdp.evaluate(`(() => { const i = __e2e.all('dc-input').find((el) => el.getAttribute('aria-label') === ${q(label)})
        const inner = i.shadowRoot.querySelector('input'); inner.value = ${q(text)}
        inner.dispatchEvent(new Event('input', { bubbles: true, composed: true })); return true })()`)
    try {
      await app.showTable(SCORES, { timeoutMs: 30_000 })
      await shows(4, '문서 4건')
      await typeIn('점수 이상', '2')
      await shows(2, '조건에 맞는 문서 2건')
      // Both bounds hold, and each is included.
      await typeIn('점수 이하', '2.5')
      await shows(1, '조건에 맞는 문서 1건')
      assert.ok(await app.cdp.evaluate(`__e2e.all('tbody tr')[0].textContent.includes('기록 2')`))
      await typeIn('점수 이상', '')
      await typeIn('점수 이하', '')
      await shows(4, '문서 4건')
      await app.noAlert()
    } finally {
      await app.learning()
      await Promise.all(files.map((f) => rm(f, { force: true })))
    }
    await app.cdp.waitFor(`!__e2e.one('button.item:not(.group-toggle)', '점수표')`, 'the template gone from the sidebar', { timeoutMs: 30_000 })
  },

  async "fills a field that refers to another template's documents by their names, keeping their ids"(app, vault) {
    const CUSTOMER = { name: '고객', ref: 'customer@1', path: '서식/고객.fd.md' }
    const INQUIRY = { name: '문의', ref: 'inquiry@1', path: '서식/문의.fd.md' }
    const customerBody = '# 고객\n\n상호: ___@상호\n'
    const inquiryBody = '# 문의\n\n@고객 -> customer: [select]\n\n내용: ___@내용\n'
    const files = [
      [CUSTOMER.path, `---\nid: customer\nversion: 1\n---\n${customerBody}`],
      [INQUIRY.path, `---\nid: inquiry\nversion: 1\n---\n${inquiryBody}`],
      ['문서/한빛상사.md', `---\ntemplate: customer@1\nlowline:\n  id: c-hanbit\n상호: 한빛상사\n---\n${customerBody}`],
      ['문서/가나상회.md', `---\ntemplate: customer@1\nlowline:\n  id: c-gana\n상호: 가나상회\n---\n${customerBody}`],
      ['문서/옛 문의.md', `---\ntemplate: inquiry@1\n고객: 3f2a1b2c-0000-4000-8000-000000000000\n내용: 옛 기록\n---\n${inquiryBody}`],
    ].map(([path, text]) => [join(vault, path), text])
    for (const [file, text] of files) await writeFile(file, text)
    const offered = () =>
      app.cdp.evaluate(`[...__e2e.one('select[name="고객"]').options].map((o) => o.value + '=' + o.textContent.trim())`)
    try {
      await app.tabOf(INQUIRY, '문서', { timeoutMs: 30_000 })
      // The template inquiries refer to leads the sidebar, in a group of its own.
      await app.cdp.waitFor(
        `__e2e.all('#group-references[aria-label="기준"] .label').map((l) => l.textContent.trim()).join('|') === '고객'`,
        'the group of templates referred to',
        { timeoutMs: 15_000 },
      )
      await app.click('dc-button', '새 문서')
      await app.cdp.waitFor(`__e2e.one('select[name="고객"]')?.options.length === 2`, 'the customers offered', { timeoutMs: 15_000 })
      // By name, valued by id; nothing picked until the person picks.
      assert.deepEqual(await offered(), ['c-gana=가나상회', 'c-hanbit=한빛상사'])
      assert.equal(await app.cdp.evaluate(`__e2e.one('select[name="고객"]').selectedIndex`), -1)
      const before = new Set(await readdir(join(vault, '문서')))
      await app.choose('select[name="고객"]', 'c-hanbit')
      await app.fill('[data-field-name="내용"]', '견적 요청')
      await app.click('dc-button', '저장')
      await app.status('저장했습니다')
      const saved = (await readdir(join(vault, '문서'))).find((f) => !before.has(f))
      assert.ok(saved, 'the new inquiry saved')
      files.push([join(vault, '문서', saved)])
      assert.equal((await fileValues(join(vault, '문서', saved))).고객, 'c-hanbit', 'the file keeps the id')

      // A value naming a document the vault does not have is kept, and said to be missing.
      await app.pickDocument('옛 문의')
      await app.cdp.waitFor(
        `[...(__e2e.one('select[name="고객"]')?.options ?? [])].some((o) => o.selected && o.textContent.trim() === '없는 고객 (3f2a1b2c)')`,
        'the missing customer shown',
        { timeoutMs: 15_000 },
      )

      // The table names the customer, and filters by the customer picked by name.
      await app.showTable(INQUIRY)
      const cells = () => app.cdp.evaluate(`__e2e.all('tbody tr').map((r) => r.textContent.replace(/\\s+/g, ' ').trim())`)
      await app.cdp.waitFor(`__e2e.all('tbody tr').length === 2`, 'both inquiries in the table', { timeoutMs: 15_000 })
      const rows = await cells()
      assert.ok(rows.some((r) => r.includes('한빛상사')), `named in the table: ${rows}`)
      assert.ok(rows.some((r) => r.includes('없는 고객 (3f2a1b2c)')), `missing said in the table: ${rows}`)
      assert.ok(!rows.some((r) => r.includes('c-hanbit')), 'the id is not what is shown')
      await app.cdp.evaluate(`(() => { const s = __e2e.all('dc-select').find((el) => el.getAttribute('aria-label') === '고객')
        const inner = s.shadowRoot.querySelector('select'); inner.value = 'c-hanbit'; inner.dispatchEvent(new Event('change')); return true })()`)
      await app.cdp.waitFor(
        `__e2e.all('[role=status]').some((el) => el.textContent.trim() === '조건에 맞는 문서 1건') && __e2e.all('tbody tr').length === 1`,
        'the inquiries of 한빛상사',
        { timeoutMs: 15_000 },
      )

      // A customer lists the inquiries naming it, and one opens in its own place.
      const inquiryName = saved.replace(/\.md$/, '')
      await app.openDocument(CUSTOMER, '한빛상사')
      await app.cdp.waitFor(
        `__e2e.all('div.referring button').some((b) => b.textContent.trim() === ${q(inquiryName)})`,
        'the inquiry naming 한빛상사',
        { timeoutMs: 15_000 },
      )
      assert.ok(await app.cdp.evaluate(`__e2e.all('div.referring h4').some((h) => h.textContent.trim() === '문의 1건')`))
      await app.click('div.referring button', inquiryName)
      await app.cdp.waitFor(
        `__e2e.one('nav button[aria-current="true"]')?.textContent.trim() === ${q(inquiryName)} && __e2e.one('select[name="고객"]')?.value === 'c-hanbit'`,
        'the inquiry open in its own place',
        { timeoutMs: 15_000 },
      )
      assert.equal((await app.where()).place, '문의')
      await app.openDocument(CUSTOMER, '가나상회')
      await app.cdp.waitFor(`__e2e.all('div.referring p').some((p) => p.textContent.trim() === '아직 이 문서를 가리키는 문서가 없습니다.')`, 'nothing naming 가나상회')
      await app.noAlert()
    } finally {
      await app.learning()
      await Promise.all(files.map(([f]) => rm(f, { force: true })))
    }
    await app.cdp.waitFor(`!__e2e.one('button.item:not(.group-toggle)', '문의')`, 'the templates gone from the sidebar', { timeoutMs: 30_000 })
  },

  async 'filters a table by a date range and names the dates it could not read'(app, vault) {
    const VISITS = { name: '방문 기록', ref: 'visits@1', path: '서식/방문 기록.fd.md' }
    const body = '# 방문 기록\n\n제목: ___@제목\n\n@방문일: [date]\n'
    const files = [join(vault, VISITS.path)]
    await writeFile(files[0], `---\nid: visits\nversion: 1\n---\n${body}`)
    for (const [i, day] of ['2026-01-15', '2026-01-31', '2026-02-01', '다음 주쯤'].entries()) {
      const file = join(vault, '문서', `방문-${i + 1}.md`)
      files.push(file)
      await writeFile(file, `---\ntemplate: visits@1\n제목: 방문 ${i + 1}\n방문일: ${day}\n---\n${body}`)
    }
    const shows = (n, what) =>
      app.cdp.waitFor(
        `__e2e.all('[role=status]').some((el) => el.textContent.trim() === ${q(what)}) && __e2e.all('tbody tr').length === ${n}`,
        what,
        { timeoutMs: 15_000 },
      )
    const typeIn = (label, text) =>
      app.cdp.evaluate(`(() => { const i = __e2e.all('dc-input').find((el) => el.getAttribute('aria-label') === ${q(label)})
        const inner = i.shadowRoot.querySelector('input'); inner.value = ${q(text)}
        inner.dispatchEvent(new Event('input', { bubbles: true, composed: true })); return true })()`)
    try {
      await app.showTable(VISITS, { timeoutMs: 30_000 })
      // The unreadable date keeps its row; only its cell is empty, and the table says which.
      await shows(4, '문서 4건')
      assert.ok(await app.cdp.evaluate(`__e2e.all('tbody tr')[0].textContent.includes('2026-01-15')`), 'a date shows as written')
      await app.cdp.waitFor(
        `__e2e.all('.skipped summary').some((s) => s.textContent.trim() === '값을 읽지 못해 비운 칸 1개')`,
        'the unreadable date named',
      )
      await typeIn('방문일 부터', '2026-01-16')
      await shows(2, '조건에 맞는 문서 2건')
      // Both ends hold, and each is included.
      await typeIn('방문일 까지', '2026-01-31')
      await shows(1, '조건에 맞는 문서 1건')
      assert.ok(await app.cdp.evaluate(`__e2e.all('tbody tr')[0].textContent.includes('방문 2')`))
      await typeIn('방문일 부터', '')
      await typeIn('방문일 까지', '')
      await shows(4, '문서 4건')
      // In its document the date field cannot hold it either: the value shows beside the field, and a save keeps it.
      await app.openDocument(VISITS, '방문-4')
      await app.cdp.waitFor(`__e2e.all('.formdown-unread').some((el) => el.textContent === '다음 주쯤')`, 'the unreadable date beside its field')
      await app.fill('[data-field-name="제목"]', '방문 4 다시')
      await app.click('dc-button', '저장')
      await app.status('저장했습니다')
      const saved = await readFile(files[4], 'utf8')
      assert.match(saved, /방문일: 다음 주쯤/, 'the unreadable date kept by the save')
      assert.match(saved, /방문 4 다시/)
      await app.noAlert()
    } finally {
      await app.learning()
      await Promise.all(files.map((f) => rm(f, { force: true })))
    }
    await app.cdp.waitFor(`!__e2e.one('button.item:not(.group-toggle)', '방문 기록')`, 'the template gone from the sidebar', { timeoutMs: 30_000 })
  },

  async 'says why a field is not suggested for when replaying its history never reaches the target'(app, vault) {
    // One 부서 whose owners alternate: the value last settled alongside it is never the next record's.
    const ASSIGN = { name: '배정', ref: 'assign@1', path: '서식/배정.fd.md' }
    const body = '# 배정\n\n요청: ___@요청\n\n@부서: [select options="영업,개발"]\n\n@담당: [select options="장비,인사"]\n'
    const template = join(vault, ASSIGN.path)
    await writeFile(template, `---\nid: assign\nversion: 1\nlowline:\n  suggest: [담당]\n---\n${body}`)
    const files = Array.from({ length: 15 }, (_, i) => join(vault, '문서', `배정-${i + 1}.md`))
    for (const [i, file] of files.entries()) {
      await writeFile(file, `---\ntemplate: assign@1\n요청: 노트북 배터리 문제 ${i + 1}\n부서: 영업\n담당: ${i % 2 ? '장비' : '인사'}\n---\n${body}`)
    }

    // The replay runs apart from reading the vault; the learning view says what it found once it is read again.
    const replay = `(() => { const h = __e2e.all('h2').find((el) => el.textContent.trim() === '배정 · 담당'); return h?.parentElement.querySelector('.replay')?.textContent.replace(/\\s+/g, ' ').trim() })()`
    let said = ''
    for (const until = Date.now() + 30_000; Date.now() < until && !said.includes('목표'); ) {
      await app.sidebar(ASSIGN.name, { timeoutMs: 30_000 })
      await app.learning()
      said = (await app.cdp.waitFor(replay, 'the replay line of 배정 · 담당', { timeoutMs: 30_000 })) ?? ''
    }
    // How far short it came: alternating owners, the value settled alongside 영업 is wrong each time.
    assert.match(said, /^저장된 기록을 순서대로 다시 물으면 가장 정확한 기준에서도 \d+건 중 \d+%만 맞혀 목표 80%에 못 미칩니다/)

    // A new record like all of them gets no suggestion, and the reason says it is the field, not the record.
    await app.newDocument(ASSIGN)
    await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent === ''`, 'an empty form')
    await app.fill('[data-field-name="요청"]', '노트북 배터리 문제 16')
    const why = await app.cdp.waitFor(
      `__e2e.all('[data-formdown-note="담당"]').map((el) => el.textContent.trim()).find((t) => t.includes('목표만큼'))`,
      'why 담당 has no suggestion',
      { timeoutMs: 30_000 },
    )
    assert.equal(why, '확정한 15건으로는 함께 확정된 값이 목표만큼 맞는다는 것을 아직 보이지 못해 제안하지 않습니다.')
    assert.equal(await app.cdp.evaluate(`__e2e.all('.formdown-suggestion').length`), 0, 'nothing offered')
    await app.noAlert()

    // Leave the vault as the scenarios after this one expect it.
    await app.learning()
    await app.answerUnsaved('편집 버리기')
    await Promise.all([template, ...files].map((f) => rm(f)))
    await app.cdp.waitFor(`!__e2e.one('button.item:not(.group-toggle)', '배정')`, 'the template gone from the sidebar', { timeoutMs: 30_000 })
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

      // 접수-1's own request, whose value only 접수-1 settled, is now answered only from other records.
      await app.newDocument(INTAKE)
      await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent === ''`, 'an empty form')
      await app.fill('[data-field-name="요청"]', '노트북 배터리가 금방 닳아요')
      await app.choose('select[name="부서"]', '영업')
      const note = await app.cdp.waitFor(
        `__e2e.all('.formdown-suggestion').map((el) => el.closest('[data-formdown-note]').textContent.replace(/\\s+/g, ' ').trim())[0]`,
        'a suggestion for 담당',
        { timeoutMs: 15_000 },
      )
      assert.doesNotMatch(note, /요청:/, 'the unsettled original settles nothing')
      assert.doesNotMatch(note, /총무/, 'nor does its copy')

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
    const trashedFrom = (folder) => trashed(join(vault, folder))
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
      await deleteForGoodOverSmb(app, '원본 영구히 지우기')
      await app.status(SMB ? '사본을 남겼습니다. 원본은 지웠습니다.' : '사본을 남겼습니다. 원본은 휴지통에 있습니다.')
      await app.noAlert()
      assert.ok(!existsSync(join(vault, copyDocPath)), 'the copy took the original’s name')
      assert.match(await readFile(originalDoc, 'utf8'), /담당: 총무/, 'the original’s name holds what the copy held')
      const trashed = await trashedFrom('문서')
      if (trashed) assert.deepEqual(trashed, ['접수-1.md'], 'the original in the Recycle Bin')
      await app.cdp.waitFor(
        `__e2e.one('nav button[aria-current="true"]')?.textContent.trim() === '접수-1' && __e2e.all('p.conflict').length === 0`,
        'the original’s name open, settled',
      )

      // Settled, it is learned from again — with the value that was kept.
      await app.newDocument(INTAKE)
      await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent === ''`, 'an empty form')
      await app.fill('[data-field-name="요청"]', '노트북 배터리가 금방 닳아요')
      await app.cdp.waitFor(
        `__e2e.all('.formdown-suggestion').some((el) => { const n = el.closest('[data-formdown-note]').textContent; return n.includes('요청: 노트북 배터리가 금방 닳아요') && n.includes('총무') })`,
        '총무 suggested alongside 접수-1\'s request',
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
      await deleteForGoodOverSmb(app, '영구히 지우기')
      await app.status(SMB ? '사본을 지우고 원본을 남겼습니다.' : '사본을 휴지통으로 옮기고 원본을 남겼습니다.')
      assert.ok(!existsSync(join(vault, copyTemplatePath)), 'the copy gone')
      assert.equal(await app.value('textarea'), templateBefore, 'the original shown again')
      const trashedCopy = await trashedFrom('서식')
      if (trashedCopy) assert.deepEqual(trashedCopy, ['접수.fd.sync-conflict-20260930-101500-ABCDEFG.md'])

      // Keeping the copy: the template the app knows under the original's name holds what the copy held.
      await showCopy()
      await app.click('dc-button', '이 사본을 남기기')
      await asked('이 사본을 남길까요?')
      await app.click('dc-button', '사본 남기기')
      await deleteForGoodOverSmb(app, '원본 영구히 지우기')
      await app.status(SMB ? '사본을 남겼습니다. 원본은 지웠습니다.' : '사본을 남겼습니다. 원본은 휴지통에 있습니다.')
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
    await app.fill('input[aria-label="새 이름"]', '접수-1')
    await enter()
    await refused('같은 이름의 문서가 이미 있습니다')
    await app.fill('input[aria-label="새 이름"]', '프린터/토너')
    await enter()
    await refused('파일 이름에 쓸 수 없는 글자')
    assert.equal(await readFile(original, 'utf8'), before)

    await app.fill('input[aria-label="새 이름"]', '프린터 토너 문의')
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
    const trashedFrom = (folder) => trashed(join(vault, folder))
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
    await app.fill('[data-field-name="요청"]', '고치던 중')
    await app.click('dc-button', '지우기')
    await asked('이 문서를 지울까요?')
    await app.cdp.waitFor(
      `__e2e.all('dc-confirm-dialog').some((d) => d.open && d.textContent.includes('저장하지 않은 편집은 함께 사라집니다'))`,
      'the unsaved edits named',
    )
    await app.click('dc-button', '휴지통으로 옮기기')
    await deleteForGoodOverSmb(app, '영구히 지우기')
    await app.status(SMB ? '지웠습니다' : '휴지통으로 옮겼습니다')
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
      await deleteForGoodOverSmb(app, '영구히 지우기')
      await app.cdp.waitFor(
        `__e2e.all('[role=status]').some((el) => el.textContent.includes(${q(SMB ? '서식을 지웠습니다' : '서식을 휴지통으로 옮겼습니다')}) && el.textContent.includes('서식 없는 문서'))`,
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

  async 'keeps values the form cannot show as written, when another field is edited and saved'(app, vault) {
    // Written outside the app: an owner the choice field does not offer, and a long request over several lines.
    const request = `첫 줄\n${'길게 이어지는 내용 '.repeat(200).trim()}\n마지막 줄`
    const file = join(vault, '문서', '경계 값.md')
    const body = '# 접수\n\n요청: ___@요청\n\n@부서: [select options="영업,개발,인사"]\n\n@담당: [select options="장비,인사,총무"]\n'
    await writeFile(file, `---\ntemplate: intake@1\n요청: ${JSON.stringify(request)}\n부서: 영업\n담당: 외부 업체\n---\n${body}`)
    await app.documentsOf(INTAKE)
    await app.cdp.waitFor(`__e2e.all('nav button').some((b) => b.textContent.includes('경계 값'))`, 'the document in the list', { timeoutMs: 30_000 })
    await app.pickDocument('경계 값')
    await app.cdp.waitFor(`__e2e.one('select[name="부서"]')?.value === '영업'`, 'the document open')
    assert.equal(await app.value('select[name="담당"]'), '외부 업체', 'a value the field does not offer is shown, not a blank or its first option')

    await app.choose('select[name="부서"]', '개발')
    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    await app.noAlert()
    const saved = await fileValues(file)
    assert.equal(saved.부서, '개발')
    assert.equal(saved.담당, '외부 업체', 'the value the field does not offer is kept')
    assert.equal(saved.요청, request, 'the long request keeps every line')

    // Leave the vault as the scenarios after this one expect it.
    await app.learning()
    await rm(file)
  },

  async 'says what is wrong in a template source, and does not save one whose front matter cannot be read'(app, vault) {
    const EDGE = { name: '경계 서식', ref: 'edge@1', path: '서식/경계 서식.fd.md' }
    const file = join(vault, EDGE.path)
    const source = '---\nid: edge\nversion: 1\nlowline:\n  suggest: [담당, 분류]\n---\n# 경계\n\n@담당: [select options="장비,인사"]\n\n@담당: [text]\n\n@메모: [text visible-if="분류=급함"]\n\n@고객 -> customer: [select]\n\n@태그 <-> tag: [checkbox]\n'
    const reports = join(process.env.LOCALAPPDATA ?? tmpdir(), IDENTIFIER, 'logs', 'reports.jsonl')
    const hostReports = async () => (existsSync(reports) ? (await readFile(reports, 'utf8')).split('\n').filter((l) => l.includes('"layer":"host"')).length : 0)
    const hostBefore = await hostReports()
    await writeFile(file, source)
    await app.tabOf(EDGE, '서식', { timeoutMs: 30_000 })
    const problems = await app.cdp.waitFor(
      `(() => { const l = __e2e.all('ul.problems li').map((li) => li.textContent.trim()); return l.length ? l : null })()`,
      'what is wrong in the source',
      { timeoutMs: 30_000 },
    )
    assert.deepEqual(problems, [
      '칸 이름 "담당"이(가) 두 번 이상 쓰였습니다(다시 쓰인 줄: 11). 문서에는 이 이름으로 값이 하나만 남아 두 칸이 같은 값을 가집니다.',
      '칸 "메모"의 조건이 이 서식에 없는 칸 "분류"을(를) 가리킵니다. 값이 들어올 수 없어 늘 같게 판정됩니다 — visible-if라면 칸이 계속 숨습니다.',
      'lowline.suggest의 "분류"은(는) 이 서식의 칸이 아니라 제안이 켜지지 않습니다.',
      '칸 "고객"이(가) 가리키는 서식 "customer"이(가) 볼트에 없습니다. 고를 문서가 없어, 그 서식(id: customer)이 생길 때까지 값은 적힌 그대로 둡니다.',
      '칸 "태그"의 "<-> tag"(여러 문서를 가리킴)은 아직 읽지 않습니다 — 이 칸은 적힌 타입 그대로 쓰입니다. 한 문서를 가리키려면 "->"를 쓰세요.',
    ])
    assert.equal(
      await app.cdp.evaluate(`__e2e.all('dc-checkbox').filter((c) => c.getAttribute('name') === '담당').length`),
      1,
      'a name used twice is listed once',
    )
    // The sidecar takes the template in too — one field of that name — rather than failing the whole vault.
    await app.showTable(EDGE)
    await app.cdp.waitFor(`__e2e.all('ll-table').some((t) => /문서 0건/.test(t.shadowRoot.textContent))`, "the template's table", { timeoutMs: 30_000 })
    assert.equal(await hostReports(), hostBefore, 'no failure reported by the sidecar')
    await app.templateOf(EDGE)

    // Front matter that cannot be read is said as that, not as a missing id, and the file is left as it was.
    await app.fill('textarea', source.replace('version: 1', 'version: [1'))
    await app.click('dc-button', '저장')
    const said = await app.cdp.waitFor(`__e2e.all('[role=alert]').map((el) => el.textContent.trim()).find(Boolean)`, 'why it was not saved')
    assert.match(said, /^서식 앞부분\(front matter\)을 읽을 수 없어 저장하지 않습니다 — /)
    assert.equal(await readFile(file, 'utf8'), source, 'not saved')

    // Leave the vault as the scenarios after this one expect it.
    await app.learning()
    await app.answerUnsaved('편집 버리기')
    await rm(file)
    await app.cdp.waitFor(`!__e2e.one('button.item:not(.group-toggle)', '경계 서식')`, 'the template gone from the sidebar', { timeoutMs: 30_000 })
  },

  async 'lists a template once after its version is edited and saved on its page'(app, vault) {
    const REVISED = { name: '개정 서식', ref: 'revised@1', path: '서식/개정 서식.fd.md' }
    const file = join(vault, REVISED.path)
    const source = '---\nid: revised\nversion: 1\n---\n# 개정\n\n제목: ___@제목\n'
    await writeFile(file, source)
    await app.tabOf(REVISED, '서식', { timeoutMs: 30_000 })
    await app.cdp.waitFor(`__e2e.one('textarea')?.value.includes('id: revised')`, 'the template source')

    await app.fill('textarea', source.replace('version: 1', 'version: 2'))
    await app.cdp.press('s', { code: 'KeyS', modifiers: 2, keyCode: 83 })
    await app.status('저장했습니다')
    assert.match(await readFile(file, 'utf8'), /version: 2/)
    // The same file under its new reference: listed once, and still the place showing.
    const listed = `__e2e.all('button.item:not(.group-toggle)').filter((b) => b.textContent.replace(/\\s+/g, ' ').trim().endsWith(' 개정 서식')).length`
    await app.cdp.waitFor(`(${listed}) === 1 && __e2e.one('button.item[aria-current="page"]')?.textContent.trim().endsWith('개정 서식')`, 'the template listed once and showing', { timeoutMs: 15_000 })
    await new Promise((resolve) => setTimeout(resolve, 1000))
    assert.equal(await app.cdp.evaluate(listed), 1, 'still listed once after the vault is read again')
    assert.equal(await app.value('textarea'), source.replace('version: 1', 'version: 2'), 'the source on screen is the file')
    await app.noAlert()

    // Leave the vault as the scenarios after this one expect it.
    await app.learning()
    await rm(file)
    await app.cdp.waitFor(`!__e2e.one('button.item:not(.group-toggle)', '개정 서식')`, 'the template gone from the sidebar', { timeoutMs: 30_000 })
  },

  async "keeps a template's documents, table and what it learned when its version is raised"(app, vault) {
    const DESK = { name: '안내 데스크', ref: 'desk@1', path: '서식/안내 데스크.fd.md' }
    const body = '# 안내\n\n요청: ___@요청\n\n@부서: [select options="영업,개발"]\n\n@담당: [select options="장비,인사"]\n'
    const source = `---\nid: desk\nversion: 1\nlowline:\n  suggest: [담당]\n---\n${body}`
    // Enough confirmed records for replay to show 부서 decides 담당.
    const confirmed = [['노트북 배터리가 금방 닳아요', '영업'], ['노트북 화면이 깨졌어요', '영업'], ['휴가 일수를 알고 싶어요', '개발'], ['휴가 신청을 취소할게요', '개발'],
      ...Array.from({ length: 10 }, (_, i) => [`안내 요청 ${i + 5}`, i % 2 ? '개발' : '영업'])]
    const owner = { 영업: '장비', 개발: '인사' }
    const files = [join(vault, DESK.path), ...confirmed.map((_, i) => join(vault, '문서', `안내-${i + 1}.md`))]
    await writeFile(files[0], source)
    for (const [i, [request, department]] of confirmed.entries())
      await writeFile(files[i + 1], `---\ntemplate: desk@1\n요청: ${request}\n부서: ${department}\n담당: ${owner[department]}\n---\n${body}`)
    const made = new Set(await documentsIn(vault))
    try {
      await app.tabOf(DESK, '서식', { timeoutMs: 30_000 })
      await app.cdp.waitFor(`__e2e.one('textarea')?.value.includes('id: desk')`, 'the template source')
      await app.fill('textarea', source.replace('version: 1', 'version: 2'))
      await app.cdp.press('s', { code: 'KeyS', modifiers: 2, keyCode: 83 })
      await app.status('저장했습니다')

      // Its documents are still its documents: none of them is set apart as naming no template.
      await app.documentsOf(DESK)
      await app.cdp.waitFor(`${JSON.stringify(confirmed.map((_, i) => `안내-${i + 1}`))}.every((n) => __e2e.all('ll-documents').some((d) => [...d.shadowRoot.querySelectorAll('nav button')].some((b) => b.textContent.trim() === n)))`, 'the documents under the template', { timeoutMs: 30_000 })
      assert.ok(!(await app.cdp.evaluate(`!!__e2e.one('button.item:not(.group-toggle)', '서식 없는 문서')`)), 'no documents set apart')
      await app.showTable(DESK)
      await app.cdp.waitFor(`__e2e.all('ll-table').some((t) => /문서 14건/.test(t.shadowRoot.textContent))`, 'the fourteen documents in the table', { timeoutMs: 30_000 })

      // What the revision before it confirmed still suggests.
      await app.newDocument(DESK)
      await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent === ''`, 'an empty form')
      await app.fill('[data-field-name="요청"]', '노트북 충전이 느려요')
      await app.choose('select[name="부서"]', '영업')
      const note = await app.cdp.waitFor(
        `__e2e.all('[data-formdown-note="담당"]').filter((el) => el.querySelector('.formdown-suggestion')).map((el) => el.textContent.replace(/\\s+/g, ' ').trim())[0]`,
        'a suggestion from the earlier revision',
        { timeoutMs: 30_000 },
      )
      assert.match(note, /^제안 · 함께 확정된 값: 부서: 영업/)
      assert.equal(await app.cdp.evaluate(`__e2e.one('.formdown-suggestion')?.textContent`), '장비')
      // A document saved now is written with the revision it was made under; the earlier ones are left as they were.
      await app.click('.formdown-suggestion', '장비')
      await app.cdp.press('s', { code: 'KeyS', modifiers: 2, keyCode: 83 })
      await app.status('저장했습니다')
      const [saved] = (await documentsIn(vault)).filter((n) => !made.has(n))
      files.push(join(vault, '문서', saved))
      assert.match(await readFile(files.at(-1), 'utf8'), /template: desk@2/)
      assert.match(await readFile(files[1], 'utf8'), /template: desk@1/)

      // A document of the earlier revision opens as it was written, says so, and moves to the revision now on request.
      await app.openDocument(DESK, '안내-2')
      const written = await app.cdp.waitFor(`__e2e.all('p.message').map((p) => p.textContent.trim()).find((t) => t.startsWith('이 문서는 서식 1판으로'))`, 'the line about its revision')
      assert.match(written, /\(지금 2판\)/)
      await app.click('dc-button', '지금 판으로 옮기기')
      await app.status('지금 판으로 옮겼습니다')
      const moved = await readFile(files[2], 'utf8')
      assert.match(moved, /template: desk@2/)
      assert.match(moved, /요청: 노트북 화면이 깨졌어요/)
      assert.match(moved, /담당: 장비/)
      assert.ok(!(await app.cdp.evaluate(`__e2e.all('p.message').some((p) => p.textContent.includes('판으로 쓰였습니다'))`)), 'the line gone once moved')

      // A second file with the same id is one template twice: its page says so.
      const copy = join(vault, '서식', '안내 데스크 (옛).fd.md')
      files.push(copy)
      await writeFile(copy, source)
      await app.templateOf(DESK)
      const said = await app.cdp.waitFor(
        `__e2e.all('ul.problems li').map((li) => li.textContent.trim()).find((t) => t.includes('id "desk"'))`,
        'the other file named',
        { timeoutMs: 30_000 },
      )
      assert.match(said, /^다른 서식 파일\(안내 데스크 \(옛\)\)도 id "desk"를 씁니다/)
      await app.noAlert()
    } finally {
      // Leave the vault as the scenarios after this one expect it.
      await app.learning()
      for (const file of files) await rm(file, { force: true })
      await app.cdp.waitFor(`!__e2e.one('button.item:not(.group-toggle)', '안내 데스크')`, 'the template gone from the sidebar', { timeoutMs: 30_000 })
    }
  },

  async "says when the template's documents hold values in a field its source no longer has"(app, vault) {
    const STRAY = { name: '배정표', ref: 'assignments@1', path: '서식/배정표.fd.md' }
    const source = '---\nid: assignments\nversion: 1\n---\n# 배정표\n\n요청: ___@요청\n\n@담당: [select options="장비,인사"]\n'
    const files = [join(vault, STRAY.path), join(vault, '문서', '배정표-1.md'), join(vault, '문서', '배정표-2.md')]
    await writeFile(files[0], source)
    await writeFile(files[1], `---\ntemplate: assignments@1\n요청: 노트북\n담당: 장비\n---\n# 배정표\n`)
    await writeFile(files[2], `---\ntemplate: assignments@1\n요청: 휴가\n담당: 인사\n---\n# 배정표\n`)
    const problems = `__e2e.all('ul.problems li').map((li) => li.textContent.trim())`
    try {
      await app.tabOf(STRAY, '서식', { timeoutMs: 30_000 })
      await app.cdp.waitFor(`__e2e.one('textarea')?.value.includes('id: assignments')`, 'the template source')
      assert.deepEqual(await app.cdp.evaluate(problems), [], 'nothing to say while every value has its field')

      // Renaming the field in the source leaves the documents' values without one — said as it is typed.
      await app.fill('textarea', source.replace('@담당:', '@배정:'))
      const said = await app.cdp.waitFor(`(() => { const p = ${problems}; return p.length ? p : null })()`, 'what the documents hold', { timeoutMs: 15_000 })
      assert.deepEqual(said, [
        '문서 2건에 칸 "담당"의 값이 있는데 이 서식에는 그 칸이 없습니다. 값은 파일에 남지만 표와 제안에서 빠집니다 — 보이는 이름만 바꾸려면 칸 이름은 두고 칸 목록의 "이름 바꾸기"를 쓰세요.',
      ])
      // Changing only what the field shows keeps its name, and its values.
      await app.fill('textarea', source.replace('@담당: [select', '@담당: [select label="배정"'))
      await app.cdp.waitFor(`(${problems}).length === 0`, 'nothing to say once the name is kept')

      // The field list's rename does that: the label changes, the name and the documents' values stay.
      await app.fill('textarea', source)
      const renameOf = (n) => `(() => { const row = __e2e.all('.label-edit')[${n}]; const b = row && row.querySelector('ll-rename').shadowRoot.querySelector('dc-button'); return b && __e2e.box(b) })()`
      await app.cdp.clickAt(await app.cdp.waitFor(renameOf(1), "the 담당 field's rename"))
      // The rename field opens holding the name shown: replace it.
      await app.cdp.waitFor(`(() => { const i = __e2e.one('dc-input[aria-label="새 이름"]'); if (!i) return false; i.focus(); const inner = i.shadowRoot.querySelector('input'); inner.select(); return document.activeElement !== document.body })()`, 'the rename field')
      await app.cdp.insertText('배정')
      await app.cdp.press('Enter', { code: 'Enter', keyCode: 13 })
      await app.cdp.waitFor(`__e2e.one('textarea')?.value.includes('@담당: [select options="장비,인사" label="배정"]')`, 'the label in the source')
      assert.deepEqual(await app.cdp.evaluate(problems), [], 'the values still have their field')
      await app.cdp.press('s', { code: 'KeyS', modifiers: 2, keyCode: 83 })
      await app.status('저장했습니다')
      await app.showTable(STRAY)
      await app.cdp.waitFor(`__e2e.all('thead th').map((th) => th.textContent.trim()).includes('배정')`, 'the column shown by its label')
      const cells = await app.cdp.waitFor(`(() => { const c = __e2e.all('tbody td').map((td) => td.textContent.trim()); return c.includes('장비') && c.includes('인사') && c })()`, 'the values kept')
      assert.ok(cells)
      await app.noAlert()
    } finally {
      // Leave the vault as the scenarios after this one expect it.
      await app.learning()
      // Edits are left unsaved only when the scenario stopped short of saving.
      await new Promise((resolve) => setTimeout(resolve, 300))
      if (await app.cdp.evaluate(`__e2e.all('dc-confirm-dialog').some((d) => d.open)`)) await app.answerUnsaved('편집 버리기')
      await Promise.all(files.map((f) => rm(f, { force: true })))
    }
    await app.cdp.waitFor(`!__e2e.one('button.item:not(.group-toggle)', '배정표')`, 'the template gone from the sidebar', { timeoutMs: 30_000 })
  },

  async 'saves a document whose values were all cleared, named by its day alone'(app, vault) {
    const before = new Set(await documentsIn(vault))
    await app.newDocument(INTAKE)
    await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent === ''`, 'an empty form')
    await app.fill('[data-field-name="요청"]', 'x')
    await app.cdp.press('Backspace', { keyCode: 8 })
    await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent === ''`, 'the request cleared again')
    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    await app.noAlert()

    const created = (await documentsIn(vault)).filter((n) => !before.has(n))
    assert.equal(created.length, 1, 'one document')
    assert.match(created[0], /^\d{4}-\d{2}-\d{2}(-\d+)?\.md$/, 'named by the day: there is no value to name it by')
    const { lowline, ...values } = await fileValues(join(vault, '문서', created[0]))
    assert.ok(lowline?.id, 'it names itself')
    assert.deepEqual(values, { template: 'intake@1' }, 'no field holds a value')

    await app.learning()
    await rm(join(vault, '문서', created[0]))
  },

  async "shows a field only while its condition holds, and keeps its value when it is hidden"(app, vault) {
    const ORDER = { name: '주문', ref: 'order@1', path: '서식/주문.fd.md' }
    const template = join(vault, ORDER.path)
    await writeFile(
      template,
      '---\nid: order\nversion: 1\n---\n# 주문\n\n품목: ___@품목\n\n@구분: [radio options="개인,법인"]\n\n@회사명: [text visible-if="구분=법인" required-if="구분=법인"]\n',
    )
    const shown = `(() => { const el = __e2e.one('input[name="회사명"]'); return !!el && !el.closest('.formdown-field').hidden })()`
    const before = new Set(await readdir(join(vault, '문서')))
    try {
      await app.newDocument(ORDER)
      await app.cdp.waitFor(`!!__e2e.one('input[name="회사명"]')`, 'the form')
      await app.cdp.waitFor(`!${shown}`, 'the company field hidden before 구분 is 법인')
      await app.click('input[name="구분"][value="법인"]')
      await app.cdp.waitFor(shown, 'the company field shown for 법인')
      assert.equal(await app.cdp.evaluate(`__e2e.one('input[name="회사명"]').required`), true, 'and required')
      await app.fill('input[name="회사명"]', '주식회사 경계')

      // Hidden again, the value stays — and is saved with the document.
      await app.click('input[name="구분"][value="개인"]')
      await app.cdp.waitFor(`!${shown}`, 'the company field hidden for 개인')
      await app.fill('[data-field-name="품목"]', '의자')
      await app.click('dc-button', '저장')
      await app.status('저장했습니다')
      await app.noAlert()
      const [created] = (await readdir(join(vault, '문서'))).filter((n) => !before.has(n))
      const saved = await fileValues(join(vault, '문서', created))
      assert.deepEqual([saved.구분, saved.회사명, saved.품목], ['개인', '주식회사 경계', '의자'])
      await app.learning()
      await rm(join(vault, '문서', created))
    } finally {
      await rm(template, { force: true })
    }
    await app.cdp.waitFor(`!__e2e.one('button.item:not(.group-toggle)', '주문')`, 'the template gone from the sidebar', { timeoutMs: 30_000 })
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
    // The sidecar's report comes back on its own time: only the page's two are in the order they happened.
    assert.deepEqual(written.filter((r) => r.layer === 'ui').map((r) => r.kind), ['RangeError', 'outside-vault'])
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
      // Its judgment field is a radio group: a suggested option shows in the field itself, not beside it.
      assert.equal(sample.forms.find((f) => f.name === '담당')?.type, 'radio')
      assert.ok(!existsSync(join(empty, '문서')), 'no documents: suggestions learn only from what a person confirms')

      await app.click('dc-button', '새 문서')
      await app.cdp.waitFor(`__e2e.all('p.judgment').some((el) => el.textContent.includes('제안 받는 칸: 담당'))`, 'its judgment field', { timeoutMs: 30_000 })
      const why = await app.cdp.waitFor(`__e2e.all('[data-formdown-note="담당"]').map((el) => el.textContent.trim())[0]`, 'why 담당 has no suggestion yet')
      assert.match(why, /^확정한 문서가 아직 없어/)
      await app.noAlert()

      // The learning view names the sample's judgment field before anything is decided about it.
      await app.learning()
      const undecided = await app.cdp.waitFor(
        `(() => { const h = __e2e.all('h2').find((el) => el.textContent.trim().endsWith('· 담당')); return h && h.parentElement.textContent.replace(/\\s+/g, ' ').trim() })()`,
        "the sample's judgment field in the learning view",
        { timeoutMs: 30_000 },
      )
      assert.match(undecided, /아직 결정된 제안이 없습니다/)
      await app.noAlert()
    } finally {
      await app.openVault(vault) // back to the vault the scenarios after this one use
      await rm(empty, { recursive: true, force: true })
      await rm(taken, { recursive: true, force: true })
    }
  },

  async 'starts a new document with Ctrl+N and finds with Ctrl+F; while a question is open, the shortcuts wait'(app, vault) {
    const ctrl = (key) => app.cdp.press(key, { code: `Key${key.toUpperCase()}`, modifiers: 2, keyCode: key.toUpperCase().charCodeAt(0) })
    const emptyForm = `__e2e.one('[data-field-name="요청"]')?.textContent === ''`
    await app.showTable(INTAKE)
    await ctrl('n')
    await app.cdp.waitFor(emptyForm, 'a new document from the table')
    assert.deepEqual(await app.where(), { place: INTAKE.name, tab: '문서' })

    // A shortcut does not act under the question it would answer.
    const before = await documentsIn(vault)
    await app.fill('[data-field-name="요청"]', '프린터 용지가 걸려요')
    await ctrl('n')
    await app.cdp.waitFor(`__e2e.all('dc-confirm-dialog').some((d) => d.open)`, 'the unsaved-edits question')
    await ctrl('s')
    await new Promise((resolve) => setTimeout(resolve, 1000))
    assert.deepEqual(await documentsIn(vault), before, 'nothing saved under the question')
    assert.ok(await app.cdp.evaluate(`__e2e.all('dc-confirm-dialog').some((d) => d.open)`), 'the question still open')
    await app.answerUnsaved('편집 버리기')
    await app.cdp.waitFor(emptyForm, 'a new document again')

    await ctrl('f')
    await app.cdp.waitFor(`(() => { let el = document.activeElement; while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement; return el?.type === 'search' })()`, 'the find box focused')
    await app.noAlert()
  },

  async 'keeps the keyboard in the document: a new one opens on its first field, and a save leaves the cursor where it was'(app, vault) {
    const ctrl = (key) => app.cdp.press(key, { code: `Key${key.toUpperCase()}`, modifiers: 2, keyCode: key.toUpperCase().charCodeAt(0) })
    const focusedField = `(() => { let el = document.activeElement; while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement; return el?.getAttribute('data-field-name') ?? el?.getAttribute('name') ?? el?.localName })()`
    const before = await documentsIn(vault)
    await app.tabOf(INTAKE, '문서')
    await ctrl('n')
    await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent === ''`, 'an empty form')
    await app.cdp.waitFor(`${focusedField} === '요청'`, 'the cursor in the first field')
    await app.cdp.insertText('키보드만으로 쓴 요청') // typed straight away, no click
    await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent === '키보드만으로 쓴 요청'`, 'what was typed in the first field')
    await ctrl('s')
    await app.status('저장했습니다')
    assert.equal(await app.cdp.evaluate(focusedField), '요청', 'the cursor still in the field after saving')
    // A caret, not the value selected: typing goes on, it does not replace what was written.
    assert.equal(
      await app.cdp.evaluate(`(() => { const r = __e2e.all('formdown-ui')[0].shadowRoot; return (r.getSelection?.() ?? getSelection()).isCollapsed })()`),
      true,
      'the caret, not a selection',
    )
    await app.noAlert()
    for (const name of (await documentsIn(vault)).filter((n) => !before.includes(n))) await rm(join(vault, '문서', name))
  },

  async 'shows the shortcuts on Ctrl+/, and moves along the document list with the arrow keys as one Tab stop'(app) {
    const focused = `(() => { let el = document.activeElement; while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement; return el })()`
    await app.tabOf(INTAKE, '문서')
    await app.cdp.press('/', { code: 'Slash', modifiers: 2, keyCode: 191 })
    await app.cdp.waitFor(`__e2e.all('dp-shortcut-overlay')[0]?.open === true`, 'the shortcuts showing')
    const rows = await app.cdp.evaluate(`[...__e2e.all('dp-shortcut-overlay')[0].shadowRoot.querySelectorAll('li')].map((li) => li.textContent.replace(/\\s+/g, ' ').trim())`)
    assert.ok(rows.includes('저장 Ctrl+S') && rows.includes('단축키 보기 Ctrl+/'), rows.join(' | '))
    // While they show, the other shortcuts wait: Ctrl+N leaves what is open as it was.
    const shown = `__e2e.all('ll-documents')[0].shadowRoot.querySelector('formdown-ui')?.content ?? null`
    const before = await app.cdp.evaluate(shown)
    await app.cdp.press('n', { code: 'KeyN', modifiers: 2, keyCode: 78 })
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(await app.cdp.evaluate(shown), before, 'no new document under the shortcuts')
    await app.cdp.press('Escape', { code: 'Escape', keyCode: 27 })
    await app.cdp.waitFor(`!__e2e.all('dp-shortcut-overlay')[0].open`, 'the shortcuts gone on Escape')

    // The list is one Tab stop: from the find box, Tab lands on one document and the next Tab leaves the list.
    await app.cdp.press('f', { code: 'KeyF', modifiers: 2, keyCode: 70 })
    await app.cdp.waitFor(`${focused}?.type === 'search'`, 'the find box focused')
    const stops = await app.cdp.evaluate(`__e2e.all('ll-documents')[0].shadowRoot.querySelectorAll('nav button.document[tabindex="0"]').length`)
    assert.equal(stops, 1, 'one Tab stop in the list')
    await app.cdp.press('Tab', { code: 'Tab', keyCode: 9 })
    await app.cdp.waitFor(`${focused}?.classList.contains('document')`, 'a document of the list focused')
    await app.cdp.press('Home', { code: 'Home', keyCode: 36 })
    const first = await app.cdp.waitFor(`${focused}?.classList.contains('document') && ${focused}.textContent.trim()`, 'the first document focused')
    await app.cdp.press('ArrowDown', { code: 'ArrowDown', keyCode: 40 })
    const second = await app.cdp.waitFor(`${focused}?.classList.contains('document') && ${focused}.textContent.trim()`, 'the next document focused')
    assert.notEqual(second, first, 'ArrowDown moved along the list')
    await app.cdp.press('Home', { code: 'Home', keyCode: 36 })
    assert.equal(await app.cdp.evaluate(`${focused}.textContent.trim()`), first, 'Home went back to the first')
    await app.noAlert()
  },

  async 'shows what Lowline is: its version, its license, where its source is, and the notices of what it ships with'(app) {
    await app.sidebar('정보')
    const about = `__e2e.all('ll-about')[0]`
    const text = `${about}.shadowRoot.textContent.replace(/\\s+/g, ' ')`
    const { version } = JSON.parse(await readFile(join(here, '..', 'src-tauri', 'tauri.conf.json'), 'utf8'))
    await app.cdp.waitFor(`${about}.open && ${text}.includes(${q(`판 ${version}`)})`, 'the about dialog with the version')
    const shown = await app.cdp.evaluate(text)
    for (const part of ['© iyulab', 'AGPL-3.0', '어떤 보증도 없이', 'https://github.com/iyulab/lowline'])
      assert.ok(shown.includes(part), `${part} in ${shown}`)
    // The notices are read only when opened: the file the installer lays beside the app.
    await app.click('summary', '함께 쓰는 소프트웨어의 고지')
    const notices = await app.cdp.waitFor(`${about}.shadowRoot.querySelector('pre')?.textContent`, 'the notices', { timeoutMs: 15_000 })
    assert.ok(notices.includes('Formbase.Core') && notices.includes('lit'), 'the notices list what is shipped')
    await app.click('dc-button', '닫기')
    await app.cdp.waitFor(`!${about}.open`, 'the about dialog closed')
    await app.noAlert()
  },

  async 'tells of a newer release when it starts, installs only when asked, and looks no more once told not to'(app, vault) {
    const banner = `(__e2e.all('p.update')[0]?.textContent.replace(/\\s+/g, ' ').trim() ?? '')`
    const settingsNow = async () => JSON.parse(await readFile(SETTINGS, 'utf8').catch(() => '{}'))
    const about = `__e2e.all('ll-about')[0]`
    const toggleChecking = async (on) => {
      await app.sidebar('정보')
      await app.cdp.waitFor(`${about}.open && !!${about}.shadowRoot.querySelector('dc-checkbox')`, 'the about dialog with its update setting')
      await app.cdp.evaluate(`${about}.shadowRoot.querySelector('dc-checkbox').click()`)
      await app.cdp.waitFor(`${about}.shadowRoot.querySelector('dc-checkbox').checked === ${on}`, `checking ${on ? 'on' : 'off'}`)
      for (let tries = 0; (await settingsNow()).checkForUpdates !== on; tries++) {
        assert.ok(tries < 50, 'the setting written to this device')
        await new Promise((r) => setTimeout(r, 100))
      }
      await app.click('dc-button', '닫기')
      await app.cdp.waitFor(`!${about}.open`, 'the about dialog closed')
    }

    // Nothing newer: nothing to tell, though it looked.
    assert.ok(updates.requests > 0, 'it looked when it started')
    assert.equal(await app.cdp.evaluate(banner), '', 'nothing told while nothing is newer')

    updates.newer = '99.0.0'
    try {
      await app.reopen(vault)
      await app.cdp.waitFor(`${banner}.includes('새 판 99.0.0')`, 'the newer release told', { timeoutMs: 15_000 })
      // Put off: told no more in this run of the app, and nothing installed.
      await app.click('dc-button', '나중에')
      await app.cdp.waitFor(`${banner} === ''`, 'put off')

      await toggleChecking(false)
      const looks = updates.requests
      await app.reopen(vault)
      await new Promise((r) => setTimeout(r, 2_000))
      assert.equal(updates.requests, looks, 'no look while checking is off')
      assert.equal(await app.cdp.evaluate(banner), '', 'nothing told while checking is off')
    } finally {
      updates.newer = null
    }
    await toggleChecking(true)
    await app.noAlert()
  },

  async 'tells once, on the first launch, what leaves the computer, and shows the rest under 정보'(app, vault) {
    const line = `(__e2e.all('p.outbound-once')[0]?.textContent.replace(/\\s+/g, ' ').trim() ?? '')`
    const about = `__e2e.all('ll-about')[0]`
    const told = async () => JSON.parse(await readFile(SETTINGS, 'utf8')).outboundToldOnce
    await writeFile(SETTINGS, JSON.stringify({ ...JSON.parse(await readFile(SETTINGS, 'utf8')), outboundToldOnce: false }))
    await app.reopen(vault)
    await app.cdp.waitFor(`${line}.includes('실패 정보만 iyulab에')`, 'the one-time line')
    await app.click('dc-button', '자세히')
    await app.cdp.waitFor(`${about}.open && [...${about}.shadowRoot.querySelectorAll('details')].some((d) => d.open && d.textContent.includes('90일'))`, '정보 with what leaves the computer unfolded')
    await app.click('dc-button', '닫기')
    await app.cdp.waitFor(`!${about}.open && ${line} === ''`, 'the line answered')
    for (let tries = 0; !(await told()); tries++) {
      assert.ok(tries < 50, 'answered on this device')
      await new Promise((r) => setTimeout(r, 100))
    }
    await app.reopen(vault)
    await new Promise((r) => setTimeout(r, 1_000))
    assert.equal(await app.cdp.evaluate(line), '', 'told once only')
    await app.noAlert()
  },

  async 'writes and saves a document with the keyboard alone in at most 12 keys'(app, vault) {
    let keys = 0
    const press = async (key, options) => {
      keys++
      await app.cdp.press(key, options)
    }
    const focusedName = `(() => { let el = document.activeElement; while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement; return el?.getAttribute('data-field-name') ?? el?.getAttribute('name') ?? null })()`
    /** Tab until the field named has focus — each Tab counted. */
    const tabTo = async (name) => {
      for (let i = 0; i < 6; i++) {
        if ((await app.cdp.evaluate(focusedName)) === name) return
        await press('Tab', { code: 'Tab', keyCode: 9 })
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      assert.fail(`${name} not reached with Tab`)
    }
    const before = await documentsIn(vault)
    await app.tabOf(INTAKE, '문서')
    await press('n', { code: 'KeyN', modifiers: 2, keyCode: 78 })
    await app.cdp.waitFor(`${focusedName} === '요청'`, 'the cursor in the first field')
    keys++ // what is typed counts as one
    await app.cdp.insertText('키보드 예산 확인')
    await tabTo('부서')
    await press('ArrowDown', { code: 'ArrowDown', keyCode: 40 })
    await tabTo('담당')
    await press('ArrowDown', { code: 'ArrowDown', keyCode: 40 })
    await press('s', { code: 'KeyS', modifiers: 2, keyCode: 83 })
    await app.status('저장했습니다')
    const made = (await documentsIn(vault)).filter((n) => !before.includes(n))
    assert.equal(made.length, 1, 'one document saved')
    const saved = await fileValues(join(vault, '문서', made[0]))
    assert.equal(saved.요청, '키보드 예산 확인')
    assert.ok(saved.부서 && saved.담당, `both choices made: ${saved.부서} · ${saved.담당}`)
    assert.ok(keys <= 12, `${keys} keys for one document`)
    await app.noAlert()
    for (const name of made) await rm(join(vault, '문서', name))
  },

  async 'opens the vault and the place it was left at, on the next launch'(app, vault) {
    await app.tabOf(INTAKE, '문서')
    await new Promise((resolve) => setTimeout(resolve, 500)) // where it is has been written down
    // Launched again, and nothing opened for it: it opens what it was showing.
    await app.restart()
    await app.cdp.waitFor(`document.querySelector('ll-app').vaultInfo?.name === ${JSON.stringify(basename(vault))}`, 'the vault it was using', { timeoutMs: 30_000 })
    await app.cdp.waitFor(`__e2e.one('button.item[aria-current="page"]')?.textContent.trim().endsWith(${JSON.stringify(INTAKE.name)})`, 'the template it was showing', { timeoutMs: 30_000 })
    assert.deepEqual(await app.where(), { place: INTAKE.name, tab: '문서' })
    await app.noAlert()
  },

  async 'keeps a narrow window usable: the sidebar is a drawer that gives way to a pick and to its backdrop'(app, vault) {
    // Below the shell's desktop breakpoint (1024px), and above the window's minimum width (720).
    const drawerOpen = () => app.cdp.evaluate(`__e2e.all('dp-shell')[0].hasAttribute('sidebar-open')`)
    const openDrawer = async () => {
      await app.click(`button[aria-label="사이드바 접기/펼치기"]`)
      await app.cdp.waitFor(`__e2e.all('dp-shell')[0].hasAttribute('sidebar-open')`, 'the drawer open')
    }
    await app.cdp.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 560, deviceScaleFactor: 1, mobile: false })
    try {
      await app.cdp.waitFor(`innerWidth === 800`, 'the narrow window')
      assert.equal(await drawerOpen(), false, 'the content is not covered to begin with')

      await openDrawer()
      await app.learning()
      await app.cdp.waitFor(`!__e2e.all('dp-shell')[0].hasAttribute('sidebar-open')`, 'the drawer closed on the pick')
      assert.equal((await app.where()).place, '학습')

      await openDrawer()
      await app.cdp.clickAt({ x: 600, y: 300 }) // the backdrop, right of the drawer
      await app.cdp.waitFor(`!__e2e.all('dp-shell')[0].hasAttribute('sidebar-open')`, 'the drawer closed on its backdrop')
      assert.equal((await app.where()).place, '학습', 'the backdrop picked nothing')

      await openDrawer()
      await app.cdp.press('Escape', { code: 'Escape', keyCode: 27 })
      await app.cdp.waitFor(`!__e2e.all('dp-shell')[0].hasAttribute('sidebar-open')`, 'the drawer closed on Escape')

      // Picking the place already shown still closes the drawer.
      await openDrawer()
      await app.learning()
      await app.cdp.waitFor(`!__e2e.all('dp-shell')[0].hasAttribute('sidebar-open')`, 'the drawer closed on the place already shown')

      // The list and a document take turns: one pane at a time, and a way back to the list.
      await openDrawer()
      await app.tabOf(INTAKE, '문서')
      const shown = () => app.cdp.evaluate(`(() => {
        const view = __e2e.all('dp-list-detail')[0], root = view.shadowRoot
        const visible = (sel) => getComputedStyle(root.querySelector(sel)).display !== 'none'
        return (visible('.list') ? 'list' : '') + (visible('.detail') ? 'detail' : '')
      })()`)
      await app.cdp.waitFor(`__e2e.all('ll-documents')[0]?.shadowRoot.querySelector('nav button.document')`, 'the list')
      assert.equal(await shown(), 'list')
      await app.click('nav button.document')
      await app.cdp.waitFor(`__e2e.all('dp-list-detail')[0].hasAttribute('detail-open')`, 'the document open')
      assert.equal(await shown(), 'detail')
      await app.click('dc-button.back', '목록으로')
      await app.cdp.waitFor(`!__e2e.all('dp-list-detail')[0].hasAttribute('detail-open')`, 'back at the list')
      assert.equal(await shown(), 'list')

      // A document that closes by being deleted returns to the list, and the list says what became of it.
      const doc = join(vault, '문서', '좁은 창에서 지울 문의.md')
      await writeFile(doc, `---
template: intake@1
요청: 지울 기록
---
${(await fileBody(join(vault, INTAKE.path))).trimStart()}`)
      try {
        await app.pickDocument('좁은 창에서 지울 문의')
        await app.cdp.waitFor(`__e2e.all('dp-list-detail')[0].hasAttribute('detail-open')`, 'the document open')
        await app.click('dc-button', '지우기')
        await app.click('dc-button', '휴지통으로 옮기기')
        await deleteForGoodOverSmb(app, '영구히 지우기')
        const said = SMB ? '지웠습니다' : '휴지통으로 옮겼습니다'
        await app.cdp.waitFor(
          `__e2e.all('p.closed').some((p) => p.checkVisibility() && p.textContent.trim() === ${q(said)}) && ${'!'}__e2e.all('dp-list-detail')[0].hasAttribute('detail-open')`,
          'the list saying the document is gone',
        )
        await trashed(join(vault, '문서'))
      } finally {
        await rm(doc, { force: true })
      }
      await app.noAlert()
    } finally {
      await app.cdp.send('Emulation.clearDeviceMetricsOverride')
    }
  },

  async 'lays a wide window out in three columns: the sidebar folds to its rail, the list is as wide as it, each scrolls on its own'(app) {
    const sidebar = `__e2e.all('dp-sidebar')[0]`
    const toggle = `button[aria-label="사이드바 접기/펼치기"]`
    await app.tabOf(INTAKE, '문서')
    const widths = () => app.cdp.evaluate(`(() => {
      // The list's column, scrollbar and all: a long list scrolls inside it.
      const list = __e2e.all('dp-list-detail')[0].shadowRoot.querySelector('.list').getBoundingClientRect()
      return { sidebar: Math.round(${sidebar}.getBoundingClientRect().width), list: Math.round(list.width) }
    })()`)
    const { sidebar: wide, list } = await widths()
    // 1 : 1 — the list is as wide as the sidebar (the list's own column, its border inside).
    assert.ok(Math.abs(wide - list) <= 2, `the list (${list}px) as wide as the sidebar (${wide}px)`)
    assert.equal(await app.cdp.evaluate(`__e2e.one(${JSON.stringify(toggle)}).getAttribute('aria-expanded')`), 'true')
    // The page does not scroll: the list and the document do, each on its own.
    assert.ok(
      await app.cdp.evaluate(`(() => { const p = __e2e.all('dp-page')[0]; return p.hasAttribute('fill') && p.scrollHeight <= p.clientHeight + 1 })()`),
      'the page itself does not scroll',
    )
    for (const pane of ['.list', '.detail'])
      assert.equal(await app.cdp.evaluate(`getComputedStyle(__e2e.all('dp-list-detail')[0].shadowRoot.querySelector('${pane}')).overflowY`), 'auto', pane)

    await app.click(toggle)
    await app.cdp.waitFor(`${sidebar}.hasAttribute('collapsed')`, 'the sidebar folded to its rail')
    assert.equal(await app.cdp.evaluate(`__e2e.one(${JSON.stringify(toggle)}).getAttribute('aria-expanded')`), 'false')
    assert.ok((await widths()).sidebar < wide / 2, 'the rail is narrow')
    assert.equal(await app.cdp.evaluate(`__e2e.all('dp-shell')[0].hasAttribute('sidebar-open')`), false, 'no drawer in a wide window')
    await app.click(toggle)
    await app.cdp.waitFor(`!${sidebar}.hasAttribute('collapsed')`, 'the sidebar whole again')
    await app.noAlert()
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
      await app.reopen(vault)
      const opened = Date.now() - filled
      await app.showTable(INTAKE, { timeoutMs: 300_000 })
      await app.cdp.waitFor(`__e2e.all('tbody tr').some((tr) => tr.textContent.includes('(0)'))`, 'the large table', { timeoutMs: 300_000 })
      const first = Date.now() - filled
      // Where the restart went: the window and the vault opened, then each sync step, summed over the
      // syncs it took, each sync's share apart — so a slower restart says which step grew, and whether in
      // the first sync or in the ones after it.
      const syncSteps = async () => {
        const each = await app.cdp.evaluate(`(() => { const each = {}
          for (const m of performance.getEntriesByType('measure')) if (m.name.startsWith('vault:')) (each[m.name.slice(6)] ??= []).push(Math.round(m.duration))
          return each })()`)
        return Object.entries(each)
          .map(([k, v]) => `${k} ${v.reduce((a, b) => a + b, 0)}${v.length > 1 ? ` (${v.join('+')})` : ''}`)
          .join(' · ')
      }
      const restartSteps = await syncSteps()
      const restartBlocked = await longTasks(app)
      // Ten thousand new documents: the sidecar replays the fields' history for their thresholds meanwhile.
      const replaying = await sidecarCpuOver(5_000)

      await app.cdp.evaluate(`performance.clearMeasures()`)
      const edited = Date.now()
      await writeFile(file(0), source.replace('노트북 배터리가 금방 닳아요', '노트북 충전기가 고장났어요 (고침)'))
      await app.cdp.waitFor(`__e2e.all('tbody tr').some((tr) => tr.textContent.includes('(고침)'))`, 'the edit in the table', { timeoutMs: 120_000 })
      const edit = Date.now() - edited
      const steps = await app.cdp.evaluate(
        `Object.fromEntries(performance.getEntriesByType('measure').filter((m) => m.name.startsWith('vault:')).map((m) => [m.name.slice(6), Math.round(m.duration)]))`,
      )

      // A later launch with nothing changed: the thresholds the first launch's replay chose are kept beside
      // the cache, so the sidecar has no replay to run — its CPU over the seconds after is what an idle app costs.
      // The first launch's work is let finish first — its replay and its text index, whichever ends last — or the
      // later launch would only be finishing it.
      const kept = await thresholdsChosenSince(filled)
      const settled = await sidecarQuiet()
      const again = Date.now()
      await app.reopen(vault)
      const reopened = Date.now() - again
      await app.showTable(INTAKE, { timeoutMs: 300_000 })
      await app.cdp.waitFor(`__e2e.all('tbody tr').some((tr) => tr.textContent.includes('(고침)'))`, 'the table again', { timeoutMs: 300_000 })
      const unchanged = Date.now() - again
      const unchangedSteps = await syncSteps()
      const unchangedBlocked = await longTasks(app)
      const idle = await sidecarCpuOver(5_000)
      console.log(
        `    ${COUNT} documents · restart to table ${first} ms (window and vault ${opened} · ${restartSteps} ms · ${restartBlocked}) · one outside edit to table ${edit} ms · last sync ${Object.entries(steps).map(([k, v]) => `${k} ${v} ms`).join(' · ')}`,
      )
      console.log(`    sidecar CPU over 5 s after that restart ${replaying} ms · unchanged restart to table ${unchanged} ms (window and vault ${reopened} · ${unchangedSteps} ms · ${unchangedBlocked}) · sidecar CPU over the next 5 s ${idle} ms${kept ? '' : ' (no thresholds were kept)'}${settled ? '' : ' (the first launch never went quiet)'}`)
    },
  }),
}

/**
 * How long the window's main thread was held by tasks of 50 ms or more since the page loaded, as a phrase for a
 * measurement line: work a restart does on the UI thread — listing, reading, rendering a large vault — blocks the
 * window before it shows in the time to the table, as a list rendered row by row against the whole list once did.
 */
async function longTasks(app) {
  const { count, total, longest } = await app.cdp.evaluate(`new Promise((resolve) => {
    const done = (entries) => resolve({
      count: entries.length,
      total: Math.round(entries.reduce((sum, e) => sum + e.duration, 0)),
      longest: Math.round(Math.max(0, ...entries.map((e) => e.duration))),
    })
    // The buffered entries come in one call; with none, there is no call.
    const observer = new PerformanceObserver((list) => { observer.disconnect(); done(list.getEntries()) })
    observer.observe({ type: 'longtask', buffered: true })
    setTimeout(() => { observer.disconnect(); done([]) }, 1000)
  })`)
  return `main thread held ${total} ms in ${count} long tasks, longest ${longest}`
}

/** Waits until the sidecar has kept thresholds chosen after `since` beside the e2e app's caches; false if it never did. */
async function thresholdsChosenSince(since, timeoutMs = 180_000) {
  const { stat } = await import('node:fs/promises')
  const caches = join(process.env.LOCALAPPDATA ?? tmpdir(), IDENTIFIER, 'projections')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const name of await readdir(caches).catch(() => [])) {
      if (name.endsWith('.thresholds.json') && (await stat(join(caches, name))).mtimeMs >= since) return true
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

/** Waits until the sidecar spends under a tenth of a core over two seconds; false if it never did. */
async function sidecarQuiet(timeoutMs = 180_000) {
  for (const until = Date.now() + timeoutMs; Date.now() < until; ) if ((await sidecarCpuOver(2_000)) < 200) return true
  return false
}

/** The CPU time the sidecar spends over the next `ms`, in milliseconds. */
async function sidecarCpuOver(ms) {
  const { execFileSync } = await import('node:child_process')
  const cpu = () =>
    Number(execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process Lowline.Host).TotalProcessorTime.TotalMilliseconds`], { encoding: 'utf8' }).trim())
  const before = cpu()
  await new Promise((resolve) => setTimeout(resolve, ms))
  return Math.round(cpu() - before)
}

/**
 * What the app was saying when a scenario failed, for the runner to print beside the failure and its
 * picture: the page's open dialog, alerts and status lines, what the sidecar answers — a failure there is
 * kept off the screen, suggestions being optional — and the last error reports.
 */
async function shown(app) {
  const said = await app.cdp.evaluate(
    `[
      ...__e2e.all('dc-confirm-dialog').filter((d) => d.open).map((d) => 'dialog: ' + d.heading),
      ...__e2e.all('[role=alert], [role=status]').map((el) => el.getAttribute('role') + ': ' + el.textContent.trim()),
    ].filter((t) => !t.endsWith(': '))`,
  )
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
  return `page: ${JSON.stringify(said)}\n    sidecar: ${JSON.stringify(sidecar)}\n    reports: ${reported.join('\n             ')}`
}

/** Over SMB (`E2E_VAULT_UNC`) the vault has no trash: the app asks again, and the answer is `button`. */
const SMB = Boolean(process.env.E2E_VAULT_UNC)

async function deleteForGoodOverSmb(app, button) {
  if (!SMB) return
  await app.cdp.waitFor(
    `__e2e.all('dc-confirm-dialog').some((d) => d.open && d.heading === '휴지통으로 옮기지 못했습니다')`,
    'asked to delete for good, where there is no trash',
  )
  await app.click('dc-button', button)
}

/**
 * What the system's trash took from `folder` (see `takeFromRecycleBin`), or `null` where it cannot be
 * looked into: off Windows, on a CI runner, whose service session sees an empty Recycle Bin, and over SMB, where nothing goes to one.
 * Scenarios still check that the file left the vault.
 */
function trashed(folder) {
  return process.platform === 'win32' && !process.env.CI && !SMB ? takeFromRecycleBin(folder) : Promise.resolve(null)
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

/**
 * A fresh start for one run: the fixture vault copied to a new folder — reached over SMB with
 * E2E_VAULT_UNC — this device's settings as a fresh install's, and the app opened on the vault.
 */
async function start() {
  const local = await mkdtemp(join(tmpdir(), 'lowline-e2e-'))
  await cp(join(here, 'fixtures', 'vault'), local, { recursive: true })
  // A shared folder: the same files, reached over SMB. Needs the drive's administrative share.
  const vault = process.env.E2E_VAULT_UNC ? local.replace(/^([A-Za-z]):/, (_, drive) => '\\\\localhost\\' + drive.toUpperCase() + '$') : local
  const stop = () => rm(local, { recursive: true, force: true })
  try {
    // Each run's vault is a new folder, so an earlier run's projection cache and record of suggestions
    // shown would only pile up.
    for (const dir of ['projections', 'presentations'])
      await rm(join(process.env.LOCALAPPDATA ?? tmpdir(), IDENTIFIER, dir), { recursive: true, force: true })
    // This device's settings start as a fresh install's, past the first launch's one-time line about what
    // leaves the computer (its own scenario shows it).
    await mkdir(dirname(SETTINGS), { recursive: true })
    await writeFile(SETTINGS, JSON.stringify({ outboundToldOnce: true }))
    const app = await App.launch()
    await app.openVault(vault)
    // Scenarios run in order against one window: each builds on the files the last one left.
    return { app, context: vault, stop }
  } catch (e) {
    await stop()
    throw e
  }
}

if (!existsSync(exe)) throw new Error(`no e2e build at ${exe} — run \`npm run build:e2e\` first`)
let code = await runScenarios(scenarios, { start, shown })
// The sidecar lives in the app's job object: when the app is gone, so is the sidecar.
if (process.platform === 'win32' && (await sidecarsRunning()) > 0) {
  console.log('  ✗ the sidecar outlived the app')
  code = 1
}
process.exitCode = code
