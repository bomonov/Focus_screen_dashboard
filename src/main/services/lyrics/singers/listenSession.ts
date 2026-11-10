// "Time by listening" in the editor's session: runs of lines the user asks for, and lines just
// added once their stretch has played through. The session keeps the heard audio, the lines
// waiting and the last run's words; this hands the aligner a stretch and puts its answer back.
import { alignLanguage } from '../../autosync/lines'
import { SAMPLE_RATE, type SongRecording } from '../../autosync/recording'
import type { SyncedLine } from '../types'
import type { EditHistory } from './edit'
import {
  CRAMPED_NOTE,
  heardEdit,
  isCramped,
  isHeard,
  LISTEN_PAD_SEC,
  listenLines,
  NOT_HEARD_NOTE,
  runNote,
  timeSignature,
  type OwnLyrics
} from './listen'
import type { ListenRunner } from './listenRunner'
import type { CodedLine, SongColors } from './types'

/** A stretch of the song, in song time. */
export interface Stretch {
  from: number
  to: number
}

/** What listening needs of the editor's session; the session has these and more. */
export interface Listening {
  history: EditHistory | null
  /**
   * The song's audio as heard while the window is open, by song time. In memory only, gone
   * with the session (window closed, or another song); null without a tap or the add-on.
   */
  recording: SongRecording | null
  /**
   * Lines just added (places in `lines`), timed once their stretch has played. `cramped`: they
   * came too close to the next line, so they wait for the user to set the first one's start.
   */
  pending: { first: number; count: number; cramped?: true } | null
  /** The lines a run is timing now. */
  timing: number[]
  /** How the last run went, when it didn't all work. */
  note: string | null
  /** The lines the note is about (places in `lines`); empty with no note. */
  noteLines: number[]
}

export interface ListenSessionDeps<S extends Listening> {
  /** The session open now: an answer lands only on the one it was asked for. */
  current(): S | null
  /** Made and disposed with the window; null without a tap. */
  runner(): ListenRunner | null
  /** Where `lines` are heard, in song time: `listenStretch` under the song's timing fix. */
  stretchOf(open: S, colors: SongColors, lines: readonly number[]): Stretch | null
  /** One step of the history, saved and shown like any edit, so its times clear the fix. */
  stepped(before: SongColors, after: SongColors | null): void
  notify(): void
}

export interface ListenSession<S extends Listening> {
  /**
   * Each tick: lines just added are timed once their stretch has played through. While it gives
   * them under MIN_SEC_PER_ADDED_LINE a line they stay guesses and the note (said once) asks for
   * the first one's start; once the user has set it, the rest are timed as usual.
   */
  whenHeard(open: S): void
  /** "Time by listening" for places from..to (`to` exclusive), timed lines too. */
  listenTo(open: S, from: number, to: number): void
  /** Lines just added stop waiting (an undo or redo, colors removed): a cramped note goes too. */
  stopWaiting(open: S): void
  /** Lines were added, removed or moved: nothing waits at the old places, no note names them. */
  placesChanged(open: S): void
  /** The page has moved off the lines of the note it showed: it goes, if it's still that one. */
  dropNote(open: S, note: string): void
}

/**
 * Whether a step kept every line in its place: none added, removed or moved. A retype or new
 * words change one line's text where it is; a move changes at least two places.
 */
export function samePlaces(before: SongColors, after: SongColors): boolean {
  if (before.lines.length !== after.lines.length) return false
  let retyped = 0
  return before.lines.every((line, i) => {
    const other = after.lines[i]
    if (!other || other.under !== line.under || (other.added === true) !== (line.added === true)) {
      return false
    }
    if (other.text !== line.text) retyped++
    return retyped < 2
  })
}

/** Whether the lyrics' own lines show at the same times (auto-sync timing a song changes them). */
export function sameTimes(a: OwnLyrics, b: OwnLyrics): boolean {
  if (a === b) return true
  if (a.kind !== b.kind) return false
  if (a.kind === 'plain' || b.kind === 'plain') return true
  const wordTimes = (line: SyncedLine): string =>
    JSON.stringify(line.words?.map((word) => [word.start, word.end]) ?? null)
  return (
    a.lines.length === b.lines.length &&
    a.lines.every((line, i) => {
      const other = b.lines[i]
      return (
        other !== undefined &&
        other.timeSec === line.timeSec &&
        wordTimes(other) === wordTimes(line)
      )
    })
  )
}

function say(open: Listening, note: string | null, lines: readonly number[]): void {
  open.note = note
  open.noteLines = note === null ? [] : [...lines]
}

export function createListenSession<S extends Listening>(
  deps: ListenSessionDeps<S>
): ListenSession<S> {
  /**
   * Hands the aligner `lines` (places in `lines`) with the audio heard over `stretch`, padded,
   * and puts what it hears on the lines for which `still` holds then. The answer lands only on
   * this session's coding (the window still open, on this song, its colors not removed), and
   * only on lines still at their place with their text and the times they had when it was
   * asked: a tap or a drag made while the run was out is the user's, and wins.
   */
  function run(
    open: S,
    lines: number[],
    stretch: Stretch,
    still: (line: CodedLine) => boolean
  ): void {
    const runner = deps.runner()
    const { history, recording } = open
    if (!runner || !history || !recording) return
    const colors = history.now()
    const asked = lines.flatMap((index) => {
      const line = colors.lines[index]
      return line ? [{ index, text: line.text, times: timeSignature(line) }] : []
    })
    if (asked.length === 0) return
    const audio = recording.samples()
    const first = Math.max(0, Math.round((stretch.from - LISTEN_PAD_SEC) * SAMPLE_RATE))
    const last = Math.min(audio.length, Math.round((stretch.to + LISTEN_PAD_SEC) * SAMPLE_RATE))
    if (last <= first) return
    const mainLines = colors.lines.filter((line) => line.under === undefined)
    open.timing = asked.map((line) => line.index)
    say(open, null, [])
    deps.notify()
    void runner
      .run({
        texts: asked.map((line) => line.text),
        // A copy: the recording goes on filling while the run is out.
        samples: audio.slice(first, last),
        clipStart: first / SAMPLE_RATE,
        language: alignLanguage(mainLines.map((line) => line.text))
      })
      .then((answer) => {
        // Closed, or moved to another song: the answer is nobody's.
        if (deps.current() !== open) return
        open.timing = []
        if (open.history === history) {
          const before = history.now()
          // Lines added, removed or moved meanwhile: it can't say which lines it means any more.
          const places = asked.map((line) => line.index)
          say(open, samePlaces(colors, before) ? runNote(answer) : null, places)
          // A tap or drag made while the run was out is the user's: that line keeps it.
          const times = new Map(asked.map((line) => [line.index, line.times]))
          const untouched = (line: CodedLine, index: number): boolean =>
            times.get(index) === timeSignature(line) && still(line)
          const edit = answer ? heardEdit(before, asked, answer, untouched) : null
          // A step like any other, so its times clear the song's timing fix as a tap's do.
          if (edit) deps.stepped(before, history.apply(edit))
        }
        deps.notify()
      })
  }

  function stopWaiting(open: S): void {
    if (open.pending?.cramped && open.note === CRAMPED_NOTE) say(open, null, [])
    open.pending = null
  }

  return {
    whenHeard(open) {
      const runner = deps.runner()
      const { pending, history, recording } = open
      if (!pending || !history || !recording || !runner?.installed || runner.busy()) return
      const colors = history.now()
      const lines = listenLines(colors, pending.first, pending.first + pending.count)
      // Tapped by hand meanwhile: nothing left to time.
      if (lines.every((index) => colors.lines[index]?.timed)) {
        stopWaiting(open)
        return
      }
      // Worked out again each time: a tap on the next line's start can end it sooner.
      const stretch = deps.stretchOf(open, colors, lines)
      if (stretch && isCramped(stretch, lines.length)) {
        // Pressed too late to fit before the next line: they stay guesses until the user sets
        // where the verse starts.
        if (!pending.cramped) {
          open.pending = { ...pending, cramped: true }
          say(open, CRAMPED_NOTE, lines)
          deps.notify()
        }
        return
      }
      // The press came after the verse, so only the user's start for its first line says where
      // it is, even once the next line has moved away.
      const first = lines[0]
      if (pending.cramped && (first === undefined || !colors.lines[first]?.timed)) return
      if (!stretch || !isHeard(recording.heardSpans(), stretch)) return
      open.pending = null
      run(open, lines, stretch, (line) => !line.timed)
    },
    listenTo(open, from, to) {
      const runner = deps.runner()
      if (!runner?.installed || !open.history || !open.recording || open.timing.length > 0) return
      const colors = open.history.now()
      const lines = listenLines(colors, from, to)
      if (lines.length === 0) return
      const stretch = deps.stretchOf(open, colors, lines)
      if (!stretch || !isHeard(open.recording.heardSpans(), stretch)) {
        say(open, NOT_HEARD_NOTE, lines)
        return
      }
      run(open, lines, stretch, () => true)
    },
    stopWaiting,
    placesChanged(open) {
      open.pending = null
      say(open, null, [])
    },
    dropNote(open, note) {
      if (open.note === note) say(open, null, [])
    }
  }
}
