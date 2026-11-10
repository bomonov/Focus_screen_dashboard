import type { LyricsPickerState, PickerRow } from '../../../main/services/lyrics/pickerTypes'
import { formatSongTime } from './musicView'

/** The longest search main takes; the field stops there too. */
export const SEARCH_MAX = 200

export const LISTEN_HINT = 'Turn on Auto-sync plain lyrics in Customize › Music'

/** A version's length, "4:11". LRCLIB's are fractional: rounded, so 250.6 s reads as the song's 4:11. */
export function formatLength(sec: number): string {
  return Number.isFinite(sec) && sec > 0 ? formatSongTime(Math.round(sec)) : ''
}

export function lengthNote(songSec: number): string {
  const length = formatLength(songSec)
  return length ? `your song is ${length}` : ''
}

export function pickerHeading(song: LyricsPickerState['song']): string {
  if (!song) return 'Other lyrics'
  return [`Lyrics for ${song.title}`, lengthNote(song.durationSec)].filter(Boolean).join(' · ')
}

/**
 * The row's second line, "アイロニ · SEKAI ALBUM vol.2 · synced", in two parts: a long album
 * gets cut short, never whether the version is timed.
 */
export function rowDetail(row: PickerRow): { names: string; kind: PickerRow['kind'] } {
  return { names: [row.title.trim(), row.album.trim()].filter(Boolean).join(' · '), kind: row.kind }
}

/** A version that reads as long as the song, lit like the mockup's 4:11. */
export function sameLength(rowSec: number, songSec: number): boolean {
  const row = formatLength(rowSec)
  return row !== '' && row === formatLength(songSec)
}

export interface FootAction {
  kind: 'automatic' | 'listen' | 'search' | 'none'
  label: string
  /** Shown but can't be used yet; `hint` says how to make it work. */
  disabled?: boolean
  hint?: string
  /** The choice in force for this song. */
  current?: boolean
}

/** The bottom row's buttons, in the mockup's order. */
export function footActions(
  picked: LyricsPickerState['picked'],
  listen: LyricsPickerState['listen']
): FootAction[] {
  const actions: FootAction[] = []
  if (picked !== 'automatic') actions.push({ kind: 'automatic', label: 'Back to automatic' })
  if (listen !== 'unsupported') {
    actions.push({
      kind: 'listen',
      label: 'Time them by listening',
      current: picked === 'listen',
      ...(listen === 'off' ? { disabled: true, hint: LISTEN_HINT } : {})
    })
  }
  actions.push({ kind: 'search', label: 'Search with other words…' })
  actions.push({ kind: 'none', label: 'No lyrics for this song', current: picked === 'none' })
  return actions
}

/** The one line under the heading: busy beats an older message, and an empty list says so. */
export function statusLine(state: LyricsPickerState): string | null {
  if (state.busy) return 'Looking…'
  if (state.message) return state.message
  return state.rows.length === 0 ? 'LRCLIB has no versions to list' : null
}

/** What's typed, ready to send: trimmed and capped like main's parse, or null when blank. */
export function searchText(raw: string): string | null {
  const text = raw.trim().slice(0, SEARCH_MAX)
  return text === '' ? null : text
}
