/**
 * A template's revisions are one template: its identity is its `id`, and `version` counts its revisions.
 * A document or an event names the revision it was written with (`id@version`, as its file says — files are never
 * rewritten for this). Read against the vault, it belongs to the template of the same id, whatever revision that
 * template is at now, so its values stay in the template's list and table, and what it taught stays learned.
 */

/** The template id of a reference `id@version` — the whole reference when it has no `@`. */
export function templateId(ref: string): string {
  const at = ref.lastIndexOf('@')
  return at < 0 ? ref : ref.slice(0, at)
}

/** The revision of a reference `id@version`; empty when it has none. */
export function templateVersion(ref: string): string {
  const at = ref.lastIndexOf('@')
  return at < 0 ? '' : ref.slice(at + 1)
}

/**
 * The reference each template id is known by in the vault. Two template files with one id is a mistake the
 * template page points out; until it is mended, the later revision is the template — numbers compared as
 * numbers, anything else as text.
 */
export function currentRefs(templates: readonly { ref: string }[]): Map<string, string> {
  const current = new Map<string, string>()
  for (const { ref } of templates) {
    const id = templateId(ref)
    const known = current.get(id)
    if (known === undefined || later(templateVersion(ref), templateVersion(known))) current.set(id, ref)
  }
  return current
}

function later(a: string, b: string): boolean {
  const [x, y] = [Number(a), Number(b)]
  if (a.trim() !== '' && b.trim() !== '' && Number.isFinite(x) && Number.isFinite(y)) return x > y
  return a.localeCompare(b, undefined, { numeric: true }) > 0
}

/** The template a reference belongs to in the vault: its id's template now, or the reference itself when none has it. */
export function revisedRef(ref: string, current: ReadonlyMap<string, string>): string {
  return current.get(templateId(ref)) ?? ref
}
