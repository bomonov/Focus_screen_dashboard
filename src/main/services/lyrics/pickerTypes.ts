// The lyrics version picker's state and commands, shared with the renderer.
// Keep this file free of imports: the renderer compiles it too.

/** What a row says about a version, besides its own credits. */
export type PickerTag = 'same singers' | 'the original' | 'showing now'

/** One LRCLIB version of the song, as the list shows it. */
export interface PickerRow {
  /** LRCLIB's record id: what a pick sends back. */
  id: number
  title: string
  artist: string
  album: string
  durationSec: number
  kind: 'synced' | 'plain' | 'instrumental'
  tags: PickerTag[]
}

export interface LyricsPickerState {
  open: boolean
  busy: 'loading' | 'searching' | null
  /** The song the list is for; a pick never lands on another. */
  song: { title: string; artist: string; durationSec: number } | null
  /** Best guess first. */
  rows: PickerRow[]
  /** How this song's lyrics are chosen now. */
  picked: 'automatic' | 'version' | 'listen' | 'none'
  /** Auto-sync: installed and on, installed but off, or not on this platform. */
  listen: 'ready' | 'off' | 'unsupported'
  /** One line, such as LRCLIB being out of reach. */
  message: string | null
}

export type LyricsPickerCommand =
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'pick'; id: number }
  | { kind: 'listen' }
  | { kind: 'none' }
  | { kind: 'automatic' }
  | { kind: 'search'; text: string }
