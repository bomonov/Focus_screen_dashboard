// How long a piece of a lyric line sounds, for sharing a line's time between its words when nobody
// timed them: by syllables, not letters ("through" is one, "city" two), and in Japanese by beats
// (a kana is one, a kanji usually two). Japanese has no spaces between words, so a line is split
// into words first, with the browser's own Japanese word breaker.

const KANJI = /[㐀-䶿一-鿿々]/
const SMALL_KANA = /[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]/
const KANA = /[ぁ-ゟ゠-ヿ]/
const HIRAGANA_ONLY = /^[ぁ-ゟ]+$/
const CJK = /[぀-ヿ㐀-䶿一-鿿々]/
const LATIN = /\p{Script=Latin}/u
const HANGUL = /\p{Script=Hangul}/u

/** Vowel sounds in a run of Latin letters: groups of vowels, less a silent final "e". */
export function syllables(word: string): number {
  const letters = word.toLowerCase().replace(/[^\p{L}]/gu, '')
  if (letters === '') return 0
  const groups = letters.match(/[aeiouyàáâäèéêëìíîïòóôöùúûü]+/g) ?? []
  const silentE = groups.length > 1 && /[^aeiouy]e$/.test(letters)
  return Math.max(1, groups.length - (silentE ? 1 : 0))
}

/** Beats in Japanese: a kanji about two, a kana one (the long-vowel mark too), a small kana half. */
export function beats(piece: string): number {
  let total = 0
  for (const char of piece) {
    if (KANJI.test(char)) total += 2
    else if (SMALL_KANA.test(char)) total += 0.5
    else if (KANA.test(char)) total += 1
  }
  return total
}

type Kind = 'cjk' | 'latin' | 'hangul' | 'digit' | 'letter' | 'none'

function kindOf(char: string): Kind {
  if (CJK.test(char)) return 'cjk'
  if (LATIN.test(char)) return 'latin'
  if (HANGUL.test(char)) return 'hangul'
  if (/\p{N}/u.test(char)) return 'digit'
  if (/\p{L}/u.test(char)) return 'letter'
  return 'none'
}

/** How long a piece sounds, in beats or syllables; punctuation counts for nothing, a piece at least 1. */
export function soundWeight(piece: string): number {
  let total = 0
  let run = ''
  let runKind: Kind = 'none'
  const flush = (): void => {
    if (runKind === 'cjk') total += beats(run)
    else if (runKind === 'latin') total += syllables(run)
    else if (runKind !== 'none') total += [...run].length
    run = ''
  }
  const chars = [...piece]
  chars.forEach((char, i) => {
    // An apostrophe inside or before an English word ("don't", "'cause") is part of it.
    const next = chars[i + 1] ?? ''
    const kind = /['’]/.test(char) && LATIN.test(next) ? 'latin' : kindOf(char)
    if (kind !== runKind) {
      flush()
      runKind = kind
    }
    run += char
  })
  flush()
  return Math.max(1, total)
}

/** Hiragana that end a word or follow it: particles, verb and adjective endings. */
const ENDINGS = new Set([
  'の',
  'に',
  'を',
  'が',
  'は',
  'で',
  'と',
  'も',
  'へ',
  'や',
  'よ',
  'ね',
  'な',
  'か',
  'わ',
  'さ',
  'ぞ',
  'ぜ',
  'た',
  'て',
  'って',
  'だ',
  'です',
  'ます',
  'ない',
  'ず',
  'ぬ',
  'う',
  'る',
  'から',
  'まで',
  'より',
  'けど',
  'だけ',
  'しか',
  'ば',
  'たい',
  'たら',
  'なら',
  'よね',
  'かな',
  'じゃ',
  'てる',
  'ている',
  'てた',
  'ちゃう',
  'じゃう',
  'した',
  'ました',
  'ません',
  'れる',
  'れない',
  'られる'
])
/** A long-vowel mark or small kana can't start a word: it belongs to the sound before it. */
const LEANS_BACK = /^[ーァィゥェォッャュョヮぁぃぅぇぉっゃゅょゎ]/
const ENDS_IN_KANA = /[\u3041-\u309fー]$/

const segmenter =
  typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ja', { granularity: 'word' }) : null

/** Pieces from the word breaker, or (without one) wherever kanji or katakana follows kana. */
function rawPieces(text: string): { text: string; wordLike: boolean }[] {
  if (segmenter) {
    return [...segmenter.segment(text)].map((part) => ({
      text: part.segment,
      wordLike: part.isWordLike ?? true
    }))
  }
  return (text.match(/[ぁ-ゟ]+|[^ぁ-ゟ]+/g) ?? []).map((part) => ({
    text: part,
    wordLike: true
  }))
}

/**
 * A Japanese run split into words: the word breaker's pieces, with particles and endings (and
 * punctuation) joined to the word before, and the kana after a kanji joined to it, so a line reads
 * まだ · 終わらない · 夢の · 続きを. Joined together they're always the input.
 */
export function japaneseWords(text: string): string[] {
  const words: string[] = []
  // Punctuation before any word (an opening 「) waits for the word it opens.
  let opening = ''
  for (const piece of rawPieces(text)) {
    const last = words.at(-1)
    if (last === undefined && !piece.wordLike) {
      opening += piece.text
      continue
    }
    // The word breaker cuts some words into single kana (忘れ·ら·れ·ない): one kana after kana
    // is still the same word.
    const lone = HIRAGANA_ONLY.test(piece.text) && [...piece.text].length === 1
    const joins =
      last !== undefined &&
      (!piece.wordLike ||
        LEANS_BACK.test(piece.text) ||
        (lone && ENDS_IN_KANA.test(last)) ||
        (HIRAGANA_ONLY.test(piece.text) &&
          (ENDINGS.has(piece.text) || KANJI.test(last.at(-1) ?? ''))))
    if (joins) words[words.length - 1] = last + piece.text
    else words.push(opening + piece.text)
    opening = ''
  }
  if (opening) words.push(opening)
  return words
}

/** Whether there's Japanese (or Chinese) in it, to split into words. */
export function hasCjk(text: string): boolean {
  return CJK.test(text)
}
