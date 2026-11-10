import { useState } from 'react'
import type { ColorEdit, PlaybackState, SongColors } from '../../../main/ipc'
import { applyEdit } from '../../../main/services/lyrics/singers/edit'
import type { OwnLyrics } from '../../../main/services/lyrics/singers/listen'
import { positionAt } from '../../../main/services/music/types'
import { sendColorEditor } from '../../hooks/useLyricsColorEditor'
import {
  addedShownLines,
  addPlace,
  breakToAdd,
  keptLine,
  movedPlace,
  movedTimes,
  numberBefore,
  placeNow,
  type KeptLine
} from './addLines'

/** Where "＋ Add lines" would put lines at a press: by the time, or after this line. */
export interface AddAt {
  byTime: boolean
  after: number | null
}

/**
 * "＋ Add lines" pressed: where the song was, its timing fix then, and the line selected then.
 * Where the lines go is worked out from these as the coding is when they're added, since an
 * undo, a drag or a timing run can change it while they're being pasted.
 */
export interface AddSheet {
  pressSec: number
  fixSec: number
  kept: KeptLine | null
}

/** The paste box as drawn: the press, and where its lines would go now (null: nowhere now). */
export interface SheetView {
  pressSec: number
  place: AddAt | null
}

/**
 * A line the selection moves to once main's reply has it there (lines just added, a line just
 * moved): until then that place holds another line. `from` is the coding the edit was sent on.
 */
interface Follow {
  line: number
  text: string
  from: SongColors
}

/**
 * The editor page's adding and moving of lines: "＋ Add lines" and its paste box, ⌘N, and
 * ⌥↑/⌥↓ on an added line. The page keeps the selection: `arrived` is the line to select once
 * main's reply has put it in place, and the page calls `stopFollowing` when it takes it (or
 * when the user selects something else first).
 */
export function useAddLines({
  colors,
  own,
  playingThis,
  music,
  fixSec,
  durationSec,
  selectedLine
}: {
  colors: SongColors | null
  /** The lyrics' own lines on screen, while they're the editor's song's (`editorLyrics`). */
  own: OwnLyrics | null
  playingThis: boolean
  music: PlaybackState | null
  /** The song's timing fix on screen: lines the user adds go by the screen's clock. */
  fixSec: number
  durationSec: number
  /** The selected line in the coding; null with none, or while a new line is being looked at. */
  selectedLine: number | null
}): {
  sheet: SheetView | null
  /** Adding can be asked for: the coding is there, and the lyrics on screen are its song's. */
  canAdd: boolean
  placeAt: (pressSec: number) => AddAt | null
  /** Where a music break pressed then would go, or null ("♪ Add break" is off). */
  breakAt: (pressSec: number) => { at: number; start: number; end: number } | null
  /** "♪ Add break" at the song's position now. */
  addBreak: () => void
  openSheet: () => void
  closeSheet: () => void
  addLines: (texts: string[]) => void
  moveLine: (delta: -1 | 1) => void
  arrived: number | null
  stopFollowing: () => void
} {
  const [sheet, setSheet] = useState<AddSheet | null>(null)
  const [follow, setFollow] = useState<Follow | null>(null)
  if (sheet && !colors) setSheet(null)

  // Main's reply has the added or moved line in place.
  const there = follow && colors && colors !== follow.from ? colors.lines[follow.line] : undefined
  const arrived =
    follow && there?.added && there.under === undefined && there.text === follow.text
      ? follow.line
      : null

  // Placing lines needs the lyrics' own lines (R14), so it waits for them as ⌥↑/⌥↓ does.
  const canAdd = playingThis && colors !== null && own !== null

  /** Where lines added at a press there would go; null while adding is off. */
  const placeAt = (pressSec: number): AddAt | null => {
    if (!canAdd || !colors) return null
    const place = addPlace(colors, own, pressSec, fixSec, selectedLine)
    return place && { byTime: place.byTime, after: numberBefore(colors, place.index) }
  }

  /** Where a music break pressed there would go; null while one can't be (untimed lyrics too). */
  const breakAt = (pressSec: number): { at: number; start: number; end: number } | null =>
    canAdd && colors ? breakToAdd(colors, own, pressSec, fixSec, durationSec) : null

  /** "♪ Add break": a break from the press to the next line, selected once it's in. */
  const addBreak = (): void => {
    if (!music || !colors) return
    const pause = breakAt(positionAt(music, Date.now() / 1000))
    if (!pause) return
    sendColorEditor({ kind: 'edit', edit: { kind: 'addBreak', ...pause } })
    setFollow({ line: pause.at, text: '', from: colors })
  }

  /** "＋ Add lines" or ⌘N: the press, its fix and the line selected are kept while pasting. */
  const openSheet = (): void => {
    if (!music || !colors) return
    const pressSec = positionAt(music, Date.now() / 1000)
    if (placeAt(pressSec)) setSheet({ pressSec, fixSec, kept: keptLine(colors, selectedLine) })
  }

  // Worked out again on the coding as it is now.
  const placed = sheet && colors ? placeNow(colors, own, sheet) : null
  const sheetView: SheetView | null = sheet && {
    pressSec: sheet.pressSec,
    place:
      placed && colors ? { byTime: placed.byTime, after: numberBefore(colors, placed.index) } : null
  }

  const addLines = (texts: string[]): void => {
    if (!canAdd || !colors || !sheet || !placed) return
    const lines = addedShownLines(
      colors,
      own,
      placed.index,
      texts,
      sheet.pressSec,
      sheet.fixSec,
      durationSec
    )
    const first = lines[0]
    if (!first) return
    sendColorEditor({ kind: 'edit', edit: { kind: 'addLines', at: placed.index, lines } })
    setSheet(null)
    setFollow({ line: placed.index, text: first.text, from: colors })
  }

  /**
   * ⌥↑/⌥↓: an added line past the line next to it. In synced lyrics it takes a guessed span
   * between its new neighbours (R13); plain lyrics only change the order. It waits for the
   * lyrics on screen to be this song's, since only they say which kind they are.
   */
  const moveLine = (delta: -1 | 1): void => {
    if (!colors || selectedLine === null || !own) return
    const line = selectedLine
    const moved = colors.lines[line]
    const to = movedPlace(colors, line, delta)
    if (!moved || to === null) return
    const times = movedTimes(colors, own, line, delta, durationSec + fixSec)
    const edit: ColorEdit = { kind: 'moveLine', line, delta, ...(times ?? {}) }
    if (applyEdit(colors, edit) === colors) return
    sendColorEditor({ kind: 'edit', edit })
    setFollow({ line: to, text: moved.text, from: colors })
  }

  return {
    sheet: sheetView,
    canAdd,
    placeAt,
    breakAt,
    addBreak,
    openSheet,
    closeSheet: () => setSheet(null),
    addLines,
    moveLine,
    arrived,
    stopFollowing: () => setFollow(null)
  }
}
