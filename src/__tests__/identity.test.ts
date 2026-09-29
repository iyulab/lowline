import { describe, expect, it } from 'vitest'
import { documentId, newDocumentId } from '../identity.js'

describe('document ids', () => {
  it('makes a fresh id for each new document', () => {
    expect(newDocumentId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(newDocumentId()).not.toBe(newDocumentId())
  })

  it('knows a document by its id, or by its path when it has none', () => {
    expect(documentId('문서/a.md', 'f00d')).toBe('f00d')
    expect(documentId('문서/a.md', undefined)).toBe('문서/a.md')
  })
})
