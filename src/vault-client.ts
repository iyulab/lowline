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
}

/** A failed command, as the shell reports it. */
export interface VaultFailure {
  kind: 'outside-vault' | 'already-exists' | 'not-found' | 'io' | 'no-vault'
  message: string
}

export function isVaultFailure(e: unknown): e is VaultFailure {
  return typeof e === 'object' && e !== null && 'kind' in e && 'message' in e
}

export const vault = {
  open: (path: string) => invoke<VaultInfo>('open_vault', { path }),
  listTemplates: () => invoke<VaultEntry[]>('list_templates'),
  listDocuments: () => invoke<VaultEntry[]>('list_documents'),
  read: (path: string) => invoke<string>('read_file', { path }),
  /** Replaces the file atomically. */
  write: (path: string, content: string) => invoke<void>('write_file', { path, content }),
  /** Creates the file atomically; rejects with `already-exists` instead of replacing one. */
  create: (path: string, content: string) => invoke<void>('create_file', { path, content }),
  /** Appends a suggestion event to this device's event file in the vault. */
  recordEvent: (event: object) => invoke<void>('record_event', { event }),
  /** Every device's event file. */
  listEvents: () => invoke<VaultEntry[]>('list_events'),
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
