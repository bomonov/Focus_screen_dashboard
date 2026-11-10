// Romaji under Japanese lyrics: VocaDB's romanization, matched line by line to the lyrics shown
// (LRCLIB's, VocaDB's, or auto-synced). A line only gets romaji when it's clearly the same line:
// none is better than the wrong one.
import { normalize, similarity } from './text'

/** Hiragana or katakana: what tells Japanese apart from Chinese, which shares the kanji. */
const KANA = /[぀-ヿ]/
/** Latin letters and no Japanese at all: English, or romaji the lyrics already carry. */
const LATIN_ONLY = (line: string): boolean => /[a-z]/i.test(line) && !/[぀-ヿ㐀-鿿]/.test(line)

/** Kana in at least a quarter of the sung lines: Japanese enough for romaji to help. */
const MIN_KANA_SHARE = 0.25
/**
 * Lyrics with this many Latin-only lines already carry their romaji (or a translation) under
 * each line; ours would say it twice. A song with a few English lines stays well under it.
 */
const MAX_LATIN_SHARE = 0.4

/** Lines worth putting romaji under: Japanese, and not already romanized line by line. */
export function wantsRomaji(lines: readonly string[]): boolean {
  const sung = lines.map((line) => line.trim()).filter((line) => line !== '')
  if (sung.length === 0) return false
  const kana = sung.filter((line) => KANA.test(line)).length
  const latin = sung.filter(LATIN_ONLY).length
  return kana >= sung.length * MIN_KANA_SHARE && latin < sung.length * MAX_LATIN_SHARE
}

export interface RomajiPair {
  /** A line as VocaDB has it in Japanese. */
  sung: string
  romaji: string
}

const sungLines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')

/** Kana that add one letter to romaji: vowels, ん, small kana (kya, the doubled consonant), ー. */
const ONE_LETTER = /[あいうえおアイウエオんンぁぃぅぇぉゃゅょゎァィゥェォャュョヮっッー]/
const KANA_CHAR = /[\u3040-\u30ff]/
const KANJI_CHAR = /[\u3400-\u9fff々]/
/** A kanji reads as one to four sounds; about this many letters on average. */
const KANJI_LETTERS = 3.5

/** About how many letters a Japanese line's romaji has: most kana are a consonant and a vowel. */
export function romajiLength(line: string): number {
  let letters = 0
  for (const char of line.normalize('NFKC')) {
    if (/[a-z0-9]/i.test(char) || ONE_LETTER.test(char)) letters += 1
    else if (KANA_CHAR.test(char)) letters += 2
    else if (KANJI_CHAR.test(char)) letters += KANJI_LETTERS
  }
  return letters
}

/** A romaji line's letters, lower case, macrons and punctuation aside. */
function romajiLetters(line: string): string {
  return line
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

const letterCount = (line: string): number => romajiLetters(line).length

// Hiragana sounds, in gojūon order, for spelling out a line's kana roughly as romaji.
const KANA_ROWS = [
  'あa いi うu えe おo かka きki くku けke こko さsa しshi すsu せse そso たta ちchi つtsu てte とto',
  'なna にni ぬnu ねne のno はha ひhi ふfu へhe ほho まma みmi むmu めme もmo やya ゆyu よyo',
  'らra りri るru れre ろro わwa をo んn がga ぎgi ぐgu げge ごgo ざza じji ずzu ぜze ぞzo',
  'だda ぢji づzu でde どdo ばba びbi ぶbu べbe ぼbo ぱpa ぴpi ぷpu ぺpe ぽpo ゔvu',
  'ぁa ぃi ぅu ぇe ぉo ゃya ゅyu ょyo ゎwa'
]
const KANA_SOUND = new Map(
  KANA_ROWS.join(' ')
    .split(' ')
    .map((entry) => [entry.slice(0, 1), entry.slice(1)] as const)
)

/**
 * A line's kana spelled out roughly as romaji, in runs broken wherever there's a kanji (whose
 * reading can't be known) or anything else. Rough is enough: it's only compared, never shown.
 */
function kanaRuns(line: string, minLetters = 2): string[] {
  const runs: string[] = []
  let run = ''
  for (const raw of line.normalize('NFKC')) {
    // Katakana sit 0x60 above their hiragana.
    const code = raw.codePointAt(0) ?? 0
    const char = code >= 0x30a1 && code <= 0x30f4 ? String.fromCodePoint(code - 0x60) : raw
    const sound = KANA_SOUND.get(char)
    if (sound !== undefined) {
      // A small ya/yu/yo (or vowel) bends the sound before it: ki + ya is kya, and shi, chi
      // and ji just take its vowel (sha, chu, jo). After its own vowel, a small vowel draws
      // it out instead: ne + e is nee (ねぇ).
      if (/[ゃゅょ]/.test(char) && /(?:sh|ch|j)i$/.test(run))
        run = run.slice(0, -1) + sound.slice(1)
      else if (/[ぁぃぅぇぉ]/.test(char) && run.endsWith(sound)) run += sound
      else run = /[ゃゅょぁぃぅぇぉ]/.test(char) ? run.replace(/[aiueo]$/, '') + sound : run + sound
    } else if (char === 'っ' || char === 'ー') {
      // The doubled consonant and the long vowel: one letter either way, not worth guessing.
    } else if (/[a-z]/i.test(char)) {
      run += char.toLowerCase()
    } else {
      if (run.length >= minLetters) runs.push(run)
      run = ''
    }
  }
  if (run.length >= minLetters) runs.push(run)
  return runs
}

function bigramsOf(text: string): string[] {
  const pairs: string[] = []
  for (let i = 0; i < text.length - 1; i++) pairs.push(text.slice(i, i + 2))
  return pairs
}

/**
 * How much of a line's kana shows up in a romaji line: the share of its spelled-out letter pairs
 * found there (0–1), and how many pairs that judges from. A line that's mostly kanji has few.
 */
function soundMatch(sung: string, romaji: string): { share: number; weight: number } {
  const theirs = new Set(bigramsOf(romajiLetters(romaji)))
  const ours = kanaRuns(sung).flatMap(bigramsOf)
  if (ours.length === 0) return { share: 0, weight: 0 }
  const found = ours.filter((pair) => theirs.has(pair)).length
  return { share: found / ours.length, weight: ours.length }
}

/**
 * How far a line's romaji strays from its expected length: the spread of ln(actual / expected),
 * measured on 2,300 lines of VocaDB romaji (98% within 0.3).
 */
const LENGTH_SPREAD = 0.12
/** Past this, a pairing is a guess, and no pair is better than a wrong one. */
const MAX_LENGTH_GAP = 0.35
/**
 * How much the kana's sounds count against a pairing next to length: a wrong line of the same
 * length shares far fewer of them. Full weight once a line has this many letter pairs of kana.
 */
const SOUND_COST = 6
const SOUND_FULL_WEIGHT = 8
/** A pair whose kana mostly isn't in its romaji is the wrong pair, whatever the length says. */
const MIN_SOUND_SHARE = 0.5
/** VocaDB splits a line in two (or joins two) now and then; less often than not. */
const SPLIT_COST = 3
/** A line with no counterpart at all (a note, a line one copy left out) is rarer still. */
const SKIP_COST = 5
/** Below this share of lines paired, the two copies don't really match: none at all. */
const MIN_PAIRED_SHARE = 0.7

type Bead = { sung: number; romaji: number }
const BEADS: readonly Bead[] = [
  { sung: 1, romaji: 1 },
  { sung: 1, romaji: 2 },
  { sung: 2, romaji: 1 },
  { sung: 1, romaji: 0 },
  { sung: 0, romaji: 1 }
]

/**
 * Pairs lines whose counts differ, by length (romaji spells out each line's sounds, so its
 * length follows the line's): the cheapest way through both lists, where a line may also be
 * split in two or two joined into one, or have no counterpart (lengths aligned the way
 * translated sentences are). Pairs that don't fit their length are left out.
 */
export function pairByLength(
  sung: readonly string[],
  romaji: readonly string[]
): { pairs: RomajiPair[]; pairedLines: number } {
  const expected = sung.map(romajiLength)
  const actual = romaji.map(letterCount)
  const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0)
  // This song's own letters per estimated letter: its kanji may read longer or shorter.
  const scale = sum(actual) / Math.max(1, sum(expected))
  const gap = (sungLetters: number, romajiLetters: number): number =>
    Math.log((romajiLetters + 2) / (sungLetters * scale + 2))
  const lengthCost = (sungLetters: number, romajiLetters: number): number =>
    gap(sungLetters, romajiLetters) ** 2 / (2 * LENGTH_SPREAD ** 2)

  const rows = sung.length
  const cols = romaji.length
  const width = cols + 1
  const cost = new Float64Array((rows + 1) * width).fill(Infinity)
  const via = new Array<Bead | undefined>((rows + 1) * width)
  cost[0] = 0
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= cols; j++) {
      const from = cost[i * width + j] ?? Infinity
      if (from === Infinity) continue
      for (const bead of BEADS) {
        const ni = i + bead.sung
        const nj = j + bead.romaji
        if (ni > rows || nj > cols) continue
        let step = SKIP_COST
        if (bead.sung > 0 && bead.romaji > 0) {
          const s = sum(expected.slice(i, ni))
          const r = sum(actual.slice(j, nj))
          const sound = soundMatch(sung.slice(i, ni).join(' '), romaji.slice(j, nj).join(' '))
          const soundWeight = Math.min(1, sound.weight / SOUND_FULL_WEIGHT)
          step =
            lengthCost(s, r) +
            SOUND_COST * soundWeight * (1 - sound.share) +
            (bead.sung + bead.romaji > 2 ? SPLIT_COST : 0)
        }
        const at = ni * width + nj
        if (from + step < (cost[at] ?? Infinity)) {
          cost[at] = from + step
          via[at] = bead
        }
      }
    }
  }

  const pairs: RomajiPair[] = []
  let pairedLines = 0
  let i = rows
  let j = cols
  while (i > 0 || j > 0) {
    const bead = via[i * width + j]
    if (!bead) break
    const pi = i - bead.sung
    const pj = j - bead.romaji
    if (bead.sung > 0 && bead.romaji > 0) {
      const s = sum(expected.slice(pi, i))
      const r = sum(actual.slice(pj, j))
      const pair = { sung: sung.slice(pi, i).join(' '), romaji: romaji.slice(pj, j).join(' ') }
      const sound = soundMatch(pair.sung, pair.romaji)
      const soundsWrong = sound.weight >= SOUND_FULL_WEIGHT && sound.share < MIN_SOUND_SHARE
      if (Math.abs(gap(s, r)) <= MAX_LENGTH_GAP && !soundsWrong) {
        pairs.push(pair)
        pairedLines += bead.sung
      }
    }
    i = pi
    j = pj
  }
  return { pairs: pairs.reverse(), pairedLines }
}

/**
 * VocaDB's lyrics and their romanization, line by line, paired by length. They're mostly written
 * to line up, but not always: a line split in two in one, a line one leaves out. Even with the
 * same number of lines, a split and a join can cancel out and shift everything in between, so
 * lines are never paired by position alone. Only if most lines pair up does any romaji show.
 */
export function pairRomaji(original: string, romanized: string): RomajiPair[] | null {
  const sung = sungLines(original)
  const romaji = sungLines(romanized)
  if (sung.length === 0 || romaji.length === 0) return null
  const { pairs, pairedLines } = pairByLength(sung, romaji)
  return pairedLines >= sung.length * MIN_PAIRED_SHARE ? pairs : null
}

/** Readings and asides in brackets ("運命(さだめ)") aren't in every copy of the lyrics. */
const BRACKETED = /[（(［[][^）)］\]]*[）)］\]]/g

function compact(line: string): string {
  return normalize(line.replace(BRACKETED, '')).replace(/ /g, '')
}

/** How alike two lines are, 0–1, among lines of nearly the same length. */
const MIN_SIMILARITY = 0.6
/** Half a line isn't the line, however alike the halves look; two lines in one is handled apart. */
const MAX_LENGTH_RATIO = 1.5

/** How well a shown line matches a line of VocaDB's; 0 when it isn't the same line. */
function matchScore(shown: string, theirs: string): number {
  const a = compact(shown)
  const b = compact(theirs)
  if (a === '' || b === '') return 0
  if (Math.max(a.length, b.length) / Math.min(a.length, b.length) > MAX_LENGTH_RATIO) return 0
  const score = similarity(a, b)
  return score >= MIN_SIMILARITY ? score : 0
}

/** Most shown lines one of VocaDB's is split across ("A B C" shown as three lines). */
const MAX_SPLIT = 3
/**
 * Lines cut from one of VocaDB's must make up that line, near enough letter for letter (one
 * copy writing a word in kana that the other writes in kanji, 達 and たち, is about all). Lines
 * that are only alike (a chorus line three times, shown with a different fourth line) would
 * spread its romaji over a line it doesn't have.
 */
const MIN_SPLIT_SIMILARITY = 0.85
/**
 * And each of them must be in that line, by most of its letter pairs: a kanji written in kana
 * (達 as たち) costs a pair or two, but a line that isn't there at all (「だだだ ダメ人間！」
 * after a line of だめだめ) shares only its repeats.
 */
const MIN_PIECE_FOUND = 0.6

/** Fewer letter pairs than this can't say whether a line is in another ("ねぇ" against "ねえ"). */
const MIN_PAIRS_TO_FIND = 3

/**
 * The share of a line's letter pairs found in another line, each pair there used up once; 1 for
 * a line too short to tell.
 */
function foundIn(line: string, theirs: string): number {
  const ours = bigramsOf(compact(line))
  if (ours.length < MIN_PAIRS_TO_FIND) return 1
  const left = new Map<string, number>()
  for (const pair of bigramsOf(compact(theirs))) left.set(pair, (left.get(pair) ?? 0) + 1)
  let found = 0
  for (const pair of ours) {
    const count = left.get(pair) ?? 0
    if (count > 0) {
      found += 1
      left.set(pair, count - 1)
    }
  }
  return found / ours.length
}

/**
 * Two ways to cut a line's romaji that fit about as well are a coin toss: the cut must beat any
 * other by this much (in the same units as the length and sound costs), or there's no romaji.
 */
const MIN_CUT_MARGIN = 0.5

/** Marks at a line's edges that aren't sung: quotes, dashes, dots, the long vowel. */
const EDGE_MARKS = /^[\s\p{P}\p{S}ーっッ]+|[\s\p{P}\p{S}ーっッ]+$/gu
/** Kana, or Latin letters (written as they're sung), at a line's start or end. */
const LEADING_SOUNDS = /^(?:[\u3040-\u30ff]+|[a-z]+)/i
const TRAILING_SOUNDS = /(?:[\u3040-\u30ff]+|[a-z]+)$/i

/** The particles は and へ, sung "wa" and "e": a line often ends on one ("音楽は"). */
const PARTICLE_READINGS: Readonly<Record<string, string>> = { は: 'wa', へ: 'e' }

/**
 * Long vowels drawn out or not: romaji writes "nee", "nē" (ne once the macron goes) or "ne",
 * "dou" or "dō", and the kana leave ー out, so each side is compared with them shortened.
 */
const shortVowels = (letters: string): string =>
  letters.replace(/ou/g, 'o').replace(/([aiueo])\1+/g, '$1')

interface Edges {
  first: string
  /** More than one when the line ends on a particle: "音楽は" ends in "ha" or "wa". */
  last: string[]
}

/**
 * The sounds a line starts and ends with, spelled roughly as romaji, where it starts or ends
 * with kana or letters ('' at a kanji, whose reading isn't known): 「夢が始まる」 ends in "ru",
 * "…go round!" in "nd".
 */
function edgeSounds(line: string): Edges {
  const bare = line.normalize('NFKC').replace(EDGE_MARKS, '')
  const spell = (sounds: string): string => shortVowels(kanaRuns(sounds, 1).join(''))
  const trailing = TRAILING_SOUNDS.exec(bare)?.[0] ?? ''
  const particle = PARTICLE_READINGS[trailing.slice(-1)]
  const last = [spell(trailing).slice(-2)]
  if (particle !== undefined) last.push((spell(trailing.slice(0, -1)) + particle).slice(-2))
  return { first: spell(LEADING_SOUNDS.exec(bare)?.[0] ?? '').slice(0, 2), last }
}

/** Whether a piece of romaji starts and ends with the sounds its line does, where those are known. */
function edgesFit(edges: Edges, piece: string): boolean {
  const letters = shortVowels(romajiLetters(piece))
  return letters.startsWith(edges.first) && edges.last.some((last) => letters.endsWith(last))
}

/**
 * One of VocaDB's romaji lines cut at word gaps into the pieces that go under each of the shown
 * lines it covers, by each piece's length (at the song's own `scale` of letters, so a pair that
 * lost part of its romaji doesn't fit) and the sounds of its kana; null when no cut clearly fits:
 * every cut next to a kana, every piece in length and sound, starting and ending as its line
 * does, and better than any other cut.
 */
export function splitRomaji(
  shown: readonly string[],
  romaji: string,
  scale: number
): string[] | null {
  const words = romaji.split(/\s+/).filter((word) => word !== '')
  const parts = shown.length
  if (parts < 2 || words.length < parts) return null
  const expected = shown.map(romajiLength)
  const edges = shown.map(edgeSounds)
  // Each cut needs a kana on one side of it to say where it goes; between two kanji, it's a guess.
  for (let k = 0; k < parts - 1; k++) {
    if (!edges[k]?.last[0] && !edges[k + 1]?.first) return null
  }

  const costOf = (pieces: string[]): number | null => {
    let cost = 0
    for (const [index, piece] of pieces.entries()) {
      const line = shown[index] ?? ''
      const gap = Math.log((letterCount(piece) + 2) / ((expected[index] ?? 0) * scale + 2))
      const fits = edgesFit(edges[index] ?? { first: '', last: [''] }, piece)
      if (Math.abs(gap) > MAX_LENGTH_GAP || !fits) return null
      const sound = soundMatch(line, piece)
      if (sound.weight >= SOUND_FULL_WEIGHT && sound.share < MIN_SOUND_SHARE) return null
      const soundWeight = Math.min(1, sound.weight / SOUND_FULL_WEIGHT)
      cost += gap ** 2 / (2 * LENGTH_SPREAD ** 2) + SOUND_COST * soundWeight * (1 - sound.share)
    }
    return cost
  }

  // Every way to cut the words into `parts` pieces (at most three, so few).
  const cuts: number[][] = []
  const choose = (from: number, left: number, chosen: number[]): void => {
    if (left === 0) return void cuts.push(chosen)
    for (let at = from; at <= words.length - left; at++) choose(at + 1, left - 1, [...chosen, at])
  }
  choose(1, parts - 1, [])

  let best: { pieces: string[]; cost: number } | null = null
  let runnerUp = Infinity
  for (const cut of cuts) {
    const bounds = [0, ...cut, words.length]
    const pieces = bounds.slice(1).map((end, k) => words.slice(bounds[k], end).join(' '))
    const cost = costOf(pieces)
    if (cost === null) continue
    if (!best || cost < best.cost) {
      runnerUp = best?.cost ?? Infinity
      best = { pieces, cost }
    } else if (cost < runnerUp) {
      runnerUp = cost
    }
  }
  return best && runnerUp - best.cost >= MIN_CUT_MARGIN ? best.pieces : null
}

type Step =
  | { kind: 'skipShown' }
  | { kind: 'skipTheirs' }
  /** One shown line is one of VocaDB's, or two of theirs that the shown copy joined. */
  | { kind: 'match'; span: 1 | 2 }
  /** Two or three shown lines are one of VocaDB's, its romaji cut between them. */
  | { kind: 'split'; lines: number; pieces: string[] }

/**
 * Romaji under each shown line ('' where there's none), or null when no line matched. Lines are
 * matched in order, so a chorus that repeats lines up with its own repeat: the best-scoring way
 * through both lists (a sequence alignment), where skipping a line costs nothing. A line VocaDB
 * keeps whole but the shown lyrics split ("あさのひかりが まどをてらす" as two lines)
 * has its romaji cut between them (`splitRomaji`).
 */
export function alignRomaji(
  shown: readonly string[],
  pairs: readonly RomajiPair[]
): string[] | null {
  const rows = shown.length
  const cols = pairs.length
  const width = cols + 1
  // This song's romaji letters per estimated letter, as the pairing measured it.
  const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0)
  const scale =
    sum(pairs.map((pair) => letterCount(pair.romaji))) /
    Math.max(1, sum(pairs.map((pair) => romajiLength(pair.sung))))
  const best = new Float64Array((rows + 1) * width)
  const steps: Step[] = new Array<Step>((rows + 1) * width)
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= cols; j++) {
      if (i === 0 && j === 0) continue
      const at = i * width + j
      let score = -1
      let step: Step = { kind: 'skipShown' }
      if (i > 0 && (best[at - width] ?? 0) > score) {
        score = best[at - width] ?? 0
        step = { kind: 'skipShown' }
      }
      if (j > 0 && (best[at - 1] ?? 0) > score) {
        score = best[at - 1] ?? 0
        step = { kind: 'skipTheirs' }
      }
      const line = shown[i - 1]
      if (i > 0 && j > 0 && line !== undefined) {
        const one = matchScore(line, pairs[j - 1]?.sung ?? '')
        if (one > 0 && (best[at - width - 1] ?? 0) + one > score) {
          score = (best[at - width - 1] ?? 0) + one
          step = { kind: 'match', span: 1 }
        }
        if (j > 1) {
          // Counts twice: it covers two of their lines.
          const two = 2 * matchScore(line, `${pairs[j - 2]?.sung ?? ''}${pairs[j - 1]?.sung ?? ''}`)
          if (two > 0 && (best[at - width - 2] ?? 0) + two > score) {
            score = (best[at - width - 2] ?? 0) + two
            step = { kind: 'match', span: 2 }
          }
        }
        for (let lines = 2; lines <= Math.min(MAX_SPLIT, i); lines++) {
          const pair = pairs[j - 1]
          const covered = shown.slice(i - lines, i)
          // A stanza gap (or a lone mark) has nothing sung to take a piece of the romaji.
          if (covered.some((line) => normalize(line) === '')) continue
          // Counts once per shown line, as if each were matched on its own.
          const alike = matchScore(covered.join(''), pair?.sung ?? '')
          const inside = covered.every((line) => foundIn(line, pair?.sung ?? '') >= MIN_PIECE_FOUND)
          const split = alike >= MIN_SPLIT_SIMILARITY && inside ? lines * alike : 0
          const from = best[(i - lines) * width + j - 1] ?? 0
          if (split <= 0 || from + split <= score) continue
          const pieces = splitRomaji(covered, pair?.romaji ?? '', scale)
          if (!pieces) continue
          score = from + split
          step = { kind: 'split', lines, pieces }
        }
      }
      best[at] = score
      steps[at] = step
    }
  }

  const romaji = shown.map(() => '')
  let matched = 0
  let i = rows
  let j = cols
  while (i > 0 || j > 0) {
    const step = steps[i * width + j]
    if (!step || step.kind === 'skipShown') {
      i -= 1
    } else if (step.kind === 'skipTheirs') {
      j -= 1
    } else if (step.kind === 'split') {
      step.pieces.forEach((piece, k) => {
        romaji[i - step.lines + k] = piece
      })
      matched += step.lines
      i -= step.lines
      j -= 1
    } else {
      const parts = pairs.slice(j - step.span, j).map((pair) => pair.romaji)
      romaji[i - 1] = parts.join(' ')
      matched += 1
      i -= 1
      j -= step.span
    }
  }
  return matched > 0 ? romaji : null
}
