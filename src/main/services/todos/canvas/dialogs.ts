import { dialog, type BrowserWindow, type MessageBoxOptions } from 'electron'
import type { CanvasProvider } from './provider'

export async function confirmCanvasDisconnect(
  canvas: CanvasProvider,
  win: BrowserWindow | null
): Promise<void> {
  const options: MessageBoxOptions = {
    type: 'question',
    message: 'Disconnect Canvas?',
    detail:
      'Your work stays in Canvas. Focus Screen forgets its access token (or calendar feed ' +
      'link) on this computer.\n\nTo cancel the token itself, delete it in Canvas under ' +
      'Account → Settings.',
    buttons: ['Disconnect', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  }
  const { response } = await (win
    ? dialog.showMessageBox(win, options)
    : dialog.showMessageBox(options))
  if (response === 0) canvas.disconnect()
}
