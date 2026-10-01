import { describe, expect, it } from 'vitest'
import { SharedRun } from '../shared-run.js'

/** A run whose end the test decides. */
function controlled() {
  const ends: ((value: number) => void)[] = []
  let started = 0
  const shared = new SharedRun(() => {
    started++
    return new Promise<number>((resolve) => ends.push(resolve))
  })
  return { shared, ends, started: () => started }
}

describe('SharedRun', () => {
  it('hands callers who ask while a run is under way that same run', async () => {
    const { shared, ends, started } = controlled()
    const a = shared.call()
    const b = shared.call()
    expect(started()).toBe(1)
    ends[0](7)
    expect(await a).toBe(7)
    expect(await b).toBe(7)
  })

  it('runs again once the run has finished', async () => {
    const { shared, ends, started } = controlled()
    const first = shared.call()
    ends[0](1)
    await first
    const second = shared.call()
    expect(started()).toBe(2)
    ends[1](2)
    expect(await second).toBe(2)
  })

  it('starts a run of its own for a caller who asks after something changed', async () => {
    const { shared, ends, started } = controlled()
    const before = shared.call()
    shared.invalidate()
    const after = shared.call()
    const alongside = shared.call()
    expect(started()).toBe(2)
    ends[1](2)
    ends[0](1)
    expect(await before).toBe(1)
    expect(await after).toBe(2)
    expect(await alongside).toBe(2)
  })

  it('lets the next caller run again after a run failed', async () => {
    let calls = 0
    const shared = new SharedRun(async () => {
      calls++
      if (calls === 1) throw new Error('unreadable')
      return calls
    })
    await expect(shared.call()).rejects.toThrow('unreadable')
    expect(await shared.call()).toBe(2)
  })
})
