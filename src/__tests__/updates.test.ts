import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, UpdateWatch, settingsFrom, type AvailableUpdate } from '../updates.ts'

describe('settings', () => {
  it('are the defaults before any was written, and when what was written cannot be read', () => {
    expect(settingsFrom(null)).toEqual(DEFAULT_SETTINGS)
    expect(settingsFrom('{ not json')).toEqual(DEFAULT_SETTINGS)
    expect(settingsFrom('{"checkForUpdates":"no"}')).toEqual(DEFAULT_SETTINGS)
  })

  it('keep what was written', () => {
    expect(settingsFrom('{"checkForUpdates":false}')).toEqual({ checkForUpdates: false })
  })

  it('look for updates unless told not to', () => {
    expect(DEFAULT_SETTINGS.checkForUpdates).toBe(true)
  })
})

describe('UpdateWatch', () => {
  const DAY = 1000
  const newer: AvailableUpdate = { version: '0.2.0', notes: null }

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('looks at once, then once every turn, and tells of the first newer release only', async () => {
    const answers: (AvailableUpdate | null)[] = [null, newer, newer]
    const check = vi.fn(async () => answers.shift() ?? null)
    const found = vi.fn()
    const watch = new UpdateWatch(check, found, DAY)
    watch.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(check).toHaveBeenCalledTimes(1)
    expect(found).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(DAY)
    expect(found).toHaveBeenCalledWith(newer)
    await vi.advanceTimersByTimeAsync(DAY)
    expect(found).toHaveBeenCalledTimes(1)
    watch.stop()
  })

  it('tries again at the next turn when a check fails, and never surfaces the failure', async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(newer)
    const found = vi.fn()
    const watch = new UpdateWatch(check, found, DAY)
    watch.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(found).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(DAY)
    expect(found).toHaveBeenCalledWith(newer)
    watch.stop()
  })

  it('stops looking when stopped, and does not tell of a check that answers after', async () => {
    let answer!: (u: AvailableUpdate | null) => void
    const check = vi.fn(() => new Promise<AvailableUpdate | null>((r) => (answer = r)))
    const found = vi.fn()
    const watch = new UpdateWatch(check, found, DAY)
    watch.start()
    watch.stop()
    answer(newer)
    await vi.advanceTimersByTimeAsync(DAY * 3)
    expect(check).toHaveBeenCalledTimes(1)
    expect(found).not.toHaveBeenCalled()
    expect(watch.running).toBe(false)
  })

  it('starts once however often it is started', async () => {
    const check = vi.fn(async () => null)
    const watch = new UpdateWatch(check, vi.fn(), DAY)
    watch.start()
    watch.start()
    await vi.advanceTimersByTimeAsync(DAY)
    expect(check).toHaveBeenCalledTimes(2)
    watch.stop()
  })
})
