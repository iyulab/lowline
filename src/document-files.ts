// New document and template files: never replacing one that is there.
import { documentFileName } from './documents.js'
import { sampleTemplate, starterTemplate, strings } from './strings.js'
import { vault } from './vault-client.js'

/** Creates a document file in `dir`; a name already taken gets a number. Returns its vault path. */
export function createDocumentFile(
  dir: string,
  source: string,
  title: string | undefined,
  date = new Date(),
): Promise<string> {
  return vault.create(dir, documentFileName(date, title), source)
}

/**
 * Creates a template file in `dir` from the starter, under the new-template name — numbered when
 * taken — with an identity of its own. Returns its vault path.
 */
export function createTemplateFile(dir: string, now = Date.now()): Promise<string> {
  return vault.create(dir, `${strings.newTemplateName}.fd.md`, starterTemplate(`template-${now.toString(36)}`))
}

/** Puts the sample template in a new vault's `dir`. Returns its vault path. */
export function createSampleTemplate(dir: string, now = Date.now()): Promise<string> {
  return vault.create(dir, `${strings.sampleTemplateName}.fd.md`, sampleTemplate(`sample-${now.toString(36)}`))
}
