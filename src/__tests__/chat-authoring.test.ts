import { describe, expect, it } from 'vitest'
import { draftOf, draftProblems, fieldChanges, retryMessage, tidyDraft, wordsOf } from '../chat-authoring.ts'

const fence = '```'
const before = '---\nid: intake\nversion: 1\n---\n# 접수\n\n@요청: [textarea rows=3]\n'
const after = '---\nid: intake\nversion: 1\n---\n# 접수\n\n@요청: [textarea rows=3]\n\n@기한: [date]\n'

describe('the chat that writes templates', () => {
  it('takes the template from the last block of a reply, and the words from the rest', () => {
    const reply = `기한 칸을 넣었습니다.\n\n${fence}formdown\n${after}${fence}\n\n저장해 주세요.`
    expect(draftOf(reply)).toBe(after)
    expect(wordsOf(reply)).toBe('기한 칸을 넣었습니다.\n\n\n\n저장해 주세요.')
  })

  it('takes a block without a language too, and passes over one that holds no template', () => {
    expect(draftOf(`${fence}\n${after}${fence}`)).toBe(after)
    expect(draftOf(`예시: ${fence}js\nconsole.log(1)\n${fence}`)).toBeNull()
    expect(draftOf('기한 칸은 날짜로 두면 됩니다.')).toBeNull()
  })

  it('makes a field name with spaces one word, and leaves every other line as it is', () => {
    expect(tidyDraft('@처리 기한: [date]\n제목: ___@제목\n@요청: [textarea]\n')).toBe('@처리_기한: [date]\n제목: ___@제목\n@요청: [textarea]\n')
  })

  it('puts a field written without its brackets in them, as the parser says to, and leaves text that only starts like one', () => {
    const draft = '---\nid: t\nversion: 1\n---\n# 접수\n\n@고객_이름: text\n@문의_유형: select options="배송,환불"\n@연락처: [email]\n@김: text me later\n'
    expect(tidyDraft(draft)).toBe(
      '---\nid: t\nversion: 1\n---\n# 접수\n\n@고객_이름: [text]\n@문의_유형: [select options="배송,환불"]\n@연락처: [email]\n@김: text me later\n',
    )
    expect(fieldChanges(before, tidyDraft(draft)).added).toEqual(['고객_이름', '문의_유형', '연락처'])
  })

  it('says what stands in the way of a draft, as the template page says it', () => {
    expect(draftProblems(after)).toEqual([])
    expect(draftProblems('# 접수\n\n@요청: [text]\n').length).toBeGreaterThan(0) // no id, no version
    const twice = draftProblems('---\nid: t\nversion: 1\n---\n@요청: [text]\n@요청: [text]\n')
    expect(twice.some((p) => p.includes('요청'))).toBe(true)
    expect(retryMessage(['a', 'b'])).toMatch(/\n- a\n- b$/)
  })

  it('names the fields a draft adds and takes away', () => {
    expect(fieldChanges(before, after)).toEqual({ added: ['기한'], removed: [] })
    expect(fieldChanges(after, before)).toEqual({ added: [], removed: ['기한'] })
  })
})
