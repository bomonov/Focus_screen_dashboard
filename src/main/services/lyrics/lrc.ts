import type { SyncedLine } from './types'

/** `[01:23.45]`, `[01:23]`, `[01:23.456]`, and the `[01:23:45]` some files use. */
const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const LEADING_TIME_TAGS = /^(?:\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+/
const OFFSET_TAG = /^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/i
/** Word timings in "enhanced" LRC: `<01:23.45>`. We highlight whole lines only. */
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g

function tagSeconds(minutes: string, seconds: string, fraction: string | undefined): number {
  // ".5" is half a second and ".05" five hundredths: the digits are a decimal fraction.
  const part = fraction ? Number(`0.${fraction}`) : 0
  return Number(minutes) * 60 + Number(seconds) + part
}

/**
 * Parses LRC into lines sorted by time. A line with several time tags (a repeated chorus)
 * appears once per tag. Null when nothing in the text is timed.
 */
export function parseLrc(text: string): SyncedLine[] | null {
  let offsetSec = 0
  const lines: SyncedLine[] = []

  for (const raw of text.split(/\r?\n/)) {
    const offset = OFFSET_TAG.exec(raw)
    if (offset) {
      // The LRC convention: a positive offset (ms) makes lyrics appear sooner.
      offsetSec = Number(offset[1]) / 1000
      continue
    }
    const tags = LEADING_TIME_TAGS.exec(raw)
    if (!tags) continue
    const lyric = raw.slice(tags[0].length).replace(WORD_TAG, '').replace(/\s+/g, ' ').trim()
    for (const match of tags[0].matchAll(TIME_TAG)) {
      const [, minutes = '0', seconds = '0', fraction] = match
      lines.push({ timeSec: tagSeconds(minutes, seconds, fraction), text: lyric })
    }
  }

  if (lines.length === 0) return null
  // sort is stable, so lines sharing a timestamp keep their order in the file.
  lines.sort((a, b) => a.timeSec - b.timeSec)

  const result: SyncedLine[] = []
  for (const line of lines) {
    const timeSec = Math.max(0, line.timeSec - offsetSec)
    // One break is enough to clear the line on screen; runs of them add nothing.
    if (line.text === '' && (result.length === 0 || result.at(-1)?.text === '')) continue
    result.push({ timeSec, text: line.text })
  }
  return result.some((line) => line.text !== '') ? result : null
}

/** Plain lyrics as display lines: trimmed, with at most one empty line between stanzas. */
export function parsePlainLyrics(text: string): string[] | null {
  const lines: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (line === '' && (lines.length === 0 || lines.at(-1) === '')) continue
    lines.push(line)
  }
  while (lines.at(-1) === '') lines.pop()
  return lines.length > 0 ? lines : null
}
