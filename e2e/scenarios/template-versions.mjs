import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { INTAKE, documentsIn, fileValues } from '../shared.mjs'

export default {
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
}
