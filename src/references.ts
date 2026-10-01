// Fields whose value names another document: `@고객 -> customer: [select]` holds the id of one of the
// documents of the template `customer` (its `lowline.id`, or its path when it has none — identity.ts), and
// shows it by that document's file name. The file keeps the id alone, so renaming the document changes
// nothing in the files that name it.

import { fileName, type FieldValues } from './documents.js'
import type { DocumentSnapshot, TemplateSnapshot } from './projection.js'
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
