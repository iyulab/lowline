import { describe, expect, it } from 'vitest'
import { currentRefs, revisedRef, templateId, templateVersion } from '../template-revision.js'

describe('template revisions', () => {
  it('reads a reference as its id and its revision', () => {
    expect([templateId('intake@2'), templateVersion('intake@2')]).toEqual(['intake', '2'])
    expect([templateId('a@b@3'), templateVersion('a@b@3')]).toEqual(['a@b', '3'])
    expect([templateId('bare'), templateVersion('bare')]).toEqual(['bare', ''])
  })

  it('reads a document of an earlier revision as the template of the same id, at its revision now', () => {
    const current = currentRefs([{ ref: 'intake@2' }, { ref: 'bug-report@1' }])
    expect(revisedRef('intake@1', current)).toBe('intake@2')
    expect(revisedRef('intake@2', current)).toBe('intake@2')
    expect(revisedRef('bug-report@1', current)).toBe('bug-report@1')
    // No template of that id: the document names none the vault has, as before.
    expect(revisedRef('gone@1', current)).toBe('gone@1')
  })

  it('takes the later revision when two template files share an id — numbers as numbers', () => {
    expect(currentRefs([{ ref: 'intake@10' }, { ref: 'intake@9' }]).get('intake')).toBe('intake@10')
    expect(currentRefs([{ ref: 'intake@9' }, { ref: 'intake@10' }]).get('intake')).toBe('intake@10')
    expect(currentRefs([{ ref: 'intake@2026-01' }, { ref: 'intake@2026-03' }]).get('intake')).toBe('intake@2026-03')
  })
})
