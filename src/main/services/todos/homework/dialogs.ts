import { dialog, type BrowserWindow, type MessageBoxOptions } from 'electron'
import type { HomeworkEntry } from '../types'

/** Deleting can't be taken back (it's gone from the disk), so it asks; Cancel is the default. */
export async function confirmHomeworkDelete(
  win: BrowserWindow | null,
  entry: HomeworkEntry
): Promise<boolean> {
  const options: MessageBoxOptions = {
    type: 'question',
    message: `Delete “${entry.title}”?`,
    detail:
      entry.kind === 'exam'
        ? 'Its countdown goes from the To-do card.'
        : 'It goes from the To-do card for good.',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1
  }
  const { response } = await (win
    ? dialog.showMessageBox(win, options)
    : dialog.showMessageBox(options))
  return response === 0
}
