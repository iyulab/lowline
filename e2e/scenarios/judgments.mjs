import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { events, fileValues } from '../shared.mjs'

export default {
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

    // The replay runs apart from reading the vault; the learning view, opened once, says what it found when it is done.
    const replay = `(() => { const h = __e2e.all('h2').find((el) => el.textContent.trim() === '배정 · 담당'); const t = h?.parentElement.querySelector('.replay')?.textContent.replace(/\\s+/g, ' ').trim(); return t?.includes('목표') && t })()`
    await app.sidebar(ASSIGN.name, { timeoutMs: 30_000 })
    await app.learning()
    const said = await app.cdp.waitFor(replay, 'the replay of 배정 · 담당, without opening the view again', { timeoutMs: 30_000 })
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

  async 'suggests a judgment from another judgment once the person has settled it'(app, vault) {
    // 승인 goes with 담당, and nothing observed says which 담당 a request has: only a settled 담당 decides 승인.
    const APPROVE = { name: '결재', ref: 'approve@1', path: '서식/결재.fd.md' }
    const body = '# 결재\n\n요청: ___@요청\n\n@담당: [select options="장비,인사,총무"]\n\n@승인: [select options="김,이,박"]\n'
    const template = join(vault, APPROVE.path)
    await writeFile(template, `---\nid: approve\nversion: 1\nlowline:\n  suggest: [담당, 승인]\n---\n${body}`)
    const owners = ['장비', '인사', '총무']
    const approvers = { 장비: '김', 인사: '이', 총무: '박' }
    const files = Array.from({ length: 15 }, (_, i) => join(vault, '문서', `결재-${i + 1}.md`))
    for (const [i, file] of files.entries()) {
      const owner = owners[i % 3]
      await writeFile(file, `---\ntemplate: approve@1\n요청: 서로 다른 요청 ${i + 1}\n담당: ${owner}\n승인: ${approvers[owner]}\n---\n${body}`)
    }

    // Once the replay has shown that a settled 담당 decides 승인, the learning view says how often it was right.
    const replay = `(() => { const h = __e2e.all('h2').find((el) => el.textContent.trim() === '결재 · 승인'); const t = h?.parentElement.querySelector('.replay')?.textContent.replace(/\\s+/g, ' ').trim(); return t?.includes('맞음') && t })()`
    await app.sidebar(APPROVE.name, { timeoutMs: 30_000 })
    await app.learning()
    const said = await app.cdp.waitFor(replay, 'the replay of 결재 · 승인, without opening the view again', { timeoutMs: 30_000 })
    assert.match(said, /^저장된 \d+건을 순서대로 다시 물으면 \d+%에 제안, 그중 \d+% 맞음/)

    await app.newDocument(APPROVE)
    await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent === ''`, 'an empty form')
    await app.fill('[data-field-name="요청"]', '처음 보는 요청')
    // Nothing settled yet says who approves: no suggestion for 승인.
    await app.cdp.waitFor(
      `__e2e.all('[data-formdown-note="승인"]').some((el) => el.textContent.trim().length > 0)`,
      'a note beside 승인',
      { timeoutMs: 15_000 },
    )
    assert.equal(await app.cdp.evaluate(`__e2e.all('[data-formdown-note="승인"] .formdown-suggestion').length`), 0)

    // The person settles 담당; 승인 is now suggested from it.
    await app.choose('select[name="담당"]', '인사')
    const note = await app.cdp.waitFor(
      `__e2e.all('[data-formdown-note="승인"]').filter((el) => el.querySelector('.formdown-suggestion')).map((el) => el.textContent.replace(/\\s+/g, ' ').trim())[0]`,
      'a suggestion for 승인',
      { timeoutMs: 15_000 },
    )
    assert.match(note, /^제안 · 함께 확정된 값: 담당: 인사/)
    assert.equal(await app.cdp.evaluate(`__e2e.one('[data-formdown-note="승인"] .formdown-suggestion')?.textContent`), '이')
    await app.noAlert()

    // Leave the vault as the scenarios after this one expect it.
    await app.learning()
    await app.answerUnsaved('편집 버리기')
    await Promise.all([template, ...files].map((f) => rm(f)))
    await app.cdp.waitFor(`!__e2e.one('button.item:not(.group-toggle)', '결재')`, 'the template gone from the sidebar', { timeoutMs: 30_000 })
  },

  async 'narrows a typed judgment to what the person has begun typing'(app, vault) {
    // 팀 leaves two people each, taking turns: a value settled alongside it is right half the time, its first character every time.
    const HANDOVER = { name: '인계', ref: 'handover@1', path: '서식/인계.fd.md' }
    const body = '# 인계\n\n요청: ___@요청\n\n@팀: [select options="가,나"]\n\n@담당자: [text]\n'
    const template = join(vault, HANDOVER.path)
    await writeFile(template, `---\nid: handover\nversion: 1\nlowline:\n  suggest: [담당자]\n---\n${body}`)
    const people = [['가', '김철수'], ['나', '이민수'], ['가', '박영희'], ['나', '최지은']]
    const files = Array.from({ length: 30 }, (_, i) => join(vault, '문서', `인계-${i + 1}.md`))
    for (const [i, file] of files.entries()) {
      const [team, person] = people[i % 4]
      await writeFile(file, `---\ntemplate: handover@1\n요청: 서로 다른 요청 ${i + 1}\n팀: ${team}\n담당자: ${person}\n---\n${body}`)
    }

    // The replay has run once the learning view says how it did.
    const replay = `(() => { const h = __e2e.all('h2').find((el) => el.textContent.trim() === '인계 · 담당자'); const t = h?.parentElement.querySelector('.replay')?.textContent.replace(/\\s+/g, ' ').trim(); return t?.includes('목표') && t })()`
    await app.sidebar(HANDOVER.name, { timeoutMs: 30_000 })
    await app.learning()
    await app.cdp.waitFor(replay, 'the replay of 인계 · 담당자', { timeoutMs: 30_000 })
    // Beneath it, how typing did: suggested from the first character typed.
    const typing = await app.cdp.evaluate(
      `__e2e.all('h2').find((el) => el.textContent.trim() === '인계 · 담당자')?.parentElement.querySelector('.typing')?.textContent.replace(/\\s+/g, ' ').trim()`,
    )
    assert.match(typing, /^칠 때: 앞 제안이 맞지 않은 기록을 앞에서부터 쳐 보면 1글자 뒤 \d+건 중 \d+%에 제안, 그중 \d+% 맞음/)

    await app.newDocument(HANDOVER)
    await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent === ''`, 'an empty form')
    await app.fill('[data-field-name="요청"]', '처음 보는 요청')
    await app.choose('select[name="팀"]', '가')
    // Nothing is offered for 담당자 before typing: 팀 alone does not decide it.
    await app.cdp.waitFor(
      `__e2e.all('[data-formdown-note="담당자"]').some((el) => el.textContent.trim().length > 0)`,
      'a note beside 담당자',
      { timeoutMs: 15_000 },
    )
    assert.equal(await app.cdp.evaluate(`__e2e.all('[data-formdown-note="담당자"] .formdown-suggestion').length`), 0)

    // One character typed — as a Korean input method types it, the syllable still being composed while the person
    // pauses — and the person who begins with it is offered, without breaking the composition or taking the focus.
    await app.cdp.evaluate(`__e2e.one('input[name="담당자"]').focus()`)
    for (const text of ['ㅂ', '바', '박']) await app.cdp.send('Input.imeSetComposition', { text, selectionStart: 1, selectionEnd: 1 })
    const note = await app.cdp.waitFor(
      `__e2e.all('[data-formdown-note="담당자"]').filter((el) => el.querySelector('.formdown-suggestion')).map((el) => el.textContent.replace(/\\s+/g, ' ').trim())[0]`,
      'a suggestion while typing 담당자',
      { timeoutMs: 15_000 },
    )
    assert.match(note, /^제안 · 함께 확정된 값: 팀: 가/)
    assert.equal(await app.cdp.evaluate(`__e2e.one('[data-formdown-note="담당자"] .formdown-suggestion')?.textContent`), '박영희')
    const focused = `(() => { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a?.getAttribute('name') })()`
    assert.equal(await app.cdp.evaluate(focused), '담당자', 'the field still has the focus')
    await app.cdp.send('Input.insertText', { text: '박' }) // the person goes on: the composed syllable is committed
    assert.equal(await app.cdp.evaluate(`__e2e.one('input[name="담당자"]').value`), '박', 'one syllable, composed once')
    // A person who goes on typing without looking keeps being offered the value believed at the first character, though
    // thirty documents leave no strength of its own for two characters typed.
    await app.cdp.evaluate(`window.__asked = __e2e.one('ll-documents').judgment.suggestions`)
    await app.cdp.send('Input.insertText', { text: '영' })
    await app.cdp.waitFor(`__e2e.one('input[name="담당자"]')?.value === '박영'`, 'a second character typed')
    await app.cdp.waitFor(`__e2e.one('ll-documents').judgment.suggestions !== window.__asked`, 'asked again with 박영', { timeoutMs: 15_000 })
    assert.equal(
      await app.cdp.evaluate(`__e2e.one('[data-formdown-note="담당자"] .formdown-suggestion')?.textContent`),
      '박영희',
      'the value still offered at 박영',
    )
    await app.click('[data-formdown-note="담당자"] .formdown-suggestion', '박영희')
    await app.cdp.waitFor(`__e2e.one('input[name="담당자"]')?.value === '박영희'`, 'the offered value taken')
    await app.cdp.waitFor(`!__e2e.one('[data-formdown-note="담당자"] .formdown-suggestion')`, 'nothing more offered once taken')
    // What the save will record: the value was first shown at one character typed, and taken at two — still one,
    // with two in the field when it was taken.
    assert.equal(await app.cdp.evaluate(`__e2e.one('ll-documents').judgment.offered.get('담당자')?.typed`), 1, 'typed when first shown')
    assert.equal(await app.cdp.evaluate(`__e2e.one('ll-documents').judgment.offered.get('담당자')?.decidedTyped`), 2, 'in the field when taken')
    await app.noAlert()

    // Leave the vault as the scenarios after this one expect it.
    await app.learning()
    await app.answerUnsaved('편집 버리기')
    await Promise.all([template, ...files].map((f) => rm(f)))
    await app.cdp.waitFor(`!__e2e.one('button.item:not(.group-toggle)', '인계')`, 'the template gone from the sidebar', { timeoutMs: 30_000 })
  },

  async 'offers the class of a typed judgment where its value is undecided, and the person types the rest after it'(app, vault) {
    // Each 설비 has five codes of one chapter: the codes settled alongside a 설비 never decide the code, and always its
    // first two characters — which the template says name its class.
    const FAULT = { name: '결함 코드', ref: 'fault@1', path: '서식/결함 코드.fd.md' }
    const body = '# 결함 코드\n\n요청: ___@요청\n\n@설비: [select options="압축기,펌프,밸브"]\n\n@코드: [text]\n'
    const template = join(vault, FAULT.path)
    await writeFile(template, `---\nid: fault\nversion: 1\nlowline:\n  suggest: [코드]\n  coarse: { 코드: 2 }\n---\n${body}`)
    const chapters = [['압축기', '21'], ['펌프', '32'], ['밸브', '52']]
    const files = Array.from({ length: 45 }, (_, i) => join(vault, '문서', `결함-${i + 1}.md`))
    for (const [i, file] of files.entries()) {
      const [unit, chapter] = chapters[i % 3]
      await writeFile(file, `---\ntemplate: fault@1\n요청: 서로 다른 결함 ${i + 1}\n설비: ${unit}\n코드: ${chapter}${String(Math.floor(i / 3) % 5).padStart(2, '0')}\n---\n${body}`)
    }
    // The replay has run once the learning view says how the code did.
    const replay = `(() => { const h = __e2e.all('h2').find((el) => el.textContent.trim() === '결함 코드 · 코드'); const t = h?.parentElement.querySelector('.replay')?.textContent.replace(/\\s+/g, ' ').trim(); return t?.includes('목표') && t })()`
    await app.sidebar(FAULT.name, { timeoutMs: 30_000 })
    await app.learning()
    await app.cdp.waitFor(replay, 'the replay of 결함 코드 · 코드', { timeoutMs: 30_000 })
    // Beneath it, how the class did where the code was not suggested.
    const classLine = await app.cdp.evaluate(
      `__e2e.all('h2').find((el) => el.textContent.trim() === '결함 코드 · 코드')?.parentElement.querySelector('.class')?.textContent.replace(/\\s+/g, ' ').trim()`,
    )
    assert.match(classLine, /^앞부분\(분류\): 값을 제안하지 못한 \d+건 중 \d+%에 분류를 제안, 그중 \d+% 맞음/)

    await app.newDocument(FAULT)
    await app.cdp.waitFor(`__e2e.one('[data-field-name="요청"]')?.textContent === ''`, 'an empty form')
    await app.fill('[data-field-name="요청"]', '처음 보는 결함')
    await app.choose('select[name="설비"]', '펌프')
    // Not the code — 펌프 leaves five — but its chapter, said to be only the start of the value.
    const note = await app.cdp.waitFor(
      `__e2e.all('[data-formdown-note="코드"]').filter((el) => el.querySelector('.formdown-suggestion')).map((el) => el.textContent.replace(/\\s+/g, ' ').trim())[0]`,
      'the class offered for 코드',
      { timeoutMs: 15_000 },
    )
    assert.match(note, /설비: 펌프/)
    assert.match(note, /앞부분\(분류\)만 — 고르면 이어서 칩니다/)
    assert.equal(await app.cdp.evaluate(`__e2e.one('[data-formdown-note="코드"] .formdown-suggestion')?.textContent`), '32')

    // Taken, it is the start of the value: the cursor is back in the field, after it, for the rest.
    await app.click('[data-formdown-note="코드"] .formdown-suggestion', '32')
    await app.cdp.waitFor(`__e2e.one('input[name="코드"]')?.value === '32'`, 'the class put in the field')
    const focused = `(() => { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a?.getAttribute('name') })()`
    await app.cdp.waitFor(`${focused} === '코드'`, 'the cursor back in 코드')
    await app.cdp.send('Input.insertText', { text: '03' })
    await app.cdp.waitFor(`__e2e.one('input[name="코드"]')?.value === '3203'`, 'the rest typed after the class')
    // What the save will record about the class is kept apart from whatever typing the rest offers.
    assert.equal(await app.cdp.evaluate(`__e2e.one('ll-documents').judgment.classes.get('코드')?.suggestion.value`), '32')
    await app.noAlert()

    // Leave the vault as the scenarios after this one expect it.
    await app.learning()
    await app.answerUnsaved('편집 버리기')
    await Promise.all([template, ...files].map((f) => rm(f)))
    await app.cdp.waitFor(`!__e2e.one('button.item:not(.group-toggle)', '결함 코드')`, 'the template gone from the sidebar', { timeoutMs: 30_000 })
  },

  async 'offers a value another program proposed in its field, and learns it only once a person decides it'(app, vault) {
    // A mail sorter wrote a record with its guesses for all three judgments, marked as proposed — 분야 without saying who.
    const SORT = { name: '분류', ref: 'sort@1', path: '서식/분류.fd.md' }
    const body = '# 분류\n\n요청: ___@요청\n\n@담당: [select options="장비,인사,총무"]\n\n@우선: [select options="높음,낮음"]\n\n@분야: [select options="하드웨어,소프트웨어"]\n\n@태그: [checkbox options="급함,반복"]\n'
    const template = join(vault, SORT.path)
    await writeFile(template, `---\nid: sort\nversion: 1\nlowline:\n  suggest: [담당, 우선, 분야]\n---\n${body}`)
    const file = join(vault, '문서', '분류-메일.md')
    // 태그 holds several items: shown as it is, not offered — and its mark stays until the person changes it.
    const proposed = '  proposed:\n    담당: 메일 분류기\n    우선: 메일 분류기\n    분야: 3\n    태그: 메일 분류기\n'
    await writeFile(file, `---\ntemplate: sort@1\n요청: 프린터가 종이를 씹어요\n담당: 총무\n우선: 높음\n분야: 하드웨어\n태그: [급함]\nlowline:\n  id: sort-mail-1\n${proposed}---\n${body}`)

    await app.sidebar(SORT.name, { timeoutMs: 30_000 })
    await app.openDocument(SORT, '분류-메일')
    // Each proposed value is offered in its field, which is shown empty: nothing is settled before the person says so.
    const noteOf = (field) => `__e2e.one('[data-formdown-note="${field}"] .formdown-field-note-text')?.textContent.trim()`
    const offeredIn = (field) => `__e2e.one('[data-formdown-note="${field}"] .formdown-suggestion')?.textContent`
    const note = await app.cdp.waitFor(noteOf('담당'), 'the proposed 담당 offered', { timeoutMs: 15_000 })
    assert.equal(note, '제안 · 메일 분류기에서 넣은 값')
    assert.equal(await app.cdp.evaluate(offeredIn('담당')), '총무')
    assert.equal(await app.cdp.evaluate(noteOf('분야')), '제안 · 다른 프로그램에서 넣은 값', 'who wrote it, when the file does not say')
    assert.equal(await app.cdp.evaluate(offeredIn('분야')), '하드웨어')
    for (const field of ['담당', '우선', '분야']) assert.equal(await app.value(`select[name="${field}"]`), '', `${field} shown empty`)
    assert.equal(await app.value('[data-field-name="요청"]'), '프린터가 종이를 씹어요', 'what was observed is shown as it is')

    // The person takes 담당, turns down 우선, and leaves 분야 to decide later.
    await app.click('[data-formdown-note="담당"] .formdown-suggestion', '총무')
    await app.cdp.waitFor(`__e2e.one('select[name="담당"]')?.value === '총무'`, 'the proposed 담당 taken')
    await app.click('[data-formdown-note="우선"] .formdown-decline', '거절')
    await app.cdp.waitFor(`!__e2e.one('[data-formdown-note="우선"] .formdown-suggestion')`, 'the proposed 우선 set aside')
    const before = (await events(vault)).length
    await app.click('dc-button', '저장')
    await app.status('저장했습니다')
    await app.noAlert()

    // Saved: 담당 is the person's now, 우선 is gone with its mark, and 분야 is still only proposed.
    const saved = await fileValues(file)
    assert.equal(saved.담당, '총무')
    assert.ok(!('우선' in saved), 'the value turned down is taken out')
    assert.equal(saved.분야, '하드웨어', 'a value left undecided stays in the file')
    assert.deepEqual(saved.lowline, { id: 'sort-mail-1', proposed: { 분야: 3, 태그: '메일 분류기' } }, 'saving untouched decides nothing')
    assert.deepEqual(saved.태그, ['급함'])
    assert.match(await readFile(file, 'utf8'), /# 분류/, 'the body stays')
    const decided = (await events(vault)).slice(before)
    assert.deepEqual(
      decided.map((e) => [e.field, e.kind, e.source, e.recall]).sort(),
      [['담당', 'accept', 'proposed', '메일 분류기'], ['우선', 'reject', 'proposed', '메일 분류기']],
    )
    // Still offered after saving, 분야 is still the program's.
    assert.equal(await app.cdp.evaluate(offeredIn('분야')), '하드웨어')
    // The table shows each value, saying which is only proposed.
    await app.showTable(SORT)
    const row = await app.cdp.waitFor(
      `__e2e.all('tbody tr').map((r) => [...r.querySelectorAll('td, th')].map((c) => c.textContent.trim())).find((cells) => cells.includes('총무'))`,
      'the document in the table',
      { timeoutMs: 15_000 },
    )
    assert.ok(row.includes('하드웨어 (제안)') && !row.some((c) => c.startsWith('총무 ')), JSON.stringify(row))

    // Leave the vault as the scenarios after this one expect it.
    await app.learning()
    await Promise.all([template, file].map((f) => rm(f)))
    await app.cdp.waitFor(`!__e2e.one('button.item:not(.group-toggle)', '분류')`, 'the template gone from the sidebar', { timeoutMs: 30_000 })
  },
}
