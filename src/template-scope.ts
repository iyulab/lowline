// The app is arranged by template: the sidebar lists the vault's templates, and each shows its
// table, its source and its documents.

import type { SidebarEntry } from '@iyulab/desktop-patterns/sidebar'
import type { VaultEntry } from './vault-client.js'
import { templateId } from './template-revision.js'

/** A template as the sidebar shows it: its `id@version`, its name (the file name), its file. */
export interface TemplateItem {
  ref: string
  name: string
  path: string
}

/** Where the app is: a template, the learning view, or the documents that name no template in the vault. */
export type Place = { kind: 'template'; ref: string } | { kind: 'learning' } | { kind: 'orphans' }

/** The sidebar item that makes a template rather than going somewhere. */
export const NEW_TEMPLATE = 'new-template'

const TEMPLATE_PREFIX = 'template:'

/**
 * The templates to list once the vault is read again, and which of them is the one that was showing.
 * A template removed outside while it shows stays listed until it is left: what is on screen is held
 * nowhere else, and saving makes it again. One whose file is still there under another reference —
 * its id or version edited — was not removed: it is listed once, under the reference its file has now.
 */
export function templatesAfterRead(
  read: readonly TemplateItem[],
  shown: TemplateItem | undefined,
): { templates: TemplateItem[]; shown?: TemplateItem } {
  if (!shown) return { templates: [...read] }
  const now = read.find((t) => t.ref === shown.ref) ?? read.find((t) => t.path === shown.path)
  return now ? { templates: [...read], shown: now } : { templates: [...read, shown], shown }
}

export function placeId(place: Place): string {
  return place.kind === 'template' ? TEMPLATE_PREFIX + place.ref : place.kind
}

export function placeOf(id: string): Place | undefined {
  if (id.startsWith(TEMPLATE_PREFIX)) return { kind: 'template', ref: id.slice(TEMPLATE_PREFIX.length) }
  if (id === 'learning' || id === 'orphans') return { kind: id }
  return undefined
}

/**
 * The templates under one group, ending with the way to make one; the documents without a template
 * only while there are some; then learning, which spans templates.
 */
export function sidebarEntries(
  templates: readonly TemplateItem[],
  hasOrphans: boolean,
  labels: { templates: string; newTemplate: string; learning: string; orphans: string; references: string },
  references: ReadonlySet<string> = new Set(),
): SidebarEntry[] {
  // Templates other templates' fields refer to — customers, items — are what records are about: they lead,
  // in a group of their own. Nothing marks them; a field referring to one does.
  const isReference = (t: TemplateItem) => references.has(templateId(t.ref))
  const item = (icon: string) => (t: TemplateItem) => ({ id: placeId({ kind: 'template', ref: t.ref }), icon, label: t.name })
  const referred = templates.filter(isReference)
  return [
    ...(referred.length ? [{ id: 'references', icon: '◇', label: labels.references, items: referred.map(item('◇')) }] : []),
    {
      id: 'templates',
      icon: '▤',
      label: labels.templates,
      items: [...templates.filter((t) => !isReference(t)).map(item('▤')), { id: NEW_TEMPLATE, icon: '+', label: labels.newTemplate }],
    },
    ...(hasOrphans ? [{ id: placeId({ kind: 'orphans' }), icon: '▦', label: labels.orphans }] : []),
    { id: placeId({ kind: 'learning' }), icon: '◔', label: labels.learning },
  ]
}

/**
 * The documents of the template `ref` — or, for `null`, those naming no template the vault has —
 * with their sync conflict copies, which belong where their original does.
 */
export function documentsOf(
  entries: readonly VaultEntry[],
  templateOf: ReadonlyMap<string, string>,
  ref: string | null,
  known: ReadonlySet<string>,
): VaultEntry[] {
  const belongs = (path: string) => {
    const template = templateOf.get(path)
    return ref === null ? template === undefined || !known.has(template) : template === ref
  }
  return entries.filter((e) => belongs(e.conflictOf ?? e.path))
}

/**
 * Documents as a list shows them: by file name, the last first — a new document's name starts with its day,
 * so the latest are on top, and the order does not move when one is edited. Numbers in names count as
 * numbers. A sync conflict copy follows its original.
 */
export function newestFirst(entries: readonly VaultEntry[]): VaultEntry[] {
  const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)
  return [...entries].sort(
    (a, b) =>
      nameOf(b.conflictOf ?? b.path).localeCompare(nameOf(a.conflictOf ?? a.path), undefined, { numeric: true }) ||
      Number(a.conflictOf !== undefined) - Number(b.conflictOf !== undefined) ||
      a.path.localeCompare(b.path),
  )
}
