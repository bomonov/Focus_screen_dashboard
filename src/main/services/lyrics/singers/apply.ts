// Types and import-free helpers only: the editor's page uses `matchLines` too, so it puts each
// line's romaji where the Focus Screen does.
import type { Lyrics, LyricsColors, SyncedLine, SyncedWord } from '../types'
import { standIns } from './added'
import type { CodedLine, CodedWord, SongColors } from './types'

/** A word's singers as the screen needs them: "everyone" worked out, nobody as null. */
function resolve(word: CodedWord, cast: readonly string[]): string[] | null {
  const { singers } = word
  if (singers === null) return null
  // One singer can't be "everyone": until the cast has two, nobody is given the word.
  if (singers === 'everyone') return cast.length >= 2 ? [...cast] : null
  return singers.length > 0 ? [...singers] : null
}

function timedWord({ text, start, end }: CodedWord): SyncedWord {
  return { text, start, end }
}

/**
 * Which coded main line each shown line is, by exact text and in order: the longest run of
 * lines that both have, so a coded line is used once and never matched backwards. It's the
 * longest run, not the first fit, because one extra line that equals a later coded line (a
 * chorus line at the top) would otherwise drag the match past everything in between and
 * leave most of the song uncolored. When two fits are as good, the earlier coded line wins,
 * except a line the user added: it yields the row to a later line with its words that isn't
 * added (the lyrics' own twin, a repeated line), so it never takes that line's row or singers,
 * and goes in itself. It never yields to another added line: the row is the first's, and the
 * later one keeps its own place, so a line the user added twice doesn't show twice there.
 */
export function matchLines(
  texts: readonly string[],
  coded: readonly CodedLine[]
): (number | undefined)[] {
  // Only main lines can be matched: a second voice is not a shown line.
  const mains: { text: string; index: number; added?: true }[] = []
  coded.forEach((line, index) => {
    if (line.under === undefined) {
      mains.push({ text: line.text, index, ...(line.added ? { added: true as const } : {}) })
    }
  })

  const rows = texts.length
  const cols = mains.length
  const same = (row: number, col: number): boolean => {
    const text = texts[row]
    // A stanza gap or break has nothing to match.
    return text !== undefined && text !== '' && text === mains[col]?.text
  }

  // best[row][col]: how many lines can match using the shown lines from `row` and the coded from `col`.
  const best = Array.from({ length: rows + 1 }, () => new Int32Array(cols + 1))
  for (let row = rows - 1; row >= 0; row--) {
    const below = best[row + 1]
    const here = best[row]
    if (!below || !here) continue
    for (let col = cols - 1; col >= 0; col--) {
      here[col] = same(row, col)
        ? (below[col + 1] ?? 0) + 1
        : Math.max(below[col] ?? 0, here[col + 1] ?? 0)
    }
  }

  /** A later coded line, not added, can take `row` with the match as good as taking `col`. */
  const ownTwinTakes = (row: number, col: number): boolean => {
    const score = best[row]?.[col] ?? 0
    for (let later = col + 1; later < cols; later++) {
      if (mains[later]?.added !== true && same(row, later)) {
        if ((best[row + 1]?.[later + 1] ?? 0) + 1 === score) return true
      }
    }
    return false
  }

  const matches: (number | undefined)[] = new Array<number | undefined>(rows).fill(undefined)
  let row = 0
  let col = 0
  while (row < rows && col < cols) {
    const fits = same(row, col)
    // An added line that fits gives way when the match is as good with the row on a later line
    // with the same words that isn't added.
    const yields = fits && mains[col]?.added === true && ownTwinTakes(row, col)
    if (fits && !yields) {
      matches[row] = mains[col]?.index
      row++
      col++
    } else if (!yields && (best[row + 1]?.[col] ?? 0) >= (best[row]?.[col + 1] ?? 0)) {
      row++
    } else {
      col++
    }
  }
  return matches
}

/** The matched line as the user timed it. Its old word timings were for the old times, so they go. */
function timedLine(text: string, coded: CodedLine): SyncedLine {
  return {
    timeSec: coded.start,
    text,
    ...(coded.words.length > 0 ? { words: coded.words.map(timedWord) } : {})
  }
}

/**
 * How far each shown line moves: a matched line the user timed goes to their time, one they
 * didn't stays, and a changed one goes with the matched line before it (or the one after, up
 * at the top). Lines the user didn't time are in LRCLIB's or auto-sync's time, and if they
 * stayed there between lines in the user's, they'd land out of order, and the line before
 * them would never show.
 */
function shifts(
  lines: readonly SyncedLine[],
  codedFor: (shown: number) => CodedLine | undefined
): number[] {
  const own = lines.map((line, shown) => {
    const coded = codedFor(shown)
    if (!coded) return undefined
    return coded.timed ? coded.start - line.timeSec : 0
  })
  let current = own.find((shift) => shift !== undefined) ?? 0
  return own.map((shift) => {
    if (shift !== undefined) current = shift
    return current
  })
}

/** A changed line moved by `by` seconds, its word timings with it, never to before the song starts. */
function moved(line: SyncedLine, by: number): SyncedLine {
  if (by === 0) return line
  const move = (sec: number): number => Math.max(0, sec + by)
  return {
    ...line,
    timeSec: move(line.timeSec),
    ...(line.words
      ? {
          words: line.words.map((word) => ({
            ...word,
            start: move(word.start),
            end: move(word.end)
          }))
        }
      : {})
  }
}

/**
 * Line times that never go down. The lyrics are found by binary search on `timeSec`, which
 * only works in order; lines the user timed out of order (or a gap that starts after the
 * next line does) are held at the time of the line before.
 */
function inOrder(lines: SyncedLine[]): SyncedLine[] {
  let floor = 0
  return lines.map((line) => {
    const timeSec = Math.max(line.timeSec, floor)
    floor = timeSec
    return timeSec === line.timeSec ? line : { ...line, timeSec }
  })
}

/** A time on a coded line, as it falls on the shown line it was matched to. */
type TimeMap = (sec: number) => number

const bare = (text: string): string => text.replace(/\s+/g, '')

/**
 * A straight line through the points where the coding's times and the shown line's agree, and
 * past the first or last, that point's shift. Points come in order along the line.
 */
function throughPoints(points: readonly { from: number; to: number }[]): TimeMap {
  const sorted = [...points].sort((a, b) => a.from - b.from)
  return (sec) => {
    let before = sorted[0]
    if (!before || sec <= before.from) return sec + (before ? before.to - before.from : 0)
    for (const after of sorted) {
      if (sec <= after.from) {
        const span = after.from - before.from
        return span > 0
          ? before.to + ((sec - before.from) * (after.to - before.to)) / span
          : after.to
      }
      before = after
    }
    return sec + (before.to - before.from)
  }
}

/**
 * The coded words on the shown line's own word timings (auto-sync's), each placed by its
 * letters: a coded word that's the first three letters of a five-letter shown word gets the
 * first three fifths of its time. Null when the shown line has no word timings of its own.
 */
export function onShownWords(coded: CodedLine, shown: SyncedLine): SyncedWord[] | null {
  const own = shown.words
  if (!own || own.length === 0) return null
  const text = bare(shown.text)
  if (bare(own.map((word) => word.text).join('')) !== text) return null

  // Each shown word's letters, as a stretch of the line's (spaces left out), and its time.
  const stretches: { from: number; to: number; start: number; end: number }[] = []
  let letters = 0
  for (const word of own) {
    const length = bare(word.text).length
    if (length > 0) {
      stretches.push({ from: letters, to: letters + length, start: word.start, end: word.end })
    }
    letters += length
  }
  const share = (stretch: (typeof stretches)[number], at: number): number =>
    stretch.start +
    ((stretch.end - stretch.start) * (at - stretch.from)) / (stretch.to - stretch.from)
  const startAt = (at: number): number => {
    const stretch = stretches.find((one) => at < one.to)
    return stretch
      ? share(stretch, Math.max(at, stretch.from))
      : (stretches.at(-1)?.end ?? shown.timeSec)
  }
  const endAt = (at: number): number => {
    const stretch = stretches.find((one) => at <= one.to)
    return stretch
      ? share(stretch, Math.max(at, stretch.from))
      : (stretches.at(-1)?.end ?? shown.timeSec)
  }

  const placed: SyncedWord[] = []
  let from = 0
  for (const word of coded.words) {
    const piece = bare(word.text)
    const found = text.indexOf(piece, from)
    if (found === -1) return null
    const start = startAt(found)
    placed.push({ text: word.text, start, end: piece === '' ? start : endAt(found + piece.length) })
    from = found + piece.length
  }
  return placed
}

/**
 * A line the user didn't time, on the shown line's times: its words on the shown words (by
 * letters) when the shown line has word timings, else moved to the shown line's start and
 * squeezed in before the next line starts. With the map that did it, for its second voices.
 */
function onShownTimes(
  coded: CodedLine,
  shown: SyncedLine,
  nextStart: number | undefined
): { words: SyncedWord[]; map: TimeMap } {
  const placed = onShownWords(coded, shown)
  if (placed && placed.length > 0) {
    const points = coded.words.flatMap((word, i) => {
      const there = placed[i]
      return there
        ? [
            { from: word.start, to: there.start },
            { from: word.end, to: there.end }
          ]
        : []
    })
    return { words: placed, map: throughPoints(points) }
  }
  const span = coded.end - coded.start
  const room = nextStart === undefined ? span : Math.max(0, nextStart - shown.timeSec)
  const scale = span > 0 ? Math.min(1, room / span) : 1
  const map: TimeMap = (sec) => shown.timeSec + (sec - coded.start) * scale
  const words = coded.words.map((word) => ({
    text: word.text,
    start: map(word.start),
    end: map(word.end)
  }))
  return { words, map }
}

/**
 * Second voices, each under the shown line of its main line; one whose main line wasn't shown
 * is dropped. A voice nobody timed, under a line nobody timed, moves with its line (`maps`).
 */
function secondVoices(
  coding: SongColors,
  shownFor: ReadonlyMap<number, number>,
  maps: ReadonlyMap<number, TimeMap> = new Map()
): LyricsColors['voices'] {
  const voices: LyricsColors['voices'] = []
  for (const line of coding.lines) {
    if (line.under === undefined) continue
    const under = shownFor.get(line.under)
    if (under === undefined) continue
    const map = line.timed ? undefined : maps.get(line.under)
    voices.push({
      under,
      words: line.words.map((word) =>
        map
          ? {
              text: word.text,
              start: Math.max(0, map(word.start)),
              end: Math.max(0, map(word.end))
            }
          : timedWord(word)
      ),
      singers: line.words.map((word) => resolve(word, coding.cast))
    })
  }
  // Voices come out in the order of the lines they sit under, whatever order they were made in.
  return voices.sort((a, b) => a.under - b.under)
}

/** An added line that no shown line is, and its place in the coding. */
interface Added {
  index: number
  line: CodedLine
}

/** A row the Focus Screen shows: one of the lyrics' own (its place in them), or a line the user added. */
type Row = { kind: 'own'; row: number } | ({ kind: 'added' } & Added)

/**
 * The lyrics' own synced rows on the coding: a matched line the user timed goes to their time,
 * one they didn't keeps the lyrics' time with the coded words placed on it (its way there kept
 * in `maps`, for its second voices), and the rest move with their matched neighbours.
 */
function ownTimes(
  lines: readonly SyncedLine[],
  matches: readonly (number | undefined)[],
  codedFor: (shown: number) => CodedLine | undefined,
  maps: Map<number, TimeMap>
): SyncedLine[] {
  const by = shifts(lines, codedFor)
  return inOrder(
    lines.map((line, shown): SyncedLine => {
      const coded = codedFor(shown)
      if (!coded) return moved(line, by[shown] ?? 0)
      if (coded.timed) return timedLine(line.text, coded)
      const { words, map } = onShownTimes(coded, line, lines[shown + 1]?.timeSec)
      const match = matches[shown]
      if (match !== undefined) maps.set(match, map)
      return { timeSec: line.timeSec, text: line.text, ...(words.length > 0 ? { words } : {}) }
    })
  )
}

/**
 * Synced rows (the lyrics', or plain lyrics the user timed through): an added line goes before
 * the first of the lyrics' own rows that starts later than it does, added lines among
 * themselves by start, then by their place in the coding.
 */
function byTime(
  kept: readonly number[],
  added: readonly Added[],
  own: readonly SyncedLine[]
): Row[] {
  const queue = [...added].sort((a, b) => a.line.start - b.line.start || a.index - b.index)
  const rows: Row[] = []
  let next = 0
  const putIn = (before: number): void => {
    for (let one = queue[next]; one && one.line.start < before; one = queue[++next]) {
      rows.push({ kind: 'added', ...one })
    }
  }
  for (const row of kept) {
    putIn(own[row]?.timeSec ?? 0)
    rows.push({ kind: 'own', row })
  }
  putIn(Infinity)
  return rows
}

/**
 * Plain lyrics: an added line goes right after the row of the shown main line before it in the
 * coding (one of the lyrics' own, or an added one already put in). When none before it shows
 * (the lines before it changed in these lyrics), it goes just before the row of the next shown
 * coded line, and only with neither, at the end: never to the top of the song for want of an
 * anchor.
 */
function inCodingOrder(
  kept: readonly number[],
  added: readonly Added[],
  matches: readonly (number | undefined)[]
): Row[] {
  const rows: Row[] = []
  // Each shown main line's row, by its place in the coding.
  const placed = new Map<number, Row>()
  for (const row of kept) {
    const entry: Row = { kind: 'own', row }
    rows.push(entry)
    const match = matches[row]
    if (match !== undefined) placed.set(match, entry)
  }
  /** Where an added line goes: after the nearest placed line before it, else before the next one. */
  const placeOf = (index: number): number => {
    for (let before = index - 1; before >= 0; before--) {
      const entry = placed.get(before)
      if (entry) return rows.indexOf(entry) + 1
    }
    const after = [...placed.keys()].filter((at) => at > index)
    const next = after.length > 0 ? placed.get(Math.min(...after)) : undefined
    return next ? rows.indexOf(next) : rows.length
  }
  for (const one of added) {
    const at = placeOf(one.index)
    const entry: Row = { kind: 'added', ...one }
    rows.splice(at, 0, entry)
    placed.set(one.index, entry)
  }
  return rows
}

/** Lyrics that have lines: synced or plain. */
type WithLines = Extract<Lyrics, { kind: 'synced' | 'plain' }>

/**
 * The lyrics' own rows on the coding, as they'd be with nothing added: synced lyrics on the
 * coding's times (`ownTimes`), and plain lyrics on the user's times once every line they have
 * has them, else plain: made-up times must never stand in for auto-sync's.
 */
function ownLyrics(
  lyrics: WithLines,
  matches: readonly (number | undefined)[],
  codedFor: (shown: number) => CodedLine | undefined,
  maps: Map<number, TimeMap>
): WithLines {
  if (lyrics.kind === 'synced') {
    return { ...lyrics, lines: ownTimes(lyrics.lines, matches, codedFor, maps) }
  }
  const texts = lyrics.lines
  if (!texts.every((text, shown) => text === '' || codedFor(shown)?.timed)) return lyrics
  // A stanza gap starts where the line before it ended, but not after the line that follows it.
  const nextStart: number[] = []
  let upcoming = Infinity
  for (let shown = texts.length - 1; shown >= 0; shown--) {
    nextStart[shown] = upcoming
    upcoming = codedFor(shown)?.start ?? upcoming
  }
  let previousEnd = 0
  const lines = texts.map((text, shown): SyncedLine => {
    const coded = codedFor(shown)
    if (!coded) return { timeSec: Math.min(previousEnd, nextStart[shown] ?? Infinity), text: '' }
    previousEnd = coded.end
    return timedLine(text, coded)
  })
  return {
    kind: 'synced',
    lines: inOrder(lines),
    source: lyrics.source,
    ...(lyrics.from ? { from: lyrics.from } : {}),
    ...(lyrics.credit !== undefined ? { credit: lyrics.credit } : {})
  }
}

/**
 * Lays a saved coding over the lyrics that are shown. Lines whose text is exactly what was
 * coded take the user's words and singers, and their timing where the user set it (`timed`);
 * a matched line nobody timed keeps the lyrics' own time (auto-sync's, say), its words placed
 * on it. The rest stay uncolored and move with their matched neighbours, so every line keeps
 * its place. Plain lyrics stay plain, colored line by line, until every one of their lines has
 * the user's times: made-up times must never stand in for auto-sync's. Lines the user added that
 * the lyrics haven't got then go in among them as rows of their own, leaving the lyrics' rows as
 * they were: by their start (even a guessed one) when the lyrics' rows came out synced, else in
 * the coding's order, each in place of a like shown line it stands in for (`standIns`), so a
 * verse the lyrics gained shows once; the lyrics' own rows ride along as `colors.own`. Line
 * times never go down. Null when there's nothing to color: none of the lyrics' own coded lines
 * matched (an added line matching alone may be another version's verse), or the song is an
 * instrumental.
 */
export function colorLyrics(
  lyrics: Lyrics,
  coding: SongColors
): { lyrics: Lyrics; colors: LyricsColors } | null {
  if (lyrics.kind === 'instrumental') return null

  const texts = lyrics.kind === 'synced' ? lyrics.lines.map((line) => line.text) : lyrics.lines
  const matches = matchLines(texts, coding.lines)
  if (!matches.some((match) => match !== undefined && !coding.lines[match]?.added)) return null

  const codedFor = (shown: number): CodedLine | undefined => {
    const match = matches[shown]
    return match === undefined ? undefined : coding.lines[match]
  }

  // The lyrics' own rows, as they'd be with nothing added; they alone decide synced or plain.
  // Each untimed coded line's way onto its shown line, for the second voices under it.
  const maps = new Map<number, TimeMap>()
  const own = ownLyrics(lyrics, matches, codedFor, maps)

  // Then the added lines no shown line is, each shown line they stand in for left out.
  const matched = new Set(matches)
  // A music break shows only where lines have times: the note fills up until the next one.
  const added: Added[] = coding.lines.flatMap((line, index) =>
    line.added &&
    line.under === undefined &&
    !matched.has(index) &&
    (!line.instrumental || own.kind === 'synced')
      ? [{ index, line }]
      : []
  )
  const stood = new Set(standIns(texts, coding, matches).values())
  const kept = texts.flatMap((_, row) => (stood.has(row) ? [] : [row]))
  const rows: Row[] =
    added.length === 0
      ? kept.map((row) => ({ kind: 'own', row }))
      : own.kind === 'synced'
        ? byTime(kept, added, own.lines)
        : inCodingOrder(kept, added, matches)

  const codedOf = (row: Row): CodedLine | undefined =>
    row.kind === 'own' ? codedFor(row.row) : row.line
  const textOf = (row: Row): string => (row.kind === 'own' ? (texts[row.row] ?? '') : row.line.text)
  const shownFor = new Map<number, number>()
  rows.forEach((row, shown) => {
    const index = row.kind === 'own' ? matches[row.row] : row.index
    if (index !== undefined) shownFor.set(index, shown)
  })

  const colors: LyricsColors = {
    // A coded line with no words left (all of it made a second voice) is still the user's: an
    // empty list, so the screen draws its words (none) rather than its text.
    lines: rows.map((row) => {
      const line = codedOf(row)
      return line ? line.words.map((word) => resolve(word, coding.cast)) : null
    }),
    voices: secondVoices(coding, shownFor, maps),
    romajiSplits: rows.map((row) => {
      const splits = codedOf(row)?.romajiSplits
      return splits ? [...splits] : null
    }),
    extra: coding.extra.map((singer) => ({ ...singer })),
    ...(added.length > 0 ? { own } : {})
  }

  if (own.kind === 'plain') {
    return { lyrics: added.length === 0 ? own : { ...own, lines: rows.map(textOf) }, colors }
  }
  const lines = rows.map((row): SyncedLine =>
    row.kind === 'own'
      ? (own.lines[row.row] ?? { timeSec: 0, text: textOf(row) })
      : timedLine(row.line.text, row.line)
  )
  return { lyrics: { ...own, lines: inOrder(lines) }, colors }
}
