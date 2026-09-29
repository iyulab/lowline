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
