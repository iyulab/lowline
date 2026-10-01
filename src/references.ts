// Fields whose value names another document: `@고객 -> customer: [select]` holds the id of one of the
// documents of the template `customer` (its `lowline.id`, or its path when it has none — identity.ts), and
// shows it by that document's file name. The file keeps the id alone, so renaming the document changes
// nothing in the files that name it.

import { fileName, type FieldValues } from './documents.js'
import type { DocumentSnapshot, ProjectionTable, TemplateSnapshot } from './projection.js'
import { strings } from './strings.js'
import { templateId } from './template-revision.js'

/** A value a reference field can take: a document's id, shown by its name. */
export interface ReferenceChoice {
  value: string
  label: string
}

/**
 * The documents each reference field of `template` can name, by field name, in the order of their names.
 * A value the field holds that names no document in the vault is kept and shown as missing rather than
 * dropped. `self` — the document being written — is not offered for its own fields.
 */
export function referenceChoices(
  template: TemplateSnapshot | undefined,
  templates: readonly TemplateSnapshot[],
  documents: readonly DocumentSnapshot[],
  names: ReadonlyMap<string, string>,
  values: FieldValues,
  self?: string,
): Record<string, ReferenceChoice[]> {
  const choices: Record<string, ReferenceChoice[]> = {}
  for (const field of template?.fields ?? []) {
    const target = field.reference
    if (!target) continue
    const listed = documents
      .filter((d) => templateId(d.template) === target && d.id !== self)
      .map((d) => ({ value: d.id, label: fileName(d.path, '.md') }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko'))
    const value = values[field.name]
    if (typeof value === 'string' && value && !listed.some((c) => c.value === value)) {
      const ref = templates.find((t) => templateId(t.ref) === target)?.ref
      listed.push({ value, label: strings.missingReference((ref && names.get(ref)) || target, value) })
    }
    choices[field.name] = listed
  }
  return choices
}

/**
 * The table as people read it: each reference field's value — a document's id — as that document's name,
 * or as missing when the vault does not have it. What the table filters and sorts by stays the id.
 */
export function withReferenceNames(
  table: ProjectionTable,
  template: TemplateSnapshot | undefined,
  templates: readonly TemplateSnapshot[],
  documents: readonly DocumentSnapshot[],
  names: ReadonlyMap<string, string>,
): ProjectionTable {
  const fields = (template?.fields ?? []).filter((f) => f.reference)
  if (!fields.length) return table
  // A document is found among its own template's documents only, as the field offers them.
  const nameOf = new Map(documents.map((d) => [`${templateId(d.template)}\n${d.id}`, fileName(d.path, '.md')]))
  const shown = (target: string, value: unknown) => {
    if (typeof value !== 'string' || !value) return value
    const name = nameOf.get(`${target}\n${value}`)
    if (name !== undefined) return name
    const ref = templates.find((t) => templateId(t.ref) === target)?.ref
    return strings.missingReference((ref && names.get(ref)) || target, value)
  }
  return {
    ...table,
    rows: table.rows.map((row) => ({
      ...row,
      values: { ...row.values, ...Object.fromEntries(fields.map((f) => [f.name, shown(f.reference!, row.values[f.name])])) },
    })),
  }
}

/** The documents of one template that name a document, newest first. */
export interface Referring {
  template: string
  documents: { path: string; name: string }[]
}

/**
 * The documents whose reference fields name document `id` of template `target` (by id), by template in the
 * vault's order, each template's newest first — what a customer's page lists under the customer.
 */
export function referringDocuments(
  id: string,
  target: string,
  templates: readonly TemplateSnapshot[],
  documents: readonly DocumentSnapshot[],
): Referring[] {
  return templates.flatMap((template) => {
    const fields = template.fields.filter((f) => f.reference === target).map((f) => f.name)
    if (!fields.length) return []
    const naming = documents
      .filter((d) => templateId(d.template) === templateId(template.ref) && d.id !== id && fields.some((f) => d.values[f] === id))
      .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0) || a.path.localeCompare(b.path))
      .map((d) => ({ path: d.path, name: fileName(d.path, '.md') }))
    return naming.length ? [{ template: template.ref, documents: naming }] : []
  })
}
