// New document files: named for their day and title, never replacing one that is there.
import { documentFileName } from './documents.js'
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
