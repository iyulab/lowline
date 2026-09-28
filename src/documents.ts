// Templates and documents as text. A template is a Formdown file whose front matter carries
// its `id` and `version`. A document is a copy of the template body whose front matter records
// which template it came from (`template: <id>@<version>`) and the value of each field.

import { parseFormdown, updateFrontMatter } from '@formdown/core'

/** A field's value: text, a list of texts (checkbox group), or a boolean (single checkbox). */
export type FieldValue = string | string[] | boolean
export type FieldValues = Record<string, FieldValue>

export interface TemplateInfo {
  id: string
  version: string
  /** `<id>@<version>`, as written in a document's `template` key. */
  ref: string
}

export class TemplateError extends Error {}

/** Reads a template's identity from its front matter. There is no fallback: no id, no template. */
export function templateInfo(source: string): TemplateInfo {
  const data = parseFormdown(source).frontMatter?.data ?? {}
  const id = data.id
  const version = data.version
  if (typeof id !== 'string' || id.trim() === '') {
    throw new TemplateError('missing-id')
  }
  if ((typeof version !== 'string' && typeof version !== 'number') || String(version).trim() === '') {
    throw new TemplateError('missing-version')
  }
  if (/[@\s]/.test(id)) {
    throw new TemplateError('invalid-id')
  }
  return { id, version: String(version), ref: `${id}@${version}` }
}

/** The template text after its front matter, byte for byte. */
export function templateBody(source: string): string {
  const span = parseFormdown(source).frontMatter?.span
  if (!span) return source
  return source.slice(span.end).replace(/^\r?\n/, '')
}

/**
 * Front matter changes that record `values`; empty text or an empty list removes its key.
 * A boolean is always recorded — an unchecked box is `false`, not a missing value.
 */
function valueChanges(values: FieldValues): Record<string, unknown> {
  const changes: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(values)) {
    const empty = Array.isArray(value) ? value.length === 0 : value === ''
    changes[name] = empty ? undefined : value
  }
  return changes
}

/**
 * Field values from front matter or form data. Text, lists and booleans keep their type — a
 * checkbox written as text ("true") would read back as a different value. Other scalars
 * (numbers, dates) are read as text; missing values are dropped.
 */
export function fieldValues(data: Record<string, unknown>): FieldValues {
  const values: FieldValues = {}
  for (const [name, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'boolean') values[name] = value
    else if (Array.isArray(value)) values[name] = value.map(String)
    else values[name] = String(value)
  }
  return values
}

/** A new document filled in from `templateSource`. */
export function newDocument(templateSource: string, values: FieldValues): string {
  const { ref } = templateInfo(templateSource)
  return updateFrontMatter(templateBody(templateSource), { template: ref, ...valueChanges(values) })
}

/** Records new field values in an existing document; the body stays as it is. */
export function updateDocument(documentSource: string, values: FieldValues): string {
  return updateFrontMatter(documentSource, valueChanges(values))
}

/** A document's template reference and its values, read from its front matter in one parse. */
export function documentFrontMatter(documentSource: string): { template?: string; values: Record<string, unknown> } {
  const { template, ...values } = parseFormdown(documentSource).frontMatter?.data ?? {}
  return { ...(typeof template === 'string' ? { template } : {}), values }
}

/**
 * The value that names a document: the first field, in template order, holding text.
 * Choice fields (select, radio, checkbox) are skipped — "high" names nothing.
 */
export function documentTitle(source: string, values: FieldValues): string | undefined {
  for (const field of parseFormdown(source).forms) {
    if (['select', 'radio', 'checkbox'].includes(field.type)) continue
    const value = values[field.name]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

/**
 * A file name for a new document: the date, then the first field value that reads as a
 * title. Characters that are not allowed in file names are replaced.
 */
export function documentFileName(date: Date, title: string | undefined, attempt = 1): string {
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
  const cleaned = (title ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .replace(/[. ]+$/, '')
  const base = cleaned ? `${day}-${cleaned}` : day
  return attempt > 1 ? `${base}-${attempt}.md` : `${base}.md`
}
