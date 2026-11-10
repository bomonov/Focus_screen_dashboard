// What the Color-Code Lyrics window is shown, and what it may ask the main process for.
// Keep this file free of runtime imports: the renderer compiles it too (through ipc.ts).
import type { ColorEdit, SongColors } from './types'

/** "Time by listening": what main has heard of the editor's song, and how its last run went. */
export interface ListenState {
  /** False when auto-sync's add-on isn't installed on this Mac. */
  installed: boolean
  /** Song-time stretches heard since the window opened, in order. */
  heard: [number, number][]
  /** The lines being timed now (places in `lines`); empty while none are. */
  timing: number[]
  /** Plain words about the last run when it didn't all work. */
  note: string | null
  /** The lines the note is about (places in `lines`): the page shows it while one is selected. */
  noteLines: number[]
  /**
   * The song's timing fix as the Focus Screen applies it (lit at position + fixSec), for the
   * page's `listenStretch` even while another song plays and `useLyrics` has that one's fix.
   */
  fixSec: number
}

export interface ColorEditorState {
  open: boolean
  song: { key: string; title: string; artist: string; durationSec: number } | null
  /** False when the player has moved to another song: timing and recording wait. */
  playingThis: boolean
  /** Another song is on and has lyrics, so "Switch to the song playing now" can show. */
  canSwitch: boolean
  colors: SongColors | null
  /**
   * The lyrics' own lines (not the ones the user added), for marking "changed" lines (coded text
   * not among them).
   */
  shownLines: string[]
  /** The rows the Focus Screen shows, added ones too: the lines `romaji` lines up with. [] when closed. */
  romajiLines: string[]
  romaji: string[] | null
  canUndo: boolean
  canRedo: boolean
  /** base64 peaks; null when there's no waveform (no helper, no access, Windows). */
  waveform: string | null
  /** Plain words when there's none, e.g. "Recording isn't allowed…". */
  waveformNote: string | null
  canSeek: boolean
  /** Singer pictures as data URLs, by id. */
  pictures: Record<string, string>
  /** Plain words about the last thing asked, e.g. a picture that was refused; the next command clears it. */
  notice: string | null
  /** "Time by listening"; null where it isn't offered (no tap, recording not allowed, Windows). */
  listen: ListenState | null
}

export type ColorEditorCommand =
  /** The renderer's starting coding, parsed in main. */
  | { kind: 'begin'; colors: unknown }
  | { kind: 'edit'; edit: ColorEdit }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'playLine'; line: number }
  /** Plays a line with the line before it as a lead-in (a verse just added is heard in place). */
  | { kind: 'replayLine'; line: number }
  /** `whole` (Tap: Lines, a press only): the tap moves the whole line, not just the word. */
  | { kind: 'tap'; phase: 'down' | 'up'; line: number; word: number; whole?: true }
  /** Times a run of places in `lines` (`to` exclusive) by listening, timed ones too. */
  | { kind: 'listen'; from: number; to: number }
  /**
   * The selection has moved off the lines a note was about, once it had shown: it goes, unless
   * it's another note by now (`note` is the words the page showed).
   */
  | { kind: 'clearNote'; note: string }
  | { kind: 'switchToPlaying' }
  | { kind: 'removeAll' }
  | { kind: 'choosePicture'; singer: string }
  | { kind: 'pictureFromPath'; singer: string; path: string }
  | { kind: 'removePicture'; singer: string }
