import { dialog, shell, type BrowserWindow, type MessageBoxOptions } from 'electron'
import { readFile, stat } from 'fs/promises'
import type { GoogleCalendar } from '../../calendar/google'
import { parseClientFile, type GoogleClient } from './oauth'
import type { GoogleTasksProvider } from './provider'

/** Client files are about 400 bytes; anything this big is the wrong file. */
const MAX_CLIENT_FILE_BYTES = 64 * 1024
const CREDENTIALS_PAGE = 'https://console.cloud.google.com/apis/credentials'

const chooserOptions = {
  title: 'Choose your Google OAuth client file',
  buttonLabel: 'Use This File',
  properties: ['openFile' as const],
  filters: [{ name: 'Google OAuth client', extensions: ['json'] }]
}

async function showMessage(win: BrowserWindow | null, options: MessageBoxOptions): Promise<number> {
  const { response } = await (win
    ? dialog.showMessageBox(win, options)
    : dialog.showMessageBox(options))
  return response
}

/** Asks for the client JSON from Google Cloud Console. True once a valid one is saved. */
export async function chooseGoogleClientFile(
  google: { setClient(client: GoogleClient): void },
  win: BrowserWindow | null
): Promise<boolean> {
  const picked = await (win
    ? dialog.showOpenDialog(win, chooserOptions)
    : dialog.showOpenDialog(chooserOptions))
  const path = picked.filePaths[0]
  if (picked.canceled || !path) return false

  let text: string
  try {
    if ((await stat(path)).size > MAX_CLIENT_FILE_BYTES) throw new Error('too big')
    text = await readFile(path, 'utf8')
  } catch {
    text = ''
  }
  const parsed = parseClientFile(text)
  if (!parsed.ok) {
    await showMessage(win, {
      type: 'warning',
      message: 'That’s not the right file',
      detail: parsed.message,
      buttons: ['OK']
    })
    return false
  }
  google.setClient(parsed.client)
  return true
}

/**
 * Connect Google Tasks: the first time, explains the OAuth client and asks for its file;
 * then signs in through the browser and says what went wrong, if anything did.
 */
export async function connectGoogleTasks(
  google: GoogleTasksProvider,
  win: BrowserWindow | null
): Promise<void> {
  if (google.connection() !== 'disconnected') return
  if (!google.hasClient()) {
    const choice = await showMessage(win, {
      type: 'info',
      message: 'Connect Google Tasks',
      detail:
        'Focus Screen signs in to Google with your own OAuth client, so your tasks go straight ' +
        'from Google to this computer.\n\n' +
        'In Google Cloud Console, turn on the Google Tasks API, create an OAuth client of type ' +
        '“Desktop app”, and download its JSON file. Then choose that file here.',
      buttons: ['Choose Client File…', 'Open Google Cloud Console', 'Cancel'],
      defaultId: 0,
      cancelId: 2
    })
    if (choice === 1) {
      await shell.openExternal(CREDENTIALS_PAGE).catch(() => {})
      return
    }
    if (choice !== 0 || !(await chooseGoogleClientFile(google, win))) return
  }

  const result = await google.connect()
  if (result.kind !== 'failed') return
  await showMessage(win, {
    type: 'warning',
    message: 'Google Tasks isn’t connected',
    detail: result.message,
    buttons: ['OK']
  })
}

export async function confirmGoogleDisconnect(
  google: GoogleTasksProvider,
  win: BrowserWindow | null
): Promise<void> {
  const choice = await showMessage(win, {
    type: 'question',
    message: 'Disconnect Google Tasks?',
    detail:
      'Your tasks stay in Google. Focus Screen forgets its sign-in and asks Google to revoke it.',
    buttons: ['Disconnect', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  })
  if (choice === 0) await google.disconnect()
}

/**
 * Connect Google Calendar, for Next class: read-only, signed in apart from Google Tasks but
 * with the same OAuth client (asked for the first time, as for Tasks).
 */
export async function connectGoogleCalendar(
  calendar: GoogleCalendar,
  win: BrowserWindow | null
): Promise<void> {
  if (calendar.state() !== 'disconnected') return
  if (!calendar.hasClient()) {
    const choice = await showMessage(win, {
      type: 'info',
      message: 'Connect Google Calendar',
      detail:
        'Focus Screen signs in to Google with your own OAuth client, so your calendars go ' +
        'straight from Google to this computer. It can only read them.\n\n' +
        'In Google Cloud Console, turn on the Google Calendar API, create an OAuth client of ' +
        'type “Desktop app”, and download its JSON file. Then choose that file here.',
      buttons: ['Choose Client File…', 'Open Google Cloud Console', 'Cancel'],
      defaultId: 0,
      cancelId: 2
    })
    if (choice === 1) {
      await shell.openExternal(CREDENTIALS_PAGE).catch(() => {})
      return
    }
    if (choice !== 0 || !(await chooseGoogleClientFile(calendar, win))) return
  }

  const result = await calendar.connect()
  if (result.kind !== 'failed') return
  await showMessage(win, {
    type: 'warning',
    message: 'Google Calendar isn’t connected',
    detail: result.message,
    buttons: ['OK']
  })
}

export async function confirmGoogleCalendarDisconnect(
  calendar: GoogleCalendar,
  win: BrowserWindow | null
): Promise<void> {
  const choice = await showMessage(win, {
    type: 'question',
    message: 'Disconnect Google Calendar?',
    detail:
      'Your calendars stay in Google. Focus Screen forgets its sign-in and asks Google to revoke it.',
    buttons: ['Disconnect', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  })
  if (choice === 0) await calendar.disconnect()
}
