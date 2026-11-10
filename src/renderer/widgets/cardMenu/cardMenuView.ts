import type { CardMenuEntry } from '../../../main/ipc'

/**
 * What a submenu shows beside its name, like iOS: the pick, when it's a list of choices (every
 * row a checkmark item, exactly one checked). A submenu of settings (the right-click menu's
 * Timer) shows nothing, rather than whichever of its switches happens to be on first.
 */
export function chosenLabel(entries: readonly CardMenuEntry[]): string | null {
  const rows = entries.filter((entry) => entry.kind !== 'separator')
  const choices = rows.every((entry) => entry.kind === 'item' && entry.checked !== null)
  const checked = rows.filter((entry) => entry.kind === 'item' && entry.checked)
  const only = checked.length === 1 ? checked[0] : undefined
  return choices && only?.kind === 'item' ? only.label : null
}

/**
 * Submenus open as a path: `expanded` is the deepest open one's id, and the ones it's inside are
 * open with it (ids nest as "3", "3.0", "3.0.2"; see `cardMenuEntries`). The right-click menu's
 * Timer › Style is two deep.
 */
export function isSubOpen(id: string, expanded: string | null): boolean {
  return expanded !== null && (expanded === id || expanded.startsWith(`${id}.`))
}

/** The submenu this one is inside ("3" for "3.0"), or null at the top. */
export function parentSub(id: string): string | null {
  const dot = id.lastIndexOf('.')
  return dot < 0 ? null : id.slice(0, dot)
}

/** Opening a submenu folds any other open one beside it; closing one leaves its parents open. */
export function toggleSub(id: string, expanded: string | null): string | null {
  return isSubOpen(id, expanded) ? parentSub(id) : id
}
