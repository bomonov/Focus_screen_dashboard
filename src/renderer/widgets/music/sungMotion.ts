// How the sung line moves as it lights, after Spicy Lyrics' look (rebuilt here, none of its code):
// each word pops (rises, swells, glows) as its light starts, and a word held long swells letter by
// letter. Pure: timings and keyframes only; LyricsPanel draws them on the song's clock. Nothing
// here loops: each pop and swell happens once.
import type { SyncedWord } from '../../../main/ipc'
import { hasCjk, japaneseWords } from './wordWeights'

/** A word real timings stretch over this long is held: its letters swell one after another. */
export const HELD_SEC = 1.2
/** How long a pop takes, whatever the word's length: up by 0.28 s, settled by 0.9 s. */
export const POP_SEC = 0.9
/** How long a held letter's swell takes: up by 0.45 s, settled 1.1 s later. */
export const SWELL_SEC = 1.55
/** A Japanese word longer than this is drawn letter by letter, so it can still wrap. */
const MAX_UNBROKEN = 8

/** The glow's colors from the theme: at the pop's peak, and kept faintly once sung. */
export interface PopGlow {
  peak: string
  rest: string
}

export function holdStrength(spanSec: number): number {
  return Math.min(1, Math.max(0, (spanSec - 1) / 2))
}

/** Held: only real timings say so. A guessed word's length is a guess, not a long note. */
export function isHeld(word: SyncedWord, timed: boolean): boolean {
  return timed && word.end - word.start >= HELD_SEC
}

const segmenter =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

/** Letters as they're seen: an accent or an emoji with its skin tone stays one letter. */
export function graphemes(text: string): string[] {
  return segmenter ? [...segmenter.segment(text)].map((part) => part.segment) : [...text]
}

/**
 * A word's letters as drawn letter by letter: a space inside it (the aligner joins a word it
 * can't hear to the one before, "got 99") stays plain text, since an empty box has no width.
 */
export function letterBoxes(core: string): { text: string; boxed: boolean }[] {
  return graphemes(core).map((text) => ({ text, boxed: !/^\s+$/.test(text) }))
}

/** Letter by letter: a held word, or a Japanese word too long to wrap as one box. */
export function drawnByLetter(word: SyncedWord, timed: boolean): boolean {
  if (isHeld(word, timed)) return true
  const core = word.text.trim()
  return hasCjk(core) && graphemes(core).length > MAX_UNBROKEN
}

/** The spaces around a word, kept out of its box so they stay between words. */
export function splitSpaces(text: string): { before: string; core: string; after: string } {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)
  return { before: match?.[1] ?? '', core: match?.[2] ?? '', after: match?.[3] ?? '' }
}

/** A word's time shared between its letters by their widths, one after another. */
export function letterTimes(
  word: SyncedWord,
  widths: readonly number[]
): { start: number; end: number }[] {
  const total = widths.reduce((sum, width) => sum + width, 0)
  const span = word.end - word.start
  let at = word.start
  return widths.map((width) => {
    const share = total > 0 ? (span * width) / total : span / widths.length
    const time = { start: at, end: at + share }
    at += share
    return time
  })
}

/** The romaji lights over the line's whole time: its first word's start to its last word's end. */
export function romajiSpan(words: readonly SyncedWord[]): { start: number; end: number } | null {
  const first = words[0]
  const last = words.at(-1)
  return first && last ? { start: first.start, end: last.end } : null
}

/**
 * Which word each one pops with (the index of the group's first). Timed Japanese comes in pieces
 * of a character or two: the pieces that make one word pop together, about one pop at a time.
 */
export function popGroups(words: readonly SyncedWord[]): number[] {
  const groups = words.map((_, i) => i)
  // Japanese pieces with no space between them run on into one another.
  const runsOn = (k: number): boolean => {
    const here = words[k]?.text ?? ''
    const next = words[k + 1]?.text
    return (
      next !== undefined && hasCjk(here) && hasCjk(next) && !/\s$/.test(here) && !/^\s/.test(next)
    )
  }
  for (let i = 0; i < words.length;) {
    let end = i
    while (runsOn(end)) end += 1
    if (end > i) {
      // Where each word of the run's joined text begins, in characters.
      const wordStarts = new Set<number>()
      let at = 0
      for (const found of japaneseWords(joined(words, i, end))) {
        wordStarts.add(at)
        at += found.length
      }
      // A piece belongs to the word holding its first character.
      let offset = 0
      let first = i
      for (let k = i; k <= end; k++) {
        if (wordStarts.has(offset)) first = k
        groups[k] = first
        offset += (words[k]?.text ?? '').length
      }
    }
    i = end + 1
  }
  return groups
}

function joined(words: readonly SyncedWord[], from: number, to: number): string {
  return words
    .slice(from, to + 1)
    .map((word) => word.text)
    .join('')
}

const num = (value: number): string => String(Math.round(value * 1000) / 1000)

const shadow = (blurEm: number, color: string): string =>
  `drop-shadow(0 0 ${num(blurEm)}em ${color})`

/**
 * A word's pop: it waits a touch small and low, rises 0.13 em and swells to 106% within 0.28 s
 * (easing out), then settles to rest by 0.9 s, its glow fading to a faint one.
 */
export function wordPop(glow: PopGlow | null): Keyframe[] {
  const frames: Keyframe[] = [
    {
      offset: 0,
      transform: 'translateY(0.03em) scale(0.97)',
      easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)'
    },
    { offset: 0.311, transform: 'translateY(-0.13em) scale(1.06)', easing: 'ease-in-out' },
    { offset: 1, transform: 'translateY(0em) scale(1)' }
  ]
  if (!glow) return frames
  const filters = [shadow(0.4, 'transparent'), shadow(0.4, glow.peak), shadow(0.4, glow.rest)]
  return frames.map((frame, i) => ({ ...frame, filter: filters[i] }))
}

/**
 * A held letter's swell, from when the light reaches it: up to 108% (116% for a hold of three
 * seconds or more) and 0.1–0.2 em, by 0.45 s, then a slow settle; its glow grows with the hold.
 */
export function letterSwell(strength: number, glow: PopGlow | null): Keyframe[] {
  const scale = 1.08 + 0.08 * strength
  const lift = 0.1 + 0.1 * strength
  const frames: Keyframe[] = [
    {
      offset: 0,
      transform: 'translateY(0.03em) scale(0.97)',
      easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)'
    },
    {
      offset: 0.29,
      transform: `translateY(-${num(lift)}em) scale(${num(scale)})`,
      easing: 'ease-in-out'
    },
    { offset: 1, transform: 'translateY(0em) scale(1)' }
  ]
  if (!glow) return frames
  const blur = 0.4 + 0.2 * strength
  const filters = [shadow(blur, 'transparent'), shadow(blur, glow.peak), shadow(blur, glow.rest)]
  return frames.map((frame, i) => ({ ...frame, filter: filters[i] }))
}
