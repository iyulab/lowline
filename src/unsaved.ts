// Unsaved edits are never dropped without asking: before a view opens something else, the app
// switches views, or the window closes, the person decides.

const dirty = new Set<string>()
let ask: () => Promise<boolean> = async () => true

/** A view reports whether it holds unsaved edits. */
export function markUnsaved(view: string, unsaved: boolean) {
  if (unsaved) dirty.add(view)
  else dirty.delete(view)
}

export function hasUnsaved(): boolean {
  return dirty.size > 0
}

/** How the app asks; set once by the app, which owns the dialog. */
export function setDiscardQuestion(question: () => Promise<boolean>) {
  ask = question
}

/** Whether it is all right to drop the unsaved edits — true at once when there are none. */
export async function confirmDiscard(): Promise<boolean> {
  if (!hasUnsaved()) return true
  const discard = await ask()
  if (discard) dirty.clear()
  return discard
}
