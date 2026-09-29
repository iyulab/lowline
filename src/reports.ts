// Failures the UI did not handle, handed to the shell as error reports. Only a failure's kind and
// the frames of its stack are handed over — never its message, which can hold anything on screen.

import { invoke } from '@tauri-apps/api/core'

export interface UiReport {
  /** An error's class name, or the kind of a failure the shell reported. */
  kind: string
  /** The stack's frames alone. */
  stack: string
}

export function reportOf(reason: unknown): UiReport {
  if (reason instanceof Error) {
    const frames = (reason.stack ?? '').split('\n').filter((line) => /^\s+at /.test(line))
    return { kind: reason.name, stack: frames.join('\n') }
  }
  if (typeof reason === 'object' && reason !== null && 'kind' in reason && typeof reason.kind === 'string')
    return { kind: reason.kind, stack: '' }
  return { kind: 'NonError', stack: '' }
}

/** Reports what reaches the window unhandled. The shell keeps only what may leave the device. */
export function watchErrors() {
  const send = (reason: unknown) => void invoke('report_error', { ...reportOf(reason) }).catch(() => {})
  window.addEventListener('error', (e) => send(e.error))
  window.addEventListener('unhandledrejection', (e) => send(e.reason))
}
