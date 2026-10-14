// How Lowline is set up on this device — kept by the shell in the app's settings, outside any vault. A key for a
// model is not here: the shell keeps it in the system's credential store.

import { invoke } from '@tauri-apps/api/core'

/** The model the chat uses: an IronProw preset, its address when not the preset's own, and the model chosen. */
export interface ModelSettings {
  preset: string
  baseUrl: string | null
  model: string
}

export interface Settings {
  /** Whether to look for a newer release when the app starts and once a day while it runs. */
  checkForUpdates: boolean
  /** Whether the person has been told, once, what leaves this computer. */
  outboundToldOnce: boolean
  /** The model the chat uses, once the person has set one up. */
  model: ModelSettings | null
}

export const DEFAULT_SETTINGS: Settings = { checkForUpdates: true, outboundToldOnce: false, model: null }

const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)

/** A model setting as written, or null when any part of it cannot be used. */
function modelFrom(written: unknown): ModelSettings | null {
  if (typeof written !== 'object' || written === null) return null
  const { preset, baseUrl, model } = written as Record<string, unknown>
  const p = text(preset)
  const m = text(model)
  return p && m ? { preset: p, baseUrl: text(baseUrl), model: m } : null
}

/** The settings as written, over the defaults: a missing or unreadable file, or an unreadable setting, is the default. */
export function settingsFrom(written: string | null): Settings {
  if (!written) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(written) as Record<string, unknown>
    const flag = (key: 'checkForUpdates' | 'outboundToldOnce') =>
      typeof parsed[key] === 'boolean' ? (parsed[key] as boolean) : DEFAULT_SETTINGS[key]
    return { checkForUpdates: flag('checkForUpdates'), outboundToldOnce: flag('outboundToldOnce'), model: modelFrom(parsed.model) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export const settings = {
  read: async () => settingsFrom(await invoke<string | null>('read_settings')),
  write: (s: Settings) => invoke<void>('write_settings', { settings: JSON.stringify(s) }),
}
