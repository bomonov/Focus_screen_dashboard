import type { BrowserWindow } from 'electron'
import type { AlignerClient } from '../../autosync/aligner'
import { SILENT_RESTART_MS } from '../../autosync/capture'
import { playerBundles } from '../../autosync/players'
import { createSongRecording, SAMPLE_RATE } from '../../autosync/recording'
import { canSeek, positionAt, type MusicCommand, type PlaybackState } from '../../music/types'
import type { OffsetStore } from '../offsets'
import { nearSongKeys, type LyricsQuery } from '../query'
import { ownLyricsOf, type LyricsState } from '../types'
import { matchLines } from './apply'
import { castSinger } from './cast'
import { applyEdit, createEditHistory, type EditHistory } from './edit'
import { parseColorEditorCommand } from './editorCommand'
import type { OpenSingerTap, SingerPictures, SingerTap } from './editorDeps'
import type { ColorEditorCommand, ColorEditorState, ListenState } from './editorTypes'
import { createHeardAudio } from './heardAudio'
import { listenStretch, timeSignature, type OwnLyrics } from './listen'
import { createListenRunner, type ListenRunner } from './listenRunner'
import {
  createListenSession,
  samePlaces,
  sameTimes,
  type Listening,
  type Stretch
} from './listenSession'
import { parseSongColors } from './parse'
import { createPlayLine, replaySpan } from './playLine'
import type { SongColorsStore } from './store'
import { createTapQueue } from './tapQueue'
import type { ColorEdit, SongColors } from './types'
import { addPeaks, emptyPeaks, PEAK_SEC, peaksFit } from './waveform'

// The Color-Code Lyrics window's session: the song it's on, its coding and undo history, the
// waveform filling in from the player's audio, Play line and tap timing. It stays on its own
// song when the music moves on; timing and recording wait until that song plays again.

/** Edits are written once they've settled this long. */
export const SAVE_DELAY_MS = 500
/** The waveform's outline is written this often while it fills in, and on close. */
export const WAVEFORM_SAVE_SEC = 5
/** Queued audio is placed, and the windows told, this often: at most twice a second. */
const TICK_MS = 500
/** A J held longer than this marks the word's end; a quicker press is only its start. */
export const TAP_HOLD_SEC = 0.15
/** A saved outline this many buckets off (a second) is the same song a second longer or shorter. */
const WAVEFORM_SLACK = Math.round(1 / PEAK_SEC)

export const NOT_ALLOWED_NOTE =
  "Recording isn't allowed, so there's no waveform. Allow Focus Screen Audio in System Settings › Privacy & Security › Screen & System Audio Recording."
const NO_TAP_NOTE = "There's no waveform on this computer."
export const SAVE_FAILED_NOTE = "Couldn't save the colors. Is the disk full?"
export const REMOVE_FAILED_NOTE = "Couldn't remove the colors. Try again in a moment."
// "Time by listening"'s words live with it (the page can show them too).
export { CRAMPED_NOTE, missedNote, NOT_HEARD_NOTE, TIMING_FAILED_NOTE } from './listen'

export interface ColorEditorOptions {
  store: SongColorsStore
  music: {
    get(): PlaybackState
    subscribe(listener: (state: PlaybackState) => void): () => void
    command(command: MusicCommand): void
  }
  lyrics: {
    get(): LyricsState
    subscribe(listener: (state: LyricsState) => void): () => void
    currentSong(): { key: string; trackId: string; query: LyricsQuery } | null
    /** Only ever `resetOffset`: the song on screen drops its timing fix, and shows it at once. */
    command(command: { kind: 'resetOffset' }): void
    /** The coding the lyrics laid over the song on screen (the demo brings its own); null for none. */
    currentCoding(): SongColors | null
  }
  offsets: Pick<OffsetStore, 'get' | 'set'>
  /** Opened with the editor and disposed with it; null (or a null tap) means no waveform. */
  openTap: OpenSingerTap | null
  /** What the waveform's place says when there's no tap at all (Windows, or no helper). */
  noTapNote?: string
  pictures: SingerPictures | null
  /**
   * "Time by listening": the auto-sync add-on's aligner (null when it isn't installed) and a
   * temporary folder of the editor's own for the runs' WAVs. Used only with a tap; none, none.
   */
  listen?: { aligner: (() => AlignerClient) | null; tempDir: string }
  /** The editor's window, for the picture chooser to sit on. */
  window?: () => BrowserWindow | null
  /** Epoch seconds. */
  now?: () => number
}

export interface ColorEditor {
  state(): ColorEditorState
  subscribe(listener: (state: ColorEditorState) => void): () => void
  /** Opens on the song on screen, if it has lyrics; already open, it moves to that song. */
  open(): void
  /** Saves what's waiting and lets go of the song and the tap. */
  close(): void
  command(command: ColorEditorCommand): void
  dispose(): void
}

interface OnScreen {
  key: string
  trackId: string
  query: LyricsQuery
}

interface Shown {
  /** The lyrics' own lines. */
  lines: string[]
  /** The rows shown, the user's added lines too: what `romaji` lines up with. */
  rows: string[]
  romaji: string[] | null
  /** The lyrics' own lines with their times (R14): where a line shows for real. */
  own: OwnLyrics
}

/** The listening fields (`Listening`): the heard audio, lines waiting, the run's lines and words. */
interface Session extends Listening {
  song: { key: string; title: string; artist: string; durationSec: number }
  /** Null until the song has a coding: saved, or the renderer's `begin`. */
  history: EditHistory | null
  /**
   * What needs no writing: what's on disk, or what the song came with (the demo's own coding,
   * or the renderer's untouched start). The history hands back this same object when an undo
   * returns to it.
   */
  saved: SongColors | null
  /** Some time moved since the last save, so the save clears the song's timing fix. */
  timesChanged: boolean
  shown: Shown
  peaks: Uint8Array
  /** Bumped by every change to `peaks`. */
  peaksVersion: number
  peaksSavedVersion: number
  peaksSavedAt: number
}

function closedState(): ColorEditorState {
  return {
    open: false,
    song: null,
    playingThis: false,
    canSwitch: false,
    colors: null,
    shownLines: [],
    romajiLines: [],
    romaji: null,
    canUndo: false,
    canRedo: false,
    waveform: null,
    waveformNote: null,
    canSeek: false,
    pictures: {},
    notice: null,
    listen: null
  }
}

/**
 * Whether going from `before` to `after` moved a time. Each step is one edit (or its undo), and
 * the edits that add or split words never move one that was there, so only a step that keeps
 * every line and word in place can be a timing one. Times on lines guessed before and after
 * don't count (a guess isn't timing), and neither does a reorder: every time a line that
 * isn't a guess has after, it already had before.
 */
function timesMoved(before: SongColors, after: SongColors): boolean {
  if (before.lines.length !== after.lines.length) return false
  const known = new Map<string, number>()
  for (const line of before.lines) {
    if (line.guessed) continue
    const sig = timeSignature(line)
    known.set(sig, (known.get(sig) ?? 0) + 1)
  }
  const unseen = after.lines.some((line) => {
    if (line.guessed) return false
    const sig = timeSignature(line)
    const left = known.get(sig) ?? 0
    known.set(sig, left - 1)
    return left <= 0
  })
  if (!unseen) return false
  // A reorder is never a timing edit, and the lines' places mean nothing once it's done.
  const order = (colors: SongColors): string =>
    JSON.stringify(colors.lines.map((line) => [line.text, line.under, line.added === true]))
  if (order(before) !== order(after)) return false
  return before.lines.some((line, i) => {
    const other = after.lines[i]
    if (!other || other.words.length !== line.words.length) return false
    if (line.guessed && other.guessed) return false
    if (other.start !== line.start || other.end !== line.end) return true
    return line.words.some(
      (word, j) => word.start !== other.words[j]?.start || word.end !== other.words[j]?.end
    )
  })
}

function sameList(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b
  return a.length === b.length && a.every((item, i) => item === b[i])
}

/** Saved for the same song a second longer or shorter: padded or cut to fit; further off, not used. */
function fittedPeaks(saved: Uint8Array | null, durationSec: number): Uint8Array {
  const peaks = emptyPeaks(durationSec)
  if (!saved || Math.abs(saved.length - peaks.length) > WAVEFORM_SLACK) return peaks
  peaks.set(saved.subarray(0, peaks.length))
  return peaksFit(peaks, durationSec) ? peaks : emptyPeaks(durationSec)
}

function toBase64(peaks: Uint8Array): string {
  return Buffer.from(peaks.buffer, peaks.byteOffset, peaks.byteLength).toString('base64')
}

export function createColorEditor(options: ColorEditorOptions): ColorEditor {
  const { store, music, lyrics, offsets, pictures } = options
  const now = options.now ?? ((): number => Date.now() / 1000)
  const listeners = new Set<(state: ColorEditorState) => void>()

  let session: Session | null = null
  let tap: SingerTap | null = null
  /** "Time by listening"'s runs; made with the tap as the window opens, disposed as it closes. */
  let runner: ListenRunner | null = null
  let stopHearing: (() => void) | null = null
  /** The apps the tap listens to now, joined; null while it's stopped. */
  let tapFor: string | null = null
  let starting = false
  let tapFailedAt = Number.NEGATIVE_INFINITY
  let lastAudioAt = 0
  let ticker: ReturnType<typeof setInterval> | undefined
  const heard = createHeardAudio(now)
  let previous = music.get()
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const lineWatch = createPlayLine({ music, playingThis, now })
  let pendingDown: { line: number; word: number; at: number } | null = null
  /** J taps waiting for the outline round them, so they land on the sound they were meant for. */
  const taps = createTapQueue()
  let notice: string | null = null
  let shownPictures: Record<string, string> = {}
  let pushedFlags = ''
  let pushedPeaks = -1
  let base64: { peaks: Uint8Array; version: number; text: string } | null = null

  /** The song the lyrics have on screen, when it's the one the player has on now. */
  function onScreen(): OnScreen | null {
    const song = lyrics.currentSong()
    const track = music.get().track
    return song && track && song.trackId === track.id ? song : null
  }

  /** The lyrics shown for `song`, when it has words to color. */
  function shownFor(song: OnScreen): Shown | null {
    const state = lyrics.get()
    if (state.trackId !== song.trackId || state.status !== 'found' || !state.lyrics) return null
    const found = state.lyrics
    if (found.kind === 'instrumental') return null
    const textsOf = (of: typeof found): string[] =>
      of.kind === 'synced' ? of.lines.map((line) => line.text) : [...of.lines]
    // The user's added lines are among the rows shown; the editor keeps to the lyrics' own.
    const rows = textsOf(found)
    const own = ownLyricsOf(state)
    if (!own || own.kind === 'instrumental') return null
    const lines = textsOf(own)
    if (!lines.some((line) => line.trim() !== '')) return null
    return { lines, rows, romaji: state.romaji ? [...state.romaji] : null, own }
  }

  /** The player has the editor's song on (a second longer or shorter is the same song). */
  function playingThis(): boolean {
    if (!session) return false
    const song = onScreen()
    return song !== null && nearSongKeys(session.song.key).includes(song.key)
  }

  // --- what the window sees ----------------------------------------------------------------

  function waveform(open: Session): string | null {
    if (!tap || tap.access() === 'denied' || open.peaks.length === 0) return null
    if (base64?.peaks !== open.peaks || base64.version !== open.peaksVersion) {
      base64 = { peaks: open.peaks, version: open.peaksVersion, text: toBase64(open.peaks) }
    }
    return base64.text
  }

  function waveformNote(): string | null {
    if (!tap) return options.noTapNote ?? NO_TAP_NOTE
    return tap.access() === 'denied' ? NOT_ALLOWED_NOTE : null
  }

  /** The fix the Focus Screen applies to the session's song: the shown one while it's on screen. */
  function fixFor(open: Session): number {
    const song = lyrics.currentSong()
    return song && nearSongKeys(open.song.key).includes(song.key)
      ? lyrics.get().offsetSec
      : offsets.get(open.song.key)
  }

  function listenState(open: Session): ListenState | null {
    if (!tap || tap.access() === 'denied') return null
    return {
      installed: runner?.installed ?? false,
      heard: open.recording?.heardSpans() ?? [],
      timing: [...open.timing],
      note: open.note,
      noteLines: [...open.noteLines],
      fixSec: fixFor(open)
    }
  }

  function build(): ColorEditorState {
    if (!session) return closedState()
    const here = playingThis()
    const other = here ? null : onScreen()
    return {
      open: true,
      song: { ...session.song },
      playingThis: here,
      canSwitch: other !== null && shownFor(other) !== null,
      colors: session.history?.now() ?? null,
      shownLines: session.shown.lines,
      romajiLines: session.shown.rows,
      romaji: session.shown.romaji,
      canUndo: session.history?.canUndo() ?? false,
      canRedo: session.history?.canRedo() ?? false,
      waveform: waveform(session),
      waveformNote: waveformNote(),
      canSeek: canSeek(music.get().track),
      pictures: shownPictures,
      notice,
      listen: listenState(session)
    }
  }

  /**
   * What can change without an edit: the player, the tap, a notice coming or going, and what
   * "Time by listening" has heard, is timing and says (with the fix it works it out under).
   */
  function flagsOf(state: ColorEditorState): string {
    return JSON.stringify([
      state.open,
      state.playingThis,
      state.canSwitch,
      state.canSeek,
      state.waveform === null,
      state.waveformNote,
      state.notice,
      state.listen
    ])
  }

  function notify(): void {
    const state = build()
    pushedFlags = flagsOf(state)
    pushedPeaks = session?.peaksVersion ?? -1
    for (const listener of [...listeners]) listener(state)
  }

  function notifyIfChanged(): void {
    if (flagsOf(build()) !== pushedFlags) notify()
  }

  // --- saving --------------------------------------------------------------------------------

  /** Through the lyrics service while the song is on screen, so its fix goes from the screen too. */
  function clearOffset(key: string): void {
    const song = lyrics.currentSong()
    if (song && nearSongKeys(key).includes(song.key)) {
      if (lyrics.get().offsetSec !== 0 || offsets.get(key) !== 0) {
        lyrics.command({ kind: 'resetOffset' })
      }
    } else {
      offsets.set(key, 0)
    }
  }

  function hasOffset(key: string): boolean {
    const song = lyrics.currentSong()
    const shownFix = song && nearSongKeys(key).includes(song.key) ? lyrics.get().offsetSec : 0
    return offsets.get(key) !== 0 || shownFix !== 0
  }

  function save(): void {
    clearTimeout(saveTimer)
    saveTimer = undefined
    if (!session?.history) return
    const colors = session.history.now()
    if (colors === session.saved) {
      session.timesChanged = false
      return
    }
    // The user's own times replace the fix; cleared first, so the screen never shows both.
    if (session.timesChanged) clearOffset(session.song.key)
    // Not saved stays not saved, times and all: the next change, or closing, tries again.
    if (!store.write(session.song.key, colors)) {
      notice = SAVE_FAILED_NOTE
      notify()
      return
    }
    session.timesChanged = false
    session.saved = colors
  }

  function saveWaveform(open: Session): void {
    open.peaksSavedAt = now()
    if (open.peaksVersion === open.peaksSavedVersion) return
    open.peaksSavedVersion = open.peaksVersion
    store.writeWaveform(open.song.key, open.peaks)
  }

  /** One step of the history: saved once things settle, and shown at once. */
  function stepped(before: SongColors, after: SongColors | null): void {
    if (!session || !after || after === before) return
    if (timesMoved(before, after)) session.timesChanged = true
    // The lines just added, and those a note names, aren't at those places any more.
    if (!samePlaces(before, after)) listening.placesChanged(session)
    clearTimeout(saveTimer)
    saveTimer = setTimeout(save, SAVE_DELAY_MS)
    notify()
  }

  // --- the tap and the waveform ----------------------------------------------------------

  function listen(target: SingerTap, bundles: string[], want: string): void {
    starting = true
    target.start(bundles).then(
      (result) => {
        // Closed (or reopened with another tap) while it started.
        if (target !== tap) return
        starting = false
        tapFor = result.ok ? want : null
        if (!result.ok) tapFailedAt = now()
        // Counted from now, so a player that isn't making sound yet is listened to again later.
        lastAudioAt = now()
        syncTap()
        notifyIfChanged()
      },
      () => {
        if (target !== tap) return
        starting = false
        tapFailedAt = now()
      }
    )
  }

  /** The tap listens to the player only while it has the editor's song on. */
  function syncTap(): void {
    if (!tap || starting) return
    const playback = music.get()
    const bundles =
      playingThis() && playback.player && tap.access() !== 'denied'
        ? playerBundles(playback.player.id)
        : []
    const want = bundles.length > 0 ? bundles.join('\n') : null
    if (want === tapFor) return
    if (want === null) {
      tapFor = null
      tap.stop()
      return
    }
    // A tap that just failed (the player not making sound yet) is tried again in a while.
    if (now() - tapFailedAt < SILENT_RESTART_MS / 1000) return
    listen(tap, bundles, want)
  }

  function hear(at: number, samples: Int16Array): void {
    lastAudioAt = now()
    if (!session || session.peaks.length === 0) return
    if (!music.get().playing || !playingThis()) return
    heard.hear(at, samples)
  }

  function tick(): void {
    const playback = music.get()
    heard.place(playback, playback.playing && playingThis(), (songTimeSec, samples) => {
      if (!session) return
      if (addPeaks(session.peaks, songTimeSec, samples, SAMPLE_RATE, 1)) session.peaksVersion++
      session.recording?.write(songTimeSec, samples)
    })
    // Right after placing, so a tap whose outline just came in snaps to it: the silence check
    // below may stop the tap, and then waiting taps land as pressed.
    landTaps(false)
    // After the taps, so a tap on the next line's start ends the added lines' stretch there.
    if (session) listening.whenHeard(session)
    if (session && now() - session.peaksSavedAt >= WAVEFORM_SAVE_SEC) saveWaveform(session)
    const silent = now() - lastAudioAt > SILENT_RESTART_MS / 1000
    if (tapFor !== null && !starting && playback.playing && playingThis() && silent) {
      // The player's audio may have moved to another process: listen again.
      tapFor = null
    }
    syncTap()
    if (session && session.peaksVersion !== pushedPeaks) notify()
    else notifyIfChanged()
  }

  // --- tap timing --------------------------------------------------------------------------

  /**
   * Lands the taps that are ready, each its own step; with `force`, all of them now. They wait
   * for the outline only while the tap is hearing the editor's song: otherwise none is coming.
   */
  function landTaps(force: boolean): void {
    if (taps.size === 0) return
    const history = session?.history
    if (!session || !history) {
      taps.clear()
      return
    }
    const hearing =
      tapFor !== null && music.get().playing && playingThis() && session.peaks.length > 0
    taps.flush(
      hearing ? session.peaks : null,
      now(),
      (edit) => {
        const before = history.now()
        stepped(before, history.apply(edit))
      },
      force
    )
  }

  const WHOLE = { whole: true } as const

  /** `whole`: Tap: Lines, where the press moves the whole line and letting go marks nothing. */
  function tapWord(phase: 'down' | 'up', line: number, word: number, whole = false): void {
    const history = session?.history
    const playback = music.get()
    if (!history || !playback.playing || !playingThis()) {
      pendingDown = null
      return
    }
    const at = now()
    const position = positionAt(playback, at)
    const duration = session?.song.durationSec ?? 0
    const songEnd = duration > 0 ? { songEnd: duration } : {}
    if (phase === 'down') {
      pendingDown = whole ? null : { line, word, at }
      taps.push(
        { kind: 'tapTime', line, word, start: position, ...songEnd, ...(whole && WHOLE) },
        at
      )
    } else {
      const down = pendingDown
      pendingDown = null
      if (!down || down.line !== line || down.word !== word || at - down.at <= TAP_HOLD_SEC) return
      taps.push({ kind: 'tapTime', line, word, end: position, ...songEnd }, at)
    }
    // Where the outline round it is already in (heard before), or there's none, it lands now.
    landTaps(false)
  }

  // --- time by listening ---------------------------------------------------------------------

  function stretchOf(open: Session, colors: SongColors, lines: readonly number[]): Stretch | null {
    return listenStretch(colors, lines, open.song.durationSec, open.shown.own, fixFor(open))
  }

  const listening = createListenSession<Session>({
    current: () => session,
    runner: () => runner,
    stretchOf,
    stepped,
    notify
  })

  // --- the song ------------------------------------------------------------------------------

  function load(song: OnScreen, shown: Shown): void {
    const durationSec = song.query.durationSec
    // A coding the lyrics brought (the demo's) is edited like a saved one, and saved once edited.
    const saved = store.read(song.key) ?? lyrics.currentCoding()
    session = {
      song: { key: song.key, title: song.query.title, artist: song.query.artist, durationSec },
      history: saved ? createEditHistory(saved) : null,
      saved,
      timesChanged: false,
      shown,
      peaks: fittedPeaks(store.readWaveform(song.key), durationSec),
      peaksVersion: 0,
      peaksSavedVersion: 0,
      peaksSavedAt: now(),
      // The song's audio is kept only where "Time by listening" can use it (the add-on installed).
      recording: runner?.installed ? createSongRecording(durationSec) : null,
      pending: null,
      timing: [],
      note: null,
      noteLines: []
    }
  }

  /** Saves what's waiting and lets go of the song (the tap stays for the next one). */
  function leave(): void {
    if (!session) return
    landTaps(true)
    save()
    saveWaveform(session)
    lineWatch.stop()
    pendingDown = null
    heard.clear()
    base64 = null
    session = null
  }

  /**
   * The renderer's starting coding, made from the lyrics it shows: taken only while the editor's
   * song is the one on, and only when its lines are that song's (a start made just as the music
   * moved on would be another song's words).
   */
  function begin(open: Session, raw: unknown): void {
    if (open.history || !playingThis()) return
    const colors = parseSongColors(raw, (id) => castSinger(id) !== undefined)
    if (!colors) return
    const shown = new Set(open.shown.lines)
    const mainLines = colors.lines.filter((line) => line.under === undefined)
    if (mainLines.some((line) => line.text.trim() !== '' && !shown.has(line.text))) return
    open.history = createEditHistory(colors)
    // Nothing to write until it's edited...
    open.saved = colors
    const { key } = open.song
    // ...except that its timed lines are in the song's true times, so the timing fix goes now.
    // Saved at once when there was one: the Focus Screen then draws those times, not the
    // lyrics' own without their fix. Lines nobody timed (plain or auto-synced lyrics) show at
    // the lyrics' own times, which still need their fix.
    if (colors.lines.some((line) => line.timed) && hasOffset(key)) {
      clearOffset(key)
      if (!store.write(key, colors)) {
        // Unsaved, so the next save (an edit, or closing) writes it.
        open.saved = null
        notice = SAVE_FAILED_NOTE
      }
    }
    notify()
  }

  /** How many of the shown lines a coding colors. */
  function matched(lines: readonly string[], colors: SongColors): number {
    return matchLines(lines, colors.lines).filter((match) => match !== undefined).length
  }

  /**
   * Whether an edit that brings in lines may be made. Added lines (`addLines`) need the editor's
   * song to be the one on, playing or paused: its position is known either way. Like `begin`: only while
   * the editor's song is on (the lines must be this song's), only with a line the lyrics show
   * now, word for word, and an added line only where it lines up with the rest in the song's
   * order, so it's colored where it's sung. A line put back on the lyrics' time (`resetTimes`)
   * takes that time from the lyrics on screen, so it too waits for the song to be on. Heard
   * times come only from a timing run in main, never from the page.
   */
  function editAllowed(open: Session, colors: SongColors, edit: ColorEdit): boolean {
    if (edit.kind === 'heardTimes') return false
    if (edit.kind === 'addLines' || edit.kind === 'addBreak') return playingThis()
    if (edit.kind !== 'newWords' && edit.kind !== 'addLine' && edit.kind !== 'resetTimes') {
      return true
    }
    const text: unknown = edit.shown?.text
    if (!playingThis() || typeof text !== 'string' || !open.shown.lines.includes(text)) return false
    if (edit.kind === 'newWords' || edit.kind === 'resetTimes') return true
    const after = applyEdit(colors, edit)
    return after !== colors && matched(open.shown.lines, after) > matched(open.shown.lines, colors)
  }

  function removeAll(open: Session): void {
    if (!store.remove(open.song.key)) {
      // Still on disk, so still on screen: the editor keeps showing what's there.
      notice = REMOVE_FAILED_NOTE
      notify()
      return
    }
    clearTimeout(saveTimer)
    saveTimer = undefined
    open.history = null
    open.saved = null
    open.timesChanged = false
    // No lines left for anything to wait at or a note to name.
    listening.placesChanged(open)
    // The outline goes with the colors; what's heard from now on starts a new one.
    open.peaks = emptyPeaks(open.song.durationSec)
    open.peaksVersion++
    open.peaksSavedVersion = open.peaksVersion
    heard.clear()
    lineWatch.stop()
    pendingDown = null
    notify()
  }

  function switchToPlaying(): void {
    if (!session || playingThis()) return
    const song = onScreen()
    const shown = song ? shownFor(song) : null
    if (!song || !shown) return
    leave()
    load(song, shown)
    syncTap()
    notify()
  }

  function open(): void {
    const song = onScreen()
    const shown = song ? shownFor(song) : null
    if (!song || !shown) return
    if (session) {
      if (nearSongKeys(session.song.key).includes(song.key)) return
      leave()
    } else {
      tap = options.openTap?.() ?? null
      stopHearing = tap?.onAudio(hear) ?? null
      // One runner for its folder at a time: this window's. Making it clears what a crash left.
      runner = tap && options.listen ? createListenRunner(options.listen) : null
      lastAudioAt = now()
      shownPictures = pictures?.all() ?? {}
      ticker = setInterval(tick, TICK_MS)
    }
    load(song, shown)
    syncTap()
    notify()
  }

  function close(): void {
    if (!session && !tap && ticker === undefined) return
    leave()
    clearInterval(ticker)
    ticker = undefined
    stopHearing?.()
    stopHearing = null
    // Stops its aligner and deletes a run's WAV; the run's answer then lands nowhere.
    runner?.dispose()
    runner = null
    tap?.dispose()
    tap = null
    tapFor = null
    starting = false
    tapFailedAt = Number.NEGATIVE_INFINITY
    shownPictures = {}
    notice = null
    notify()
  }

  /** Pictures are the singers', not the song's: a refusal still shows after moving songs. */
  function showNotice(result: { ok: true } | { ok: false; message: string }): void {
    if (result.ok || !session) return
    notice = result.message
    notify()
  }

  function handle(open: Session, command: ColorEditorCommand): void {
    switch (command.kind) {
      case 'begin':
        begin(open, command.colors)
        return
      case 'edit': {
        if (!open.history) return
        const before = open.history.now()
        const { edit } = command
        if (!editAllowed(open, before, edit)) return
        const after = open.history.apply(edit)
        stepped(before, after)
        // Timed by listening once they've played through (in `tick`, so waiting taps snap first).
        if (edit.kind === 'addLines' && after !== before) {
          open.pending = { first: edit.at, count: after.lines.length - before.lines.length }
        }
        return
      }
      case 'undo':
      case 'redo': {
        if (!open.history) return
        listening.stopWaiting(open)
        const before = open.history.now()
        stepped(before, command.kind === 'undo' ? open.history.undo() : open.history.redo())
        return
      }
      case 'listen':
        listening.listenTo(open, command.from, command.to)
        return
      case 'clearNote':
        listening.dropNote(open, command.note)
        return
      case 'playLine': {
        const line = open.history?.now().lines[command.line]
        if (line) lineWatch.play(line.start, line.end)
        return
      }
      case 'replayLine': {
        const span = open.history ? replaySpan(open.history.now(), command.line) : null
        if (span) lineWatch.play(span.start, span.end)
        return
      }
      case 'tap':
        tapWord(command.phase, command.line, command.word, command.whole === true)
        return
      case 'switchToPlaying':
        switchToPlaying()
        return
      case 'removeAll':
        removeAll(open)
        return
      case 'choosePicture':
        // A picture kept comes back through `subscribe`; a refusal says why.
        pictures?.choose(options.window?.() ?? null, command.singer).then(
          (result) => showNotice(result),
          () => undefined
        )
        return
      case 'pictureFromPath': {
        const result = pictures?.fromPath(command.singer, command.path)
        if (result) showNotice(result)
        return
      }
      case 'removePicture':
        pictures?.remove(command.singer)
        return
    }
  }

  const unsubscribeMusic = music.subscribe((next) => {
    const changed = heard.playerChanged(previous, next)
    previous = next
    if (!session) return
    // A J held across a seek, pause or song change would end the word somewhere else.
    if (changed || !playingThis()) pendingDown = null
    syncTap()
    lineWatch.check()
    notifyIfChanged()
  })

  const unsubscribeLyrics = lyrics.subscribe(() => {
    if (!session) return
    const song = playingThis() ? onScreen() : null
    const shown = song ? shownFor(song) : null
    // The editor's song gets new lyrics (a re-check, another version): its "changed" marks follow.
    // New times too (auto-sync timing it), which say where a run of added lines ends.
    if (
      shown &&
      (!sameList(shown.lines, session.shown.lines) ||
        !sameList(shown.rows, session.shown.rows) ||
        !sameList(shown.romaji, session.shown.romaji) ||
        !sameTimes(shown.own, session.shown.own))
    ) {
      session.shown = shown
      notify()
      return
    }
    notifyIfChanged()
  })

  const unsubscribePictures = pictures?.subscribe(() => {
    if (!session) return
    shownPictures = pictures.all()
    notify()
  })

  return {
    state: build,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    open,
    close,
    command(raw) {
      const command = parseColorEditorCommand(raw)
      if (!command || !session) return
      // The page dropping a note it showed asks nothing of the editor: a notice and waiting taps stay.
      if (command.kind !== 'clearNote') {
        // A notice is about the last thing asked; anything asked after it moves on.
        notice = null
        // Waiting taps land first, so what's asked after them comes after them (⌘Z undoes a tap).
        if (command.kind !== 'tap') landTaps(true)
      }
      handle(session, command)
      notifyIfChanged()
    },
    dispose() {
      close()
      unsubscribeMusic()
      unsubscribeLyrics()
      unsubscribePictures?.()
      listeners.clear()
    }
  }
}
