import { describe, expect, it } from 'vitest'
import { strings } from '../strings.js'

describe('why a field has no replay', () => {
  const short = { precision: 0.62, answerRate: 0.4, answered: 21, lookups: 52, target: 0.8 }

  it('says how far short of the target the replay came', () => {
    expect(strings.learningNoReplay('below-target', short)).toContain('21건 중 62%만 맞혀 목표 80%에 못 미칩니다')
  })

  it('does not call a replay that reached the target overall short of it: a band within it fell short', () => {
    const text = strings.learningNoReplay('below-target', { ...short, precision: 0.83 })
    expect(text).toContain('합쳐서는 목표 80%에 닿지만, 그 안의 한 구간이 목표에 못 미쳐')
    expect(text).not.toContain('못 미칩니다')
  })

  it('says only that it fell short when the replay found too few to say by how much', () => {
    expect(strings.learningNoReplay('below-target', null)).toContain('목표만큼 맞히는 기준이 없어')
  })
})
