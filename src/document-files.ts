// New document and template files: never replacing one that is there.
import { documentFileName } from './documents.js'
import { starterTemplate, strings } from './strings.js'
import { vault } from './vault-client.js'

/** Creates a document file in `dir`; a name already taken gets a number. Returns its vault path. */
export async function createDocumentFile(
  dir: string,
  source: string,
  title: string | undefined,
  date = new Date(),
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const path = `${dir}/${documentFileName(date, title, attempt)}`
    try {
      await vault.create(path, source)
      return path
    } catch (e) {
      if ((e as { kind?: string }).kind !== 'already-exists' || attempt >= 99) throw e
    }
  }
}

/**
 * Creates a template file in `dir` from the starter, under the new-template name — numbered when
 * taken — with an identity of its own. Returns its vault path.
 */
export async function createTemplateFile(dir: string, now = Date.now()): Promise<string> {
  const source = starterTemplate(`template-${now.toString(36)}`)
  for (let attempt = 1; ; attempt++) {
    const name = attempt === 1 ? strings.newTemplateName : `${strings.newTemplateName} ${attempt}`
    const path = `${dir}/${name}.fd.md`
    try {
      await vault.create(path, source)
      return path
    } catch (e) {
      if ((e as { kind?: string }).kind !== 'already-exists' || attempt >= 99) throw e
    }
  }
}
