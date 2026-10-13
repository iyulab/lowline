import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'

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
    await app.cdp.evaluate(`window.__asked = __e2e.one('ll-documents').suggestions`)
    await app.cdp.send('Input.insertText', { text: '영' })
    await app.cdp.waitFor(`__e2e.one('input[name="담당자"]')?.value === '박영'`, 'a second character typed')
    await app.cdp.waitFor(`__e2e.one('ll-documents').suggestions !== window.__asked`, 'asked again with 박영', { timeoutMs: 15_000 })
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
    assert.equal(await app.cdp.evaluate(`__e2e.one('ll-documents').offered.get('담당자')?.typed`), 1, 'typed when first shown')
    assert.equal(await app.cdp.evaluate(`__e2e.one('ll-documents').offered.get('담당자')?.decidedTyped`), 2, 'in the field when taken')
    await app.noAlert()

    // Leave the vault as the scenarios after this one expect it.
    await app.learning()
    await app.answerUnsaved('편집 버리기')
    await Promise.all([template, ...files].map((f) => rm(f)))
    await app.cdp.waitFor(`!__e2e.one('button.item:not(.group-toggle)', '인계')`, 'the template gone from the sidebar', { timeoutMs: 30_000 })
  },
}
