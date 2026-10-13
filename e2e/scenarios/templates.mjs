import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { parseFormdown } from '@formdown/core'
import { TEMPLATE, BUG } from '../shared.mjs'

export default {
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
}
