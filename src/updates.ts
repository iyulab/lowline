// Updates. The shell checks and installs; the UI says when, and the person says whether — nothing is
// installed without them. Whether to look at all is a setting of this device (settings.ts).

import { invoke } from '@tauri-apps/api/core'

/** A newer release than this one. */
export interface AvailableUpdate {
  version: string
  notes: string | null
}

export const update = {
  /** A newer release, or null — also when this build looks nowhere. Fails when the check could not be made. */
  check: () => invoke<AvailableUpdate | null>('check_update'),
  /** Installs what the last check found and starts it; on Windows the app ends here. */
  install: () => invoke<void>('install_update'),
}

export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Looks for a newer release now and once every `everyMs` until stopped, and tells `found` of the first
 * one it sees. A check that fails (offline, say) is tried again at the next turn and never surfaces.
 */
export class UpdateWatch {
  private timer?: ReturnType<typeof setInterval>
  private told = false

  constructor(
    private readonly check: () => Promise<AvailableUpdate | null>,
    private readonly found: (update: AvailableUpdate) => void,
    private readonly everyMs = DAY_MS,
  ) {}

  get running(): boolean {
    return this.timer !== undefined
  }

  start() {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => void this.look(), this.everyMs)
    void this.look()
  }

  stop() {
    clearInterval(this.timer)
    this.timer = undefined
  }

  private async look() {
    if (this.told) return
    let available: AvailableUpdate | null
    try {
      available = await this.check()
    } catch {
      return
    }
    if (!available || this.told || this.timer === undefined) return
    this.told = true
    this.found(available)
  }
}
