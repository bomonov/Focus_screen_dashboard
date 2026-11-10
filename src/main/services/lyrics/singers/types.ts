// What a song's coloring is, as saved and as the editor and the Focus Screen see it.
// Keep this file free of imports: the renderer compiles it too.

/** Who sings a word: singer ids in the order picked, or the song's whole cast. */
export type SingerRef = readonly string[] | 'everyone'

export interface CodedWord {
  /** As shown, spaces included. */
  text: string
  start: number
  end: number
  singers: SingerRef | null
}

export interface CodedLine {
  /** The line's text as the lyrics had it when coded: how it's matched again later. */
  text: string
  start: number
  end: number
  words: CodedWord[]
  /** A second voice sits under the main line at this index of `lines`; absent for a main line. */
  under?: number
  /** Romaji split points the user dragged, as character offsets into the line's romaji. */
  romajiSplits?: number[]
  /**
   * Its times are real: the user set them, or the lyrics came with them. A line without it was
   * given times only so it could be edited (plain lyrics spread over the song, or auto-sync's
   * copied), so the screen keeps the lyrics' own times for it and takes only its singers.
   */
  timed?: true
  /**
   * Its times are the editor's guess: plain lyrics spread over the song, maybe half a minute
   * off the singing. It turns `timed` only once its start is set (a tap on its first word, or
   * its start dragged), so a time set on one word never makes the guessed start count.
   * Auto-sync's times weren't set by anyone but were heard, so they count from the first edit.
   */
  guessed?: true
  /** The user added it ("＋ Add lines"): placed by its own times and its place in `lines`. Main lines only. */
  added?: true
  /**
   * A music break the user marked ("♪ Add break"): an added main line with no words and no text,
   * shown in synced lyrics as the note that fills up until the next line.
   */
  instrumental?: true
}

export interface SongColors {
  version: 1
  lines: CodedLine[]
  /** The song's cast, in order: who "Everyone" means. */
  cast: string[]
  /** Singers the user added (not in CAST). Ids start with "extra:". */
  extra: { id: string; name: string; color: string }[]
}

/**
 * A line as the lyrics show it now, its words split and timed the way the editor starts a
 * line: for redoing a changed line with the new words, or adding one the coding hasn't got.
 */
export interface ShownLine {
  text: string
  start: number
  end: number
  /** They spell out `text` exactly. */
  words: { text: string; start: number; end: number }[]
  /** Its times came with the lyrics (synced, not auto-synced). */
  timed?: true
  /** Its times are the editor's guess (plain lyrics). */
  guessed?: true
}

/** A line's times as a timing run heard them, in song time: one entry per word of the line. */
export interface HeardTime {
  line: number
  start: number
  end: number
  words: { start: number; end: number }[]
}

/**
 * One change the editor makes to a coding. Line numbers are places in `lines` as saved,
 * second voices included; word ranges end where `to` is (exclusive).
 */
export type ColorEdit =
  | { kind: 'assign'; line: number; from: number; to: number; singers: SingerRef | null }
  | { kind: 'lineTime'; line: number; start?: number; end?: number }
  | { kind: 'wordTime'; line: number; word: number; start?: number; end?: number }
  /**
   * A J tap: the word starts at `start` and the words after it move along with it (a late
   * singer pushes the rest of the line), or a held J ends it at `end`. Kept before `songEnd`.
   * `whole` (Tap: Lines, a start on word 0 only): the whole line moves to `start` instead, its
   * words, end and second voices along with it, timed or not.
   */
  | {
      kind: 'tapTime'
      line: number
      word: number
      start?: number
      end?: number
      songEnd?: number
      whole?: true
    }
  /** `at` counts whole characters into the word, so a letter is never cut in half. */
  | { kind: 'splitWord'; line: number; word: number; at: number }
  | { kind: 'makeVoice'; line: number; from: number; to: number }
  | { kind: 'addVoice'; line: number; text: string }
  | { kind: 'setCast'; cast: string[] }
  | { kind: 'addSinger'; name: string; color: string }
  | { kind: 'romajiSplits'; line: number; splits: number[] | null }
  /** "Use the new words": a changed main line takes a shown line's text, words and times. */
  | { kind: 'newWords'; line: number; shown: ShownLine }
  /**
   * A shown line the coding hasn't got, put in at `at` with nobody given anything, and `then`
   * made on it (its `line` is `at`) in the same step: a line is added on its first edit.
   */
  | { kind: 'addLine'; at: number; shown: ShownLine; then?: FirstEdit }
  /** Lines the user adds, put in at `at` (a place in `lines`), nobody singing, their times a guess. */
  | { kind: 'addLines'; at: number; lines: ShownLine[] }
  /** A music break the user marks, put in at `at` from `start` to `end` (its times a guess). */
  | { kind: 'addBreak'; at: number; start: number; end: number }
  /** An added line's new words, spread over its own span. */
  | { kind: 'retype'; line: number; shown: ShownLine }
  | { kind: 'removeLine'; line: number }
  /**
   * Moves an added line one place, past the block next to it. In synced lyrics the page also
   * sends its new guessed span (R13, Task 11's `movedTimes`), both or neither; plain lyrics send none.
   */
  | { kind: 'moveLine'; line: number; delta: -1 | 1; start?: number; end?: number }
  /** "Time by listening": lines take the times a run heard and turn `timed`. Only main makes it. */
  | { kind: 'heardTimes'; lines: HeardTime[] }
  /**
   * A main line's block dragged along the waveform: it starts at `start`, its words, end and
   * second voices moved along, and it's `timed`. An added line takes its place among the lines
   * by its new start; one of the lyrics' own keeps its place, never on or past a neighbour's
   * start. Kept inside the song (`songEnd`), its length kept.
   */
  | { kind: 'slideLine'; line: number; start: number; songEnd?: number }
  /**
   * Delete on a line of the lyrics' own: back on the lyrics' own time (`shown`, the same words),
   * its words keeping their shares and singers, its second voices moved along.
   */
  | { kind: 'resetTimes'; line: number; shown: ShownLine }

/**
 * The edits the page makes on a line as it's added (`addLine`'s `then`): its words and singers,
 * the first thing done to a line looked at in the edit area. Nothing else rides in with an add:
 * heard times come only from a run in main, and the rest (times, moves, other lines) aren't
 * edits of a line that isn't in the coding yet.
 */
export type FirstEdit = Extract<
  ColorEdit,
  { kind: 'assign' | 'splitWord' | 'makeVoice' | 'addVoice' | 'romajiSplits' }
>

export const SONG_COLORS_VERSION = 1
