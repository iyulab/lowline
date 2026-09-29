// The app is arranged by template: the sidebar lists the vault's templates, and each shows its
// table, its source and its documents.

import type { SidebarEntry } from '@iyulab/desktop-patterns/sidebar'
import type { VaultEntry } from './vault-client.js'

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
  labels: { templates: string; newTemplate: string; learning: string; orphans: string },
): SidebarEntry[] {
  return [
    {
      id: 'templates',
      icon: '▤',
      label: labels.templates,
      items: [
        ...templates.map((t) => ({ id: placeId({ kind: 'template', ref: t.ref }), icon: '▤', label: t.name })),
        { id: NEW_TEMPLATE, icon: '+', label: labels.newTemplate },
      ],
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
