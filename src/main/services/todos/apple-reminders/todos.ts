import type { ProviderTodo } from '../provider'
import { TODO_SOURCE_NAMES } from '../types'
import type { HelperList, HelperReminder } from './protocol'

/** The list most people never rename; "Reminders · Reminders" would say nothing. */
const DEFAULT_LIST = 'reminders'

function context(list: HelperList | undefined, listCount: number): string {
  if (!list || listCount <= 1 || !list.title || list.title.toLowerCase() === DEFAULT_LIST) {
    return TODO_SOURCE_NAMES.reminders
  }
  return `Reminders · ${list.title}`
}

/**
 * The helper's reminders as to-dos, in a steady order: by list name, then oldest first (the
 * service sorts by due date; this only breaks ties). Reminders with no title are skipped,
 * as there's nothing to show for them.
 */
export function toProviderTodos(
  lists: readonly HelperList[],
  reminders: readonly HelperReminder[]
): ProviderTodo[] {
  const byId = new Map(lists.map((list) => [list.id, list]))
  const listTitle = (reminder: HelperReminder): string => byId.get(reminder.list)?.title ?? ''
  return reminders
    .filter((reminder) => reminder.title !== '')
    .sort(
      (a, b) =>
        listTitle(a).localeCompare(listTitle(b)) ||
        (a.createdAt ?? 0) - (b.createdAt ?? 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
    .map((reminder) => ({
      id: reminder.id,
      title: reminder.title,
      context: context(byId.get(reminder.list), lists.length),
      due: reminder.due,
      done: reminder.done,
      completedAt: reminder.done ? reminder.completedAt : null
    }))
}
