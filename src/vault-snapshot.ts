// Reads the vault as the sidecar needs it and hands it over. The sidecar only knows what this sends.

import { TemplateError } from './documents.js'
import { documentSnapshot, templateSnapshot, type DocumentSnapshot, type TemplateSnapshot } from './projection.js'
import { host, vault } from './vault-client.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface ReadVault {
  templates: TemplateSnapshot[]
  /** Each template's name as the vault shows it (its file name), by reference. */
  names: Map<string, string>
  documents: DocumentSnapshot[]
}

/** Every template with an identity and every document that names a template. */
export async function readVault(): Promise<ReadVault> {
  const [templateEntries, documentEntries] = await Promise.all([vault.listTemplates(), vault.listDocuments()])
  const templates: TemplateSnapshot[] = []
  const names = new Map<string, string>()
  for (const entry of templateEntries) {
    try {
      const template = templateSnapshot(await vault.read(entry.path))
      templates.push(template)
      names.set(template.ref, entry.name.replace(/\.fd\.md$/, ''))
    } catch (e) {
      if (!(e instanceof TemplateError)) throw e // a template without an identity is left out
    }
  }
  const documents: DocumentSnapshot[] = []
  for (const entry of documentEntries) {
    const document = documentSnapshot(entry.path, await vault.read(entry.path))
    if (document) documents.push(document)
  }
  return { templates, names, documents }
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
  const ingest = await host.ingest({ templates: read.templates, documents: read.documents })
  return { ...read, ingest }
}
