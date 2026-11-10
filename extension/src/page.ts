// Pure helpers for reading YouTube Music and choosing a tab; no DOM or browser APIs here, so
// they run in unit tests.
import {
  isArtworkUrl,
  type AppMessage,
  type PageCommand,
  type PageState,
  type RepeatSetting
} from '../../src/main/services/music/extension-ws/protocol'

const REPEAT_ORDER: readonly RepeatSetting[] = ['off', 'all', 'one']
/** A position this far from where the last report said we'd be is a seek, worth sending. */
const SEEK_TOLERANCE_SEC = 1.5

/** The repeat button's title: "Repeat off", "Repeat all", "Repeat one" (English UI). */
export function parseRepeatTitle(title: string | null | undefined): RepeatSetting {
  const text = (title ?? '').toLowerCase()
  if (text.endsWith(' one')) return 'one'
  if (text.endsWith(' all')) return 'all'
  return 'off'
}

/** YouTube Music's repeat button steps off → all → one → off. */
export function clicksToRepeat(current: RepeatSetting, target: RepeatSetting): number {
  const from = REPEAT_ORDER.indexOf(current)
  const to = REPEAT_ORDER.indexOf(target)
  return (to - from + REPEAT_ORDER.length) % REPEAT_ORDER.length
}

/** "Artist • Album • 2026" under the title, when the page has no media info yet. */
export function splitByline(byline: string): { artist: string; album: string } {
  const [artist = '', album = ''] = byline.split('•').map((part) => part.trim())
  // A four-digit year in the album slot means there's no album.
  return { artist, album: /^\d{4}$/.test(album) ? '' : album }
}

/** The biggest cover up to 600 px (plenty for the disc), else the biggest there is. */
export function bestArtwork(artwork: readonly { src: string; sizes?: string }[]): string | null {
  const sized = artwork.map((art) => ({
    src: art.src,
    side: Number.parseInt((art.sizes ?? '').split('x')[0] ?? '', 10) || 0
  }))
  const fitting = sized.filter((art) => art.side <= 600).sort((a, b) => b.side - a.side)
  const any = [...sized].sort((a, b) => b.side - a.side)
  return fitting[0]?.src ?? any[0]?.src ?? null
}

/**
 * Whether `next` is news compared with what was last sent `elapsedSec` ago. Position moving
 * at the expected pace isn't; the app counts on from the last report by itself.
 */
/** A queue item's length as YouTube Music writes it ("3:24", "1:02:03"); 0 when it isn't one. */
export function parseQueueDuration(text: string): number {
  const parts = text.trim().split(':')
  if (parts.length < 2 || parts.length > 3 || !parts.every((part) => /^\d{1,2}$/.test(part))) {
    return 0
  }
  return parts.reduce((total, part) => total * 60 + Number(part), 0)
}

/**
 * Where content.ts and the page-world script (queueCovers.ts) meet: content.ts fires this event
 * on a queue row, and the page-world script answers before it returns, writing the row's cover
 * sizes into this attribute.
 */
export const QUEUE_COVER_REQUEST = 'focus-screen-queue-cover'
export const QUEUE_COVER_ATTRIBUTE = 'data-focus-screen-cover'

/** The Up next cover is 3rem across: at most about 150 px (a 48 px rem on a 4K screen). */
const UP_NEXT_COVER_PX = 160

/**
 * A queue row's cover. The row's picture is a 1 px placeholder (a data: URL) until the row has
 * been on screen, which with the player page closed or the tab hidden is never, but its data has
 * every size all along. `sizes` is that data as the page-world script wrote it (untrusted, like
 * everything from the page): the smallest that fills the Up next cover, else the biggest. Without
 * it, the row's own picture once it has loaded.
 */
export function queueCover(sizes: string | null, imgSrc: string): string | null {
  const covers = parseCoverSizes(sizes)
  const fitting = covers
    .filter((art) => art.side >= UP_NEXT_COVER_PX)
    .sort((a, b) => a.side - b.side)
  const any = [...covers].sort((a, b) => b.side - a.side)
  return fitting[0]?.url ?? any[0]?.url ?? (isArtworkUrl(imgSrc) ? imgSrc : null)
}

function parseCoverSizes(raw: string | null): { url: string; side: number }[] {
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((entry: unknown) =>
    isRecord(entry) && typeof entry.url === 'string' && isArtworkUrl(entry.url)
      ? [{ url: entry.url, side: Number.isFinite(entry.width) ? Number(entry.width) : 0 }]
      : []
  )
}

/** One place in YouTube Music's queue: enough to tell which song comes next. */
export interface QueueSlot {
  /** The one playing now. */
  selected: boolean
  /** Added by autoplay ("automix") after the queue's own songs; only plays with autoplay on. */
  automix: boolean
}

/**
 * Where in the queue the song after the selected one is: the next place (an autoplay one only
 * while autoplay is on), the first again at the end when repeating the queue, and null when
 * repeating this song or when the queue doesn't say which song is playing.
 */
export function upNextIndex(
  slots: readonly QueueSlot[],
  autoplay: boolean,
  repeat: RepeatSetting
): number | null {
  if (repeat === 'one') return null
  const current = slots.findIndex((slot) => slot.selected)
  if (current < 0) return null
  const following = slots[current + 1]
  if (following && (!following.automix || autoplay)) return current + 1
  return repeat === 'all' && current > 0 ? 0 : null
}

export function stateChanged(
  last: PageState | null | undefined,
  next: PageState | null,
  elapsedSec: number
): boolean {
  if (last === undefined) return true
  if (last === null || next === null) return last !== next
  const { positionSec: lastPosition, ...lastRest } = last
  const { positionSec: nextPosition, ...nextRest } = next
  if (JSON.stringify(lastRest) !== JSON.stringify(nextRest)) return true
  const expected = lastPosition + (last.playing ? elapsedSec : 0)
  return Math.abs(nextPosition - expected) > SEEK_TOLERANCE_SEC
}

export interface TabEntry {
  state: PageState | null
  /** When the tab last reported, in ms. */
  at: number
}

/**
 * Which YouTube Music tab to show when several are open: one that's playing (keeping the
 * current one if it is), else the current one, else the one that reported last.
 */
export function chooseTab(
  tabs: ReadonlyMap<number, TabEntry>,
  current: number | null
): number | null {
  const withSong = [...tabs].filter(([, entry]) => entry.state !== null)
  const playing = withSong.filter(([, entry]) => entry.state?.playing)
  if (playing.some(([id]) => id === current)) return current
  if (playing[0]) return playing[0][0]
  if (withSong.some(([id]) => id === current)) return current
  const latest = withSong.sort(([, a], [, b]) => b.at - a.at)[0]
  return latest ? latest[0] : null
}

/** What the lyrics reader remembers between looks at YouTube Music's lyrics panel. */
export interface LyricsWatch {
  /** The song it's watching (video id, or title and artist); undefined before the first. */
  song: string | undefined
  /** The words the panel held when the song changed: the last song's, never this one's. */
  stale: string | null
  /** Words seen for this song and since when: they're sent once they hold still. */
  seen: { text: string; at: number } | null
  /** Words already sent for this song. */
  sent: string | null
}

export const NEW_LYRICS_WATCH: LyricsWatch = {
  song: undefined,
  stale: null,
  seen: null,
  sent: null
}

/** Words must stay the same this long before they're sent: a panel half drawn isn't the lyrics. */
const LYRICS_STEADY_MS = 1000

/**
 * One look at the lyrics panel: `panel` is the words it holds, on screen or not, and `shown`
 * whether it's on screen. The panel keeps the last song's words for a while after a song
 * changes (indefinitely while the player is collapsed), so only words that are on screen, aren't
 * the ones it held at the change, and hold still are this song's. None is better than another
 * song's.
 */
export function watchLyrics(
  watch: LyricsWatch,
  song: string,
  panel: string | null,
  shown: boolean,
  now: number
): { watch: LyricsWatch; send: string | null } {
  // The first song is the page just loaded, so whatever's there is already its own.
  const current: LyricsWatch =
    song === watch.song
      ? watch
      : { song, stale: watch.song === undefined ? null : panel, seen: null, sent: null }
  if (!shown || !panel || panel === current.stale || panel === current.sent) {
    return { watch: { ...current, seen: null }, send: null }
  }
  if (current.seen?.text !== panel) {
    return { watch: { ...current, seen: { text: panel, at: now } }, send: null }
  }
  if (now - current.seen.at < LYRICS_STEADY_MS) return { watch: current, send: null }
  return { watch: { ...current, seen: null, sent: panel }, send: panel }
}

/** "Source: Musixmatch" (or "提供元：Musixmatch"): the name after the colon, whatever the language. */
export function lyricsCredit(footer: string): string | null {
  const name = footer.split(/[:：]/).pop()?.trim() ?? ''
  return name === '' ? null : name.slice(0, 60)
}

/** A line to the background that stayed open this long was taken; one that closed sooner wasn't. */
const LINE_HEALTHY_MS = 5000
const LINE_RETRY_MIN_MS = 1000
const LINE_RETRY_MAX_MS = 30_000

/**
 * How long to wait before reopening the line to the background, after one that stayed open
 * `openMs` and a previous wait of `lastWaitMs`. A line that held is reopened at once: waiting
 * on a timer is what fails in a hidden tab. One that keeps closing straight away backs off.
 */
export function lineRetryMs(openMs: number, lastWaitMs: number): number {
  if (openMs >= LINE_HEALTHY_MS) return 0
  return Math.min(Math.max(lastWaitMs * 2, LINE_RETRY_MIN_MS), LINE_RETRY_MAX_MS)
}

/** Base64 for a cover, in chunks so big images don't overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCommand(raw: unknown): PageCommand | null {
  if (!isRecord(raw)) return null
  switch (raw.kind) {
    case 'playPause':
    case 'next':
    case 'previous':
    case 'restart':
      return { kind: raw.kind }
    case 'setShuffle':
      return typeof raw.on === 'boolean' ? { kind: 'setShuffle', on: raw.on } : null
    case 'setRepeat':
      return raw.mode === 'off' || raw.mode === 'all' || raw.mode === 'one'
        ? { kind: 'setRepeat', mode: raw.mode }
        : null
    case 'seek':
      return typeof raw.positionSec === 'number' &&
        Number.isFinite(raw.positionSec) &&
        raw.positionSec >= 0
        ? { kind: 'seek', positionSec: raw.positionSec }
        : null
    default:
      return null
  }
}

/** A message from whatever answered on the app's port; only the known shapes pass. */
export function parseAppMessage(raw: unknown): AppMessage | null {
  if (!isRecord(raw)) return null
  switch (raw.type) {
    case 'welcome':
    case 'keepalive':
      return { type: raw.type }
    case 'paired':
      return typeof raw.token === 'string' && raw.token.length > 0
        ? { type: 'paired', token: raw.token }
        : null
    case 'rejected':
      return raw.reason === 'badToken' || raw.reason === 'badCode' || raw.reason === 'version'
        ? { type: 'rejected', reason: raw.reason }
        : null
    case 'command': {
      const command = parseCommand(raw.command)
      return command ? { type: 'command', command } : null
    }
    case 'artworkRequest':
      return typeof raw.requestId === 'number' && typeof raw.url === 'string'
        ? { type: 'artworkRequest', requestId: raw.requestId, url: raw.url }
        : null
    default:
      return null
  }
}
