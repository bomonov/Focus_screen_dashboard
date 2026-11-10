import {
  SONG_COLORS_VERSION,
  type CodedLine,
  type CodedWord,
  type SingerRef,
  type SongColors
} from './types'

/** A name on a badge, never a paragraph. */
export const MAX_SINGER_NAME = 60

const EXTRA_PREFIX = 'extra:'
const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** A line that ends before it starts says the file isn't trustworthy at all, not just that line. */
const BACKWARDS = 'backwards'

interface ParsedLine {
  line: CodedLine
  /** As the file had it: whether it's a real second voice is settled once every line is read. */
  under: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function parseExtra(raw: unknown): SongColors['extra'][number] | null {
  if (!isRecord(raw)) return null
  const { id, name, color } = raw
  // The prefix keeps a singer of the user's own from ever shadowing a character.
  if (typeof id !== 'string' || !id.startsWith(EXTRA_PREFIX) || id.length === EXTRA_PREFIX.length)
    return null
  if (typeof name !== 'string' || name.trim() === '') return null
  if (typeof color !== 'string' || !HEX_COLOR.test(color)) return null
  // By whole characters: a name in Japanese or with an emoji must not be cut in half.
  return { id, name: Array.from(name).slice(0, MAX_SINGER_NAME).join(''), color }
}

function parseExtras(raw: unknown): SongColors['extra'] {
  if (!Array.isArray(raw)) return []
  const extras: SongColors['extra'] = []
  const seen = new Set<string>()
  for (const item of raw as unknown[]) {
    const extra = parseExtra(item)
    if (extra && !seen.has(extra.id)) {
      seen.add(extra.id)
      extras.push(extra)
    }
  }
  return extras
}

/** Ids in the order given, once each, that `isKnown` answers for. */
function knownIds(raw: unknown, isKnown: (id: string) => boolean): string[] {
  if (!Array.isArray(raw)) return []
  const ids: string[] = []
  for (const id of raw as unknown[]) {
    if (typeof id === 'string' && isKnown(id) && !ids.includes(id)) ids.push(id)
  }
  return ids
}

function parseSingers(raw: unknown, isKnown: (id: string) => boolean): SingerRef | null {
  if (raw === 'everyone') return 'everyone'
  const ids = knownIds(raw, isKnown)
  return ids.length > 0 ? ids : null
}

/**
 * A word that's off its line is pulled onto it instead of thrown away: it can't
 * start before its line or the word before it, nor run past the line's end.
 */
function parseWord(
  raw: unknown,
  notBefore: number,
  lineEnd: number,
  isKnown: (id: string) => boolean
): CodedWord | null {
  if (!isRecord(raw)) return null
  const { text, start, end, singers } = raw
  if (typeof text !== 'string' || !isSeconds(start) || !isSeconds(end)) return null
  const from = Math.min(Math.max(start, notBefore), lineEnd)
  const to = Math.min(Math.max(end, from), lineEnd)
  return { text, start: from, end: to, singers: parseSingers(singers, isKnown) }
}

/** Offsets in order and once each; a list with anything else in it is left out whole. */
function parseSplits(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null
  const values: unknown[] = raw
  if (!values.every(isOffset)) return null
  return [...new Set(values)].sort((a, b) => a - b)
}

function parseLine(
  raw: unknown,
  isKnown: (id: string) => boolean
): ParsedLine | typeof BACKWARDS | null {
  if (!isRecord(raw)) return null
  const { text, start, end, words: rawWords } = raw
  if (typeof text !== 'string' || !isSeconds(start) || !isSeconds(end)) return null
  if (!Array.isArray(rawWords)) return null
  if (end < start) return BACKWARDS

  const words: CodedWord[] = []
  let notBefore = start
  for (const rawWord of rawWords as unknown[]) {
    const word = parseWord(rawWord, notBefore, end, isKnown)
    if (!word) return null
    words.push(word)
    notBefore = word.start
  }

  const line: CodedLine = { text, start, end, words }
  const splits = parseSplits(raw.romajiSplits)
  if (splits) line.romajiSplits = splits
  if (raw.timed === true) line.timed = true
  // A line with times set isn't a guess, whatever else the file says.
  else if (raw.guessed === true) line.guessed = true
  if (raw.added === true) line.added = true
  // A break is a line the user added with nothing in it; a mark on anything else is wrong.
  if (raw.instrumental === true && line.added && text === '' && words.length === 0) {
    line.instrumental = true
  }
  return { line, under: raw.under }
}

/**
 * A saved coding read back from disk. It's untrusted (hand-edited, half-written,
 * from another version), so it's rebuilt piece by piece and anything off-shape
 * is left out rather than trusted. `known` says which singer ids are the
 * built-in cast; the file's own valid extra singers count as known too.
 */
export function parseSongColors(raw: unknown, known: (id: string) => boolean): SongColors | null {
  if (!isRecord(raw) || raw.version !== SONG_COLORS_VERSION) return null
  if (!Array.isArray(raw.lines)) return null

  const extra = parseExtras(raw.extra)
  const extraIds = new Set(extra.map((s) => s.id))
  const isKnown = (id: string): boolean => known(id) || extraIds.has(id)

  const lines: CodedLine[] = []
  // Where each line of the file ended up in `lines`, since dropping one moves the rest.
  const placed: (number | undefined)[] = []
  for (const rawLine of raw.lines as unknown[]) {
    const parsed = parseLine(rawLine, isKnown)
    if (parsed === BACKWARDS) return null
    if (!parsed) {
      placed.push(undefined)
      continue
    }
    const { line, under } = parsed
    if (under !== undefined) {
      // A second voice sits under a main line before it, never under another voice.
      const main = isOffset(under) ? placed[under] : undefined
      if (main === undefined || lines[main]?.under !== undefined) {
        placed.push(undefined)
        continue
      }
      line.under = main
      // Only a main line is added: a voice under one is its own words.
      delete line.added
      delete line.instrumental
    }
    placed.push(lines.length)
    lines.push(line)
  }

  return { version: SONG_COLORS_VERSION, lines, cast: knownIds(raw.cast, isKnown), extra }
}
