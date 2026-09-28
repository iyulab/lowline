// Reads the vault as the sidecar needs it and hands it over. The sidecar only knows what this sends.

import { TemplateError } from './documents.js'
import { parseEvents, type SuggestionEvent } from './events.js'
import { documentSnapshot, templateSnapshot, type DocumentSnapshot, type TemplateSnapshot } from './projection.js'
import { host, vault, withoutConflictCopies } from './vault-client.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
 * copies is marked as not settled.
 */
export async function readVault(): Promise<ReadVault> {
  const listed = await Promise.all([vault.listTemplates(), vault.listDocuments(), vault.listEvents()])
  const [templateEntries, documentEntries, eventEntries] = listed.map((entries) => withoutConflictCopies(entries).files)
  const { conflicted } = withoutConflictCopies(listed[1])
  // One call into the shell per kind of file, not one per file: a vault of thousands of documents
  // would otherwise spend most of a read crossing that boundary. A file removed since it was listed
  // is left out — the change that removed it reads the vault again.
  const [templateSources, documentSources, eventSources] = await Promise.all([
    vault.readMany(templateEntries.map((e) => e.path)),
    vault.readMany(documentEntries.map((e) => e.path)),
    vault.readMany(eventEntries.map((e) => e.path)),
  ])
  const templates: TemplateSnapshot[] = []
  const names = new Map<string, string>()
  templateEntries.forEach((entry, i) => {
    const source = templateSources[i]
    if (source === null) return
    try {
      const template = templateSnapshot(source)
      templates.push(template)
      names.set(template.ref, entry.name.replace(/\.fd\.md$/, ''))
    } catch (e) {
      if (!(e instanceof TemplateError)) throw e // a template without an identity is left out
    }
  })
  const documents: DocumentSnapshot[] = []
  documentEntries.forEach((entry, i) => {
    const source = documentSources[i]
    const document = source === null ? undefined : documentSnapshot(entry.path, source, entry.modifiedMs)
    if (document) documents.push(conflicted.has(entry.path) ? { ...document, conflicted: true } : document)
  })
  const events = eventSources.flatMap((source) => (source === null ? [] : parseEvents(source)))
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

/** Reads the vault and hands it to the sidecar. */
export async function syncVault() {
  await sidecarReady()
  const read = await readVault()
  const ingest = await host.ingest({ templates: read.templates, documents: read.documents, events: read.events })
  return { ...read, ingest }
}
