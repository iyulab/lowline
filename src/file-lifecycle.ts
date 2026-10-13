// Deleting a file and keeping a sync conflict copy in its original's place: the same steps, and the same ways to
// fail, for a document and for a template. Each view says what became of it in its own words.

import { describeError } from './errors.js'
import { strings } from './strings.js'
import { failureKind, vault } from './vault-client.js'

/**
 * How deleting a file went: deleted; the trash would not take it, so the person is to be asked whether to delete it
 * for good; or it failed.
 */
export type Deletion = 'deleted' | 'untrashable' | { error: string }

/** Deletes `path` — to the system's trash, or for good once the person chose that for a file the trash would not take. */
export async function deleteFile(path: string, permanently: boolean): Promise<Deletion> {
  try {
    if (permanently) await vault.remove(path)
    else await vault.trash(path)
    return 'deleted'
  } catch (e) {
    return !permanently && failureKind(e) === 'not-trashed' ? 'untrashable' : { error: describeError(e) }
  }
}

/**
 * How keeping a conflict copy went: kept under its original's name; the trash would not take the original, so the
 * person is to be asked whether to delete it for good; or it failed — `originalGone` when the original was deleted as
 * asked and only the copy's rename failed, so the copy is still a copy under its own name.
 */
export type Keeping = 'kept' | 'untrashable' | { error: string; originalGone: boolean }

/**
 * Keeps the conflict copy `copy` in its `original`'s place: the original goes to the system's trash (or for good), and
 * the copy takes its name — never over another file.
 */
export async function keepConflictCopy(copy: string, original: string, permanently: boolean): Promise<Keeping> {
  const deletion = await deleteFile(original, permanently)
  if (deletion === 'untrashable') return 'untrashable'
  if (deletion !== 'deleted') return { ...deletion, originalGone: false }
  try {
    await vault.rename(copy, original)
    return 'kept'
  } catch (e) {
    return {
      error: failureKind(e) === 'already-exists' ? strings.keptCopyNameTaken(permanently) : describeError(e),
      originalGone: true,
    }
  }
}
