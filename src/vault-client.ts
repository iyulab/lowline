// The UI's only way to the vault: commands handled by the shell, which owns every file.
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { FieldCurve, IngestResult, ProjectionTable, Suggestion, VaultSnapshot } from './projection.js'

export interface VaultInfo {
  root: string
  name: string
  templatesDir: string
  documentsDir: string
}

export interface VaultEntry {
  /** Relative to the vault root, `/`-separated. */
  path: string
  name: string
  modifiedMs: number
  /**
   * For a copy a sync client made when the file changed on two devices, the path of the file it is a
   * copy of. Which of the two to keep is the person's to decide.
   */
  conflictOf?: string
}

/** A listing's files apart from their conflict copies, and the paths that have a copy. */
export function withoutConflictCopies(entries: readonly VaultEntry[]): { files: VaultEntry[]; conflicted: Set<string> } {
  const conflicted = new Set<string>()
  const files: VaultEntry[] = []
  for (const entry of entries) {
    if (entry.conflictOf === undefined) files.push(entry)
    else conflicted.add(entry.conflictOf)
  }
  return { files, conflicted }
}

/** A failed command, as the shell reports it. */
export interface VaultFailure {
  kind: 'outside-vault' | 'already-exists' | 'not-found' | 'io' | 'no-vault'
  message: string
}

export function isVaultFailure(e: unknown): e is VaultFailure {
  return typeof e === 'object' && e !== null && 'kind' in e && 'message' in e
}

/**
 * Told of each file the app itself writes — the watch does not report those back — with the vault
 * path, or `null` for this device's event file.
 */
export const onWritten = new Set<(path: string | null) => void>()

const wrote = (path: string | null) => {
  for (const listener of onWritten) listener(path)
}

export const vault = {
  open: (path: string) => invoke<VaultInfo>('open_vault', { path }),
  listTemplates: () => invoke<VaultEntry[]>('list_templates'),
  listDocuments: () => invoke<VaultEntry[]>('list_documents'),
  read: (path: string) => invoke<string>('read_file', { path }),
  /** Several files in one call, in order; `null` for one removed since it was listed. */
  readMany: (paths: string[]) => invoke<(string | null)[]>('read_files', { paths }),
  /** Replaces the file atomically. */
  write: async (path: string, content: string) => {
    await invoke<void>('write_file', { path, content })
    wrote(path)
  },
  /** Creates the file atomically; rejects with `already-exists` instead of replacing one. */
  create: async (path: string, content: string) => {
    await invoke<void>('create_file', { path, content })
    wrote(path)
  },
  /** Appends a suggestion event to this device's event file in the vault. */
  recordEvent: async (event: object) => {
    await invoke<void>('record_event', { event })
    wrote(null)
  },
  /** Every device's event file. */
  listEvents: () => invoke<VaultEntry[]>('list_events'),
  /** Keeps a suggestion shown on this device, outside the vault (see `Presentation`). */
  recordPresentation: (presentation: object) => invoke<void>('record_presentation', { presentation }),
  /** This device's record of the suggestions it has shown for the open vault. */
  readPresentations: () => invoke<string>('read_presentations'),
}

/** What changed in the vault outside the app. Paths are relative to the vault, `/`-separated. */
export interface VaultChanged {
  /** Changes were lost: everything shown may be stale. */
  rescan: boolean
  written: string[]
  removed: string[]
}

/** Calls `onChange` whenever something outside the app changes the vault; resolves to the way to stop. */
export function onVaultChanged(onChange: (change: VaultChanged) => void): Promise<UnlistenFn> {
  return listen<VaultChanged>('vault-changed', (e) => onChange(e.payload))
}

/**
 * Whether a change removed `path`. When changes were lost there is no list of removals, so the
 * vault's listing as it is now — `listed`, read after the change — decides.
 */
export function removedBy(change: VaultChanged, path: string, listed: readonly string[]): boolean {
  return change.removed.includes(path) || (change.rescan && !listed.includes(path))
}

/** Whether a change touches `path`. */
export function touches(change: VaultChanged, path: string): boolean {
  return change.rescan || change.written.includes(path) || change.removed.includes(path)
}

/** Whether the sidecar is up. */
export type HostStatus = { state: 'starting' } | { state: 'ready' } | { state: 'failed'; message: string }

/** The sidecar, through the shell: the UI never holds its address or token. */
export const host = {
  status: () => invoke<HostStatus>('host_status'),
  ingest: (snapshot: VaultSnapshot) => invoke<IngestResult>('host_ingest', { snapshot }),
  projection: (template: string) => invoke<ProjectionTable>('host_projection', { template }),
  curves: () => invoke<FieldCurve[]>('host_curves'),
  /** `document` is the draft's vault path once it has been saved; a rejection there is not offered again. */
  suggest: (template: string, field: string, values: Record<string, unknown>, document?: string) =>
    invoke<Suggestion>('host_suggest', { request: { template, field, values, document } }),
}
