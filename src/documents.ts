// Templates and documents as text. A template is a Formdown file whose front matter carries
// its `id` and `version`. A document is a copy of the template body whose front matter records
// which template it came from (`template: <id>@<version>`), its own id (`lowline.id`, see
// `identity.ts`) and the value of each field. `template` and `lowline` are not field values.

import { parseFormdown, readFrontMatter, updateFrontMatter } from '@formdown/core'
import { templateId } from './template-revision.js'

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

/** Front matter keys a document uses for itself, not for field values. */
const RESERVED_KEYS = ['template', 'lowline']

/** Reads a template's identity from its front matter. There is no fallback: no id, no template. */
export function templateInfo(source: string): TemplateInfo {
  const data = readFrontMatter(source)?.frontMatter.data ?? {}
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
  // A document keeps these beside its values in front matter: a field of the same name would overwrite them.
  if (parseFormdown(source).forms.some((f) => RESERVED_KEYS.includes(f.name))) {
    throw new TemplateError('reserved-field')
  }
  return { id, version: String(version), ref: `${id}@${version}` }
}

/** The template text after its front matter, byte for byte. */
export function templateBody(source: string): string {
  const span = readFrontMatter(source)?.frontMatter.span
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

/** A new document filled in from `templateSource`, named by `id`. */
export function newDocument(templateSource: string, values: FieldValues, id: string): string {
  const { ref } = templateInfo(templateSource)
  return updateFrontMatter(templateBody(templateSource), { template: ref, lowline: { id }, ...valueChanges(values) })
}

/**
 * A document moved to its template's revision now: its front matter stays as it is — every value it holds,
 * one in a field the revision no longer has included — naming the revision, above the revision's body. The
 * document is still the same document: it keeps its id and what it confirmed.
 */
export function reviseDocument(documentSource: string, templateSource: string): string {
  const { ref } = templateInfo(templateSource)
  const span = readFrontMatter(documentSource)?.frontMatter.span
  const newline = documentSource.includes('\r\n') ? '\r\n' : '\n'
  const body = templateBody(templateSource)
  const moved = span ? documentSource.slice(0, span.end) + newline + body : body
  return updateFrontMatter(moved, { template: ref })
}

/** Gives a document the id `id`; other keys under `lowline`, and the rest of the file, stay as they are. */
export function setDocumentId(documentSource: string, id: string): string {
  const lowline = readFrontMatter(documentSource)?.frontMatter.data.lowline
  const rest = typeof lowline === 'object' && lowline !== null && !Array.isArray(lowline) ? lowline : {}
  return updateFrontMatter(documentSource, { lowline: { ...rest, id } })
}

/** Records new field values in an existing document; the body stays as it is. */
export function updateDocument(documentSource: string, values: FieldValues): string {
  return updateFrontMatter(documentSource, valueChanges(values))
}

/** A document's template reference, id and values, read from its front matter alone. */
export function documentFrontMatter(documentSource: string): { template?: string; id?: string; values: Record<string, unknown> } {
  const { template, lowline, ...values } = readFrontMatter(documentSource)?.frontMatter.data ?? {}
  const id = typeof lowline === 'object' && lowline !== null ? (lowline as { id?: unknown }).id : undefined
  return { ...(typeof template === 'string' ? { template } : {}), ...(typeof id === 'string' && id ? { id } : {}), values }
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

/** The name a file is shown by (R-1): its file name, without `suffix`. */
export function fileName(path: string, suffix: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  return base.endsWith(suffix) ? base.slice(0, -suffix.length) : base
}

/**
 * The file name for a name a person typed — what the lists show a document or template by (R-1) —
 * with `suffix` after it, or `null` when it cannot be one: empty, or holding a character a file name
 * cannot.
 */
export function fileNameFor(name: string, suffix: string): string | null {
  const trimmed = name.trim().replace(/[. ]+$/, '')
  if (!trimmed || /[\\/:*?"<>|\u0000-\u001f]/.test(trimmed)) return null
  return `${trimmed}${suffix}`
}

/**
 * Turns suggestions on or off for one field of a template, under its front matter's `lowline.suggest`
 * (D-46) — the only place the choice is kept. The list follows the template's field order; other keys
 * under `lowline`, and everything else in the file, are left as they are.
 */
export function setSuggest(templateSource: string, field: string, on: boolean): string {
  const data = readFrontMatter(templateSource)?.frontMatter.data ?? {}
  const lowline = typeof data.lowline === 'object' && data.lowline !== null && !Array.isArray(data.lowline) ? (data.lowline as Record<string, unknown>) : {}
  const named = new Set(Array.isArray(lowline.suggest) ? lowline.suggest.filter((n): n is string => typeof n === 'string') : [])
  if (on) named.add(field)
  else named.delete(field)
  const order = parseFormdown(templateSource).forms.map((f) => f.name)
  const suggest = [...named].sort((a, b) => rank(order, a) - rank(order, b))
  const { suggest: _, ...rest } = lowline
  const next = suggest.length > 0 ? { ...rest, suggest } : rest
  return updateFrontMatter(templateSource, { lowline: Object.keys(next).length > 0 ? next : undefined })
}

/** A name's place in the template; names it no longer has go last, in the order they were. */
function rank(order: readonly string[], name: string): number {
  const i = order.indexOf(name)
  return i === -1 ? order.length : i
}

/**
 * What stands in the way of a template working as written, in the order a person would fix it: front matter
 * that cannot be read (the template has no identity then), a field name used twice (a document keeps one
 * value under it, so both fields hold the same), a condition that names no field of the template (it never
 * sees a value, so it decides the same way for every document — a `visible-if` keeps its field hidden), and
 * a `lowline.suggest` name that is not a field (nothing is suggested for it).
 */
export type TemplateProblem =
  | { kind: 'front-matter'; detail: string }
  | { kind: 'duplicate-field'; name: string }
  | { kind: 'unknown-condition'; field: string; name: string }
  | { kind: 'unknown-suggest'; name: string }
  | { kind: 'stray-values'; name: string; count: number }
  | { kind: 'shared-id'; id: string; names: string[] }

/**
 * Fields the template's documents hold values in that its source does not have — a field renamed or
 * removed there. The values stay in the files, but the table and suggestions no longer see them. Each
 * with how many documents hold a value in it, most first. A source that cannot be read has none.
 */
export function strayFields(
  source: string,
  documents: readonly { template: string; values: Record<string, unknown> }[],
): Extract<TemplateProblem, { kind: 'stray-values' }>[] {
  let ref: string
  try {
    ref = templateInfo(source).ref
  } catch {
    return []
  }
  const names = new Set(parseFormdown(source).forms.map((f) => f.name))
  const counts = new Map<string, number>()
  for (const document of documents) {
    // A document of any revision is the template's (template-revision.ts).
    if (templateId(document.template) !== templateId(ref)) continue
    for (const [name, value] of Object.entries(document.values)) {
      const held = value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)
      if (held && !names.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return [...counts]
    .sort(([a, m], [b, n]) => n - m || a.localeCompare(b))
    .map(([name, count]) => ({ kind: 'stray-values', name, count }))
}

/**
 * Other template files with this template's id: a template's revisions are one template, so two files with
 * one id make the vault read one of them as the template (the later revision) and the other as nothing.
 */
export function sharedId(source: string, path: string, templates: readonly { ref: string; path: string; name: string }[]): TemplateProblem[] {
  let id: string
  try {
    id = templateInfo(source).id
  } catch {
    return []
  }
  const names = templates.filter((t) => t.path !== path && templateId(t.ref) === id).map((t) => t.name)
  return names.length ? [{ kind: 'shared-id', id, names }] : []
}

export function templateProblems(source: string): TemplateProblem[] {
  const parsed = parseFormdown(source)
  const problems: TemplateProblem[] = (parsed.diagnostics ?? [])
    .filter((d) => d.code.startsWith('front-matter-') && d.severity === 'error')
    .map((d) => ({ kind: 'front-matter', detail: d.message }))
  const names = parsed.forms.map((f) => f.name)
  for (const name of new Set(names.filter((n, i) => names.indexOf(n) !== i))) problems.push({ kind: 'duplicate-field', name })
  for (const field of parsed.forms) {
    const named = new Set(Object.values(field.conditions ?? {}).map((c) => c?.field).filter((n): n is string => !!n))
    for (const name of named) if (!names.includes(name)) problems.push({ kind: 'unknown-condition', field: field.name, name })
  }
  const lowline = parsed.frontMatter?.data.lowline
  const suggest = typeof lowline === 'object' && lowline !== null ? (lowline as { suggest?: unknown }).suggest : undefined
  for (const name of Array.isArray(suggest) ? suggest : []) {
    if (!names.includes(String(name))) problems.push({ kind: 'unknown-suggest', name: String(name) })
  }
  return problems
}
