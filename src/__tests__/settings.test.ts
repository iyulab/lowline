import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, settingsFrom } from '../settings.ts'

describe('settings', () => {
  it('are the defaults before any was written, and when what was written cannot be read', () => {
    expect(settingsFrom(null)).toEqual(DEFAULT_SETTINGS)
    expect(settingsFrom('{ not json')).toEqual(DEFAULT_SETTINGS)
    expect(settingsFrom('{"checkForUpdates":"no"}')).toEqual(DEFAULT_SETTINGS)
  })

  it('keep what was written', () => {
    expect(settingsFrom('{"checkForUpdates":false}')).toEqual({ ...DEFAULT_SETTINGS, checkForUpdates: false })
    expect(settingsFrom('{"outboundToldOnce":true}')).toEqual({ ...DEFAULT_SETTINGS, outboundToldOnce: true })
  })

  it('look for updates unless told not to, tell once what leaves the computer, and have no model until one is set up', () => {
    expect(DEFAULT_SETTINGS).toEqual({ checkForUpdates: true, outboundToldOnce: false, model: null })
  })

  it('keep the model set up, its address only when one was given', () => {
    expect(settingsFrom('{"model":{"preset":"ollama","baseUrl":null,"model":"qwen3:4b"}}').model).toEqual({
      preset: 'ollama',
      baseUrl: null,
      model: 'qwen3:4b',
    })
    expect(settingsFrom('{"model":{"preset":"custom","baseUrl":" http://127.0.0.1:1234/v1 ","model":"m"}}').model).toEqual({
      preset: 'custom',
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'm',
    })
  })

  it('have no model when what was written of it cannot be used, and keep the rest', () => {
    for (const model of ['"ollama"', '{"preset":"ollama"}', '{"model":"m"}', '{"preset":" ","model":"m"}', '{"preset":1,"model":"m"}']) {
      const read = settingsFrom(`{"checkForUpdates":false,"model":${model}}`)
      expect(read.model).toBeNull()
      expect(read.checkForUpdates).toBe(false)
    }
  })

  it('write the model back as read, so a setting changed elsewhere does not drop it', () => {
    const read = settingsFrom('{"model":{"preset":"anthropic","baseUrl":null,"model":"claude"}}')
    expect(settingsFrom(JSON.stringify({ ...read, checkForUpdates: false })).model).toEqual(read.model)
  })
})
