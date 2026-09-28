// The UI's only way to the vault: commands handled by the shell, which owns every file.
import { invoke } from '@tauri-apps/api/core'
import type { IngestResult, ProjectionTable, VaultSnapshot } from './projection.js'

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
}

/** Whether the sidecar is up. */
export type HostStatus = { state: 'starting' } | { state: 'ready' } | { state: 'failed'; message: string }

/** The sidecar, through the shell: the UI never holds its address or token. */
export const host = {
  status: () => invoke<HostStatus>('host_status'),
  ingest: (snapshot: VaultSnapshot) => invoke<IngestResult>('host_ingest', { snapshot }),
  projection: (template: string) => invoke<ProjectionTable>('host_projection', { template }),
}
