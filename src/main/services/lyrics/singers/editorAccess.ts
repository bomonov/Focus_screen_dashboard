import { extname } from 'path'
import { PHOTO_EXTENSIONS } from '../../display/backgroundPhoto'
import type { LyricsState } from '../types'
import type { ColorEditorCommand } from './editorTypes'

/** A song is on with words to color: not an instrumental, not still being looked up. */
export function canColorCode(state: LyricsState): boolean {
  return (
    state.status === 'found' && (state.lyrics?.kind === 'synced' || state.lyrics?.kind === 'plain')
  )
}

/**
 * Whether main hands the editor's window's command on. A picture dropped on the window brings
 * a path, and the page picks which; so main only reads one while a session is open, and only
 * what the app takes as a picture, never another file the page could name.
 */
export function mayRunFromEditor(
  command: ColorEditorCommand,
  sessionOpen: boolean,
  extensions: readonly string[] = PHOTO_EXTENSIONS
): boolean {
  if (command.kind !== 'pictureFromPath') return true
  if (!sessionOpen) return false
  return extensions.includes(extname(command.path).slice(1).toLowerCase())
}
