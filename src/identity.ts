// A document's identity: an id in its own front matter (`lowline.id`), so renaming or moving the file
// keeps what was recorded about it — suggestion events, rejections, what suggestions learned — attached
// to it. A document written before documents had ids is known by its vault path, the key its events
// were recorded under; it keeps that path as its id when the app moves it (see `setDocumentId`).

/** An id for a new document. */
export function newDocumentId(): string {
  return crypto.randomUUID()
}

/** What a document is known by: the id in its front matter, or else its vault path. */
export function documentId(path: string, id: string | undefined): string {
  return id ?? path
}

/**
 * The ids more than one document holds — a file copied outside the app keeps its original's id. Until
 * one of them is changed they are the same document twice; the one saved with a change becomes a new
 * document (`documents-view` gives it a new id), and what was recorded stays with the other.
 */
export function sharedIds(documents: readonly { id: string }[]): Set<string> {
  const seen = new Set<string>()
  const shared = new Set<string>()
  for (const { id } of documents) (seen.has(id) ? shared : seen).add(id)
  return shared
}
