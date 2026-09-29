// Reads the vault as the sidecar needs it and hands it over. The sidecar only knows what this sends.

import { TemplateError } from './documents.js'
import { parseEvents, type SuggestionEvent } from './events.js'
import { documentSnapshot, templateSnapshot, type DocumentSnapshot, type TemplateSnapshot } from './projection.js'
import { ReadCache } from './read-cache.js'
import { host, onVaultChanged, onWritten, vault, withoutConflictCopies, type VaultChanged, type VaultInfo } from './vault-client.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// What was last read of the open vault. A template without an identity is kept as null.
const templateReads = new ReadCache((_entry, source): TemplateSnapshot | null => {
  try {
    return templateSnapshot(source)
  } catch (e) {
    if (e instanceof TemplateError) return null
    throw e
  }
})
const documentReads = new ReadCache((entry, source) => documentSnapshot(entry.path, source, entry.modifiedMs))
const eventReads = new ReadCache((_entry, source) => parseEvents(source))
const reads = [templateReads, documentReads, eventReads]

let watching: Promise<unknown> | undefined

/** Drops what the last reads know of files a change outside the app touched. */
function forget(change: VaultChanged) {
  for (const cache of reads) cache.forget(change)
}

// A file time may not move between two quick saves (some file systems keep whole seconds).
onWritten.add((path) => (path === null ? eventReads.clear() : forget({ rescan: false, written: [path], removed: [] })))

/** Opens a vault; nothing read of the one before carries over. */
export async function openVault(path: string): Promise<VaultInfo> {
  for (const cache of reads) cache.clear()
  return vault.open(path)
}

export interface ReadVault {
  templates: TemplateSnapshot[]
  /** Each template's name as the vault shows it (its file name), by reference. */
  names: Map<string, string>
  documents: DocumentSnapshot[]
  events: SuggestionEvent[]
}

/**
 * Every template with an identity and every document that names a template. Sync clients' conflict
 * copies are not read: a copy is not a second document, template or event file, and the document it
 * copies is marked as not settled. Only files changed since the last read are read and parsed again.
 */
export async function readVault(): Promise<ReadVault> {
  watching ??= onVaultChanged(forget)
  performance.mark('vault:list')
  const listed = await Promise.all([vault.listTemplates(), vault.listDocuments(), vault.listEvents()])
  performance.measure('vault:list', 'vault:list')
  const [templateEntries, documentEntries, eventEntries] = listed.map((entries) => withoutConflictCopies(entries).files)
  const { conflicted } = withoutConflictCopies(listed[1])
  // One call into the shell per kind of file, not one per file: a vault of thousands of documents
  // would otherwise spend most of a read crossing that boundary. A file removed since it was listed
  // is left out — the change that removed it reads the vault again.
  performance.mark('vault:read')
  const [templateValues, documentValues, eventValues] = await Promise.all([
    templateReads.read(templateEntries, vault.readMany),
    documentReads.read(documentEntries, vault.readMany),
    eventReads.read(eventEntries, vault.readMany),
  ])
  performance.measure('vault:read', 'vault:read')
  const templates: TemplateSnapshot[] = []
  const names = new Map<string, string>()
  templateEntries.forEach((entry, i) => {
    const template = templateValues[i]
    if (!template) return
    templates.push(template)
    names.set(template.ref, entry.name.replace(/\.fd\.md$/, ''))
  })
  const documents: DocumentSnapshot[] = []
  documentEntries.forEach((entry, i) => {
    const document = documentValues[i]
    if (document) documents.push(conflicted.has(entry.path) ? { ...document, conflicted: true } : document)
  })
  const events = eventValues.flatMap((parsed) => parsed ?? [])
  return { templates, names, documents, events }
}

/** Why the sidecar is not there, thrown as a string by `sidecarReady`. */
export class SidecarUnavailable extends Error {}

/** Waits for the sidecar; throws `SidecarUnavailable` if it failed to start. */
export async function sidecarReady() {
  for (;;) {
    const status = await host.status()
    if (status.state === 'ready') return
    if (status.state === 'failed') throw new SidecarUnavailable(status.message)
    await sleep(200)
  }
}

/**
 * Reads the vault and hands it to the sidecar — after `change`, when a change outside the app is why.
 * Each step leaves a `vault:*` performance measure, so what a sync costs can be read from the page.
 */
export async function syncVault(change?: VaultChanged) {
  if (change) forget(change)
  await sidecarReady()
  const read = await readVault()
  performance.mark('vault:ingest')
  const ingest = await host.ingest({ templates: read.templates, documents: read.documents, events: read.events })
  performance.measure('vault:ingest', 'vault:ingest')
  return { ...read, ingest }
}
