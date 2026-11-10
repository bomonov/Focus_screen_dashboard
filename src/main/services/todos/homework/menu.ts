import type { MenuItemConstructorOptions } from 'electron'
import type { HomeworkEntry } from '../types'

/** Long enough to tell homeworks apart, short enough for the glass menu's width. */
const MENU_TITLE_CHARS = 40

function shorten(title: string): string {
  return title.length > MENU_TITLE_CHARS ? `${title.slice(0, MENU_TITLE_CHARS - 1)}…` : title
}

/**
 * What a right-click on one of the user's own homeworks or exams adds on top of the quick
 * menu. A ticked homework is on its way out, so it can only be deleted (`edit` null).
 */
export function homeworkMenuItems(
  entry: HomeworkEntry,
  actions: { edit: (() => void) | null; remove(): void }
): MenuItemConstructorOptions[] {
  const name = shorten(entry.title)
  const { edit } = actions
  return [
    ...(edit ? [{ label: `Edit “${name}”…`, click: () => edit() }] : []),
    { label: `Delete “${name}”…`, click: () => actions.remove() },
    { type: 'separator' }
  ]
}
