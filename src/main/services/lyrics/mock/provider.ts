// Lyrics for the dev demo player's made-up songs, so `npm run dev` shows every lyrics state
// without a network: synced (Low Sun Hours), plain (Monsoon Drive), instrumental (Quiet Library),
// and Japanese with romaji and a line timed word by word (星空レター), for the sung line's pops,
// held notes and romaji following along, and colored for two singers: Ichika and Miku, with a duet
// word, a line for everyone and a second voice. The words are written for this demo.
import { parseLrc, parsePlainLyrics } from '../lrc'
import type { LyricsProvider } from '../provider'
import type { CodedLine, CodedWord, SingerRef, SongColors } from '../singers/types'
import { normalize } from '../text'
import type { Lyrics, SyncedLine } from '../types'

const LOW_SUN_HOURS = `
[00:12.00]Porch light flickers at the edge of town
[00:17.50]Shadows getting longer as the sun goes down
[00:23.00]Coffee in a paper cup, still warm in my hands
[00:28.50]Saving every minute of the daylight that I can
[00:34.00]
[00:38.00]Oh, these low sun hours
[00:42.50]Painting every window gold
[00:47.00]Oh, these low sun hours
[00:51.50]Stay a little longer, don't let go
[00:57.00]
[01:06.00]Highway hums a song I almost know
[01:11.50]Saguaros standing in the afterglow
[01:17.00]Every mile marker counting down the light
[01:22.50]We keep driving till we lose the night
[01:28.00]Radio is fading into static and the stars
[01:33.50]But I can still hear you from where you are
[01:39.00]
[01:42.00]Oh, these low sun hours
[01:46.50]Painting every window gold
[01:51.00]Oh, these low sun hours
[01:55.50]Stay a little longer, don't let go
[02:01.00]
[02:16.00]And when the dark comes rolling in
[02:21.50]I'll keep the warm light on my skin
[02:27.00]Hold it like a secret, hold it like a vow
[02:32.50]There's nowhere I would rather be than now
[02:38.00]
[02:42.00]Oh, these low sun hours
[02:46.50]Painting every window gold
[02:51.00]Oh, these low sun hours
[02:55.50]Stay a little longer
[03:00.00]Stay a little longer, don't let go
[03:06.00]
`

const MONSOON_DRIVE = `
Clouds stack up like mountains in the east
Dust devils spinning out across the street
Windows down, we're racing the first drop
Radio says it's coming, but we never stop

Monsoon drive, thunder on the line
Lightning writes your name across the sky
Monsoon drive, nothing on our minds
Just the rain and you and me tonight

Wet asphalt and headlights on the glass
Every flooded wash we wait to pass
Wipers keeping time like a slow drum
We'll be dry again when morning comes

Monsoon drive, thunder on the line
Lightning writes your name across the sky
Monsoon drive, nothing on our minds
Just the rain and you and me tonight
`

const HOSHIZORA_LETTER = `
[00:06.00]夜の駅で 君を待ってた
[00:11.50]砂漠の風が やさしく吹いた
[00:17.00]ありがとう 永遠に 星空の下で
[00:23.00]Stay with me tonight
[00:28.00]
[00:36.00]まだ終わらない夢の続きを君と一緒に探しに行こう
[00:42.50]ひとりじゃないよ ずっとそばにいる
[00:48.00]もう一度 歌おう
[00:53.00]
[01:10.00]光の中で 手を伸ばした
[01:15.50]ありがとう 永遠に 星空の下で
[01:21.50]Stay with me tonight
[01:27.00]
`

/** Its romaji, by line. */
const HOSHIZORA_ROMAJI = new Map([
  ['夜の駅で 君を待ってた', 'yoru no eki de kimi wo matteta'],
  ['砂漠の風が やさしく吹いた', 'sabaku no kaze ga yasashiku fuita'],
  ['ありがとう 永遠に 星空の下で', 'arigatou eien ni hoshizora no shita de'],
  [
    'まだ終わらない夢の続きを君と一緒に探しに行こう',
    'mada owaranai yume no tsuzuki wo kimi to issho ni sagashi ni ikou'
  ],
  ['ひとりじゃないよ ずっとそばにいる', 'hitori ja nai yo zutto soba ni iru'],
  ['もう一度 歌おう', 'mou ichido utaou'],
  ['光の中で 手を伸ばした', 'hikari no naka de te wo nobashita']
])

/** The English line, timed word by word as auto-sync would: "tonight" held 2.8 s. */
const STAY_WORDS: readonly (readonly [string, number, number])[] = [
  ['Stay ', 0, 0.45],
  ['with ', 0.45, 0.8],
  ['me ', 0.8, 1.3],
  ['tonight', 1.3, 4.1]
]

function withStayWords(lines: SyncedLine[]): SyncedLine[] {
  return lines.map((line) =>
    line.text === 'Stay with me tonight'
      ? {
          ...line,
          words: STAY_WORDS.map(([text, from, to]) => ({
            text,
            start: line.timeSec + from,
            end: line.timeSec + to
          }))
        }
      : line
  )
}

const ICHIKA: SingerRef = ['ichika']
const MIKU: SingerRef = ['miku']
const BOTH: SingerRef = ['ichika', 'miku']

type Part = readonly [text: string, singers: SingerRef]

/**
 * Who sings what in 星空レター, for each line that has words (breaks have none), in order. A line
 * for everyone keeps the words it already has; the others are cut here, and their parts must
 * make up the line exactly (the coding is matched to the lyrics by their text).
 */
const HOSHIZORA_PARTS: readonly (readonly Part[] | 'everyone')[] = [
  [
    ['夜の駅で ', ICHIKA],
    ['君を待ってた', ICHIKA]
  ],
  [
    ['砂漠の風が ', MIKU],
    ['やさしく吹いた', MIKU]
  ],
  [
    ['ありがとう ', BOTH],
    ['永遠に ', ICHIKA],
    ['星空の下で', MIKU]
  ],
  'everyone',
  [
    ['まだ終わらない夢の続きを', ICHIKA],
    ['君と一緒に探しに行こう', MIKU]
  ],
  [
    ['ひとりじゃないよ ', MIKU],
    ['ずっとそばにいる', ICHIKA]
  ],
  [
    ['もう一度 ', ICHIKA],
    ['歌おう', MIKU]
  ],
  [
    ['光の中で ', MIKU],
    ['手を伸ばした', MIKU]
  ],
  [
    ['ありがとう ', ICHIKA],
    ['永遠に ', ICHIKA],
    ['星空の下で', ICHIKA]
  ],
  'everyone'
]
/**
 * The line (counting those with words) whose last word a second voice echoes, in Ichika's,
 * held a second into the line after it.
 */
const ECHOED_LINE = 2

const roundTo10ms = (sec: number): number => Math.round(sec * 100) / 100

/** The parts one after another between `start` and `end`, each as long as its characters. */
function spreadParts(parts: readonly Part[], start: number, end: number): CodedWord[] {
  const weights = parts.map(([text]) => Math.max(1, [...text.trim()].length))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let from = start
  return parts.map(([text, singers], i) => {
    const last = i === parts.length - 1
    const to = last
      ? end
      : Math.min(end, roundTo10ms(from + ((end - start) * (weights[i] ?? 1)) / total))
    const word: CodedWord = { text, start: from, end: to, singers }
    from = to
    return word
  })
}

/**
 * The coding for the demo's own lines, so it matches their text and sits in their time. A line
 * that doesn't add up (the lyrics were changed under it) is left out, never miscolored.
 */
function hoshizoraColors(lines: readonly SyncedLine[]): SongColors {
  const coded: CodedLine[] = []
  let sung = -1
  lines.forEach((line, i) => {
    if (line.text === '') return
    sung += 1
    const parts = HOSHIZORA_PARTS[sung]
    if (!parts) return
    const start = line.timeSec
    // Sung up to the break (or the next line) with a breath before it.
    const next = lines[i + 1]?.timeSec ?? start + 5
    let end = Math.min(next - 0.4, start + 4.5)
    let words: CodedWord[]
    if (parts === 'everyone') {
      words = (line.words ?? [{ text: line.text, start, end }]).map((word) => ({
        text: word.text,
        start: word.start,
        end: word.end,
        singers: 'everyone'
      }))
      end = Math.max(end, words.at(-1)?.end ?? end)
    } else if (parts.map(([text]) => text).join('') === line.text) {
      words = spreadParts(parts, start, end)
    } else return
    // As if the user had timed it: the demo shows a coding at its own times.
    coded.push({ text: line.text, start, end, words, timed: true })

    const echoed = words.at(-1)
    if (sung === ECHOED_LINE && echoed) {
      // Overlapping the end of the line it echoes, and running on a second into the next one,
      // so it shows a voice lit past its own line's time.
      const from = roundTo10ms(end - 0.8)
      const to = roundTo10ms(next + 1)
      coded.push({
        text: echoed.text,
        start: from,
        end: to,
        words: [{ text: echoed.text, start: from, end: to, singers: ICHIKA }],
        under: coded.length - 1,
        timed: true
      })
    }
  })
  return { version: 1, lines: coded, cast: ['ichika', 'miku'], extra: [] }
}

function demoLyrics(): Map<string, Lyrics> {
  const songs = new Map<string, Lyrics>()
  const synced = parseLrc(LOW_SUN_HOURS)
  const plain = parsePlainLyrics(MONSOON_DRIVE)
  if (synced)
    songs.set(normalize('Low Sun Hours'), { kind: 'synced', lines: synced, source: 'demo' })
  if (plain) songs.set(normalize('Monsoon Drive'), { kind: 'plain', lines: plain, source: 'demo' })
  songs.set(normalize('Quiet Library'), { kind: 'instrumental', source: 'demo' })
  const japanese = parseLrc(HOSHIZORA_LETTER)
  if (japanese) {
    songs.set(normalize('星空レター'), {
      kind: 'synced',
      lines: withStayWords(japanese),
      source: 'demo'
    })
  }
  return songs
}

export function createDemoLyricsProvider(): LyricsProvider {
  const songs = demoLyrics()
  const hoshizora = songs.get(normalize('星空レター'))
  const hoshizoraCoding = hoshizora?.kind === 'synced' ? hoshizoraColors(hoshizora.lines) : null
  return {
    cacheable: false,
    async lookup(query) {
      const lyrics = songs.get(normalize(query.coreTitle))
      return lyrics ? { kind: 'found', lyrics } : { kind: 'notFound' }
    },
    romaji(query, lines) {
      const lyrics = songs.get(normalize(query.coreTitle))
      if (normalize(query.coreTitle) !== normalize('星空レター') || lyrics?.kind !== 'synced') {
        return null
      }
      return lines.map((line) => HOSHIZORA_ROMAJI.get(line) ?? '')
    },
    colors(query) {
      return normalize(query.coreTitle) === normalize('星空レター') ? hoshizoraCoding : null
    }
  }
}
