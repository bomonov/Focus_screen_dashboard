import { isMac } from '../../platform'
import type { MusicAdapter } from './adapter'
import { createMacAppleScriptAdapter } from './mac-applescript/adapter'

/** The real players this OS can show. Windows gets its SMTC adapter in M9; until then, none. */
export function createMusicAdapters(): MusicAdapter[] {
  return isMac ? [createMacAppleScriptAdapter()] : []
}
