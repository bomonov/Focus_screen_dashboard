import type { SecretStore } from '../../secrets/store'
import type { BrowserLink } from '../../status/cardStatus'
import type { MusicAdapter, PlayerInfo, PlayerReport } from '../adapter'
import { AD_TRACK_ID, type PlayerId } from '../types'
import { createDropGrace, type DropGrace } from './dropGrace'
import { createPairingCodes } from './pairing'
import type { BrowserKind } from './parse'
import { EXTENSION_PORT, type PageState } from './protocol'
import { SECRET_FOR, startExtensionServer, type ExtensionServer } from './server'

/** Pages only speak up when something changes; this keeps their readings fresh in between. */
const REPORT_INTERVAL_MS = 1000
/**
 * How long a browser's last reading stands after its connection drops. Safari sleeps its
 * extension every minute or so while music is paused, and it was seen taking up to ~30 s to be
 * woken by the page and reconnect. A closed tab doesn't wait: the extension reports that itself.
 */
const RECONNECT_GRACE_MS = 45_000

const PLAYER_FOR: Record<BrowserKind, PlayerId> = { chrome: 'ytmChrome', safari: 'ytmSafari' }
const BROWSERS: readonly { kind: BrowserKind; name: BrowserLink['name'] }[] = [
  { kind: 'safari', name: 'Safari' },
  { kind: 'chrome', name: 'Chrome' }
]

function browserFor(player: PlayerId): BrowserKind | null {
  if (player === 'ytmChrome') return 'chrome'
  if (player === 'ytmSafari') return 'safari'
  return null
}

const PLAYERS: readonly PlayerInfo[] = [
  { id: 'ytmChrome', name: 'YouTube Music', repeatModes: ['off', 'all', 'one'] },
  { id: 'ytmSafari', name: 'YouTube Music', repeatModes: ['off', 'all', 'one'] }
]

const epochSeconds = (): number => Date.now() / 1000

/** Lyrics YouTube Music showed are kept for the last this many songs: plenty to find them by. */
const PAGE_LYRICS_KEPT = 30

/** The app's id for a YouTube Music song: its video id, or its title and artist without one. */
export function pageTrackId(song: {
  videoId: string | null
  title: string
  artist: string
}): string {
  return song.videoId ? `ytm:${song.videoId}` : `ytm:${song.title}\n${song.artist}`
}

/** Words YouTube Music showed for a song, and who it credits for them. */
export interface PageLyricsText {
  text: string
  credit: string | null
}

/** A page's state as a player reading at `now`, counting on from when the page sent it. */
export function pageReport(
  player: PlayerId,
  state: PageState | null,
  sentAt: number,
  now: number
): PlayerReport {
  if (!state) return { player, at: now, kind: 'closed' }
  const elapsed = state.playing ? Math.max(0, now - sentAt) : 0
  const moved = state.positionSec + elapsed
  const positionSec = state.durationSec > 0 ? Math.min(moved, state.durationSec) : moved
  const track = state.ad
    ? {
        id: AD_TRACK_ID,
        title: 'Ad',
        artist: 'YouTube Music',
        album: '',
        durationSec: state.durationSec,
        artworkRef: null
      }
    : {
        id: pageTrackId(state),
        title: state.title,
        artist: state.artist,
        album: state.album,
        durationSec: state.durationSec,
        artworkRef: state.artworkUrl
      }
  return {
    player,
    at: now,
    kind: 'open',
    snapshot: {
      status: state.playing ? 'playing' : 'paused',
      track,
      positionSec,
      shuffle: state.shuffle ?? false,
      repeat: state.repeat,
      playlistId: state.playlistId ?? null,
      next:
        !state.ad && state.next
          ? {
              title: state.next.title,
              artist: state.next.artist,
              durationSec: state.next.durationSec,
              artworkRef: state.next.artworkUrl
            }
          : null
    }
  }
}

export interface ExtensionAdapter extends MusicAdapter {
  /** A six-digit code for the extension's popup; the user types it in to connect a browser. */
  startPairing(): string
  /** Each browser's link to the app, for the music card's status dot. */
  links: {
    get(): BrowserLink[]
    subscribe(listener: () => void): () => void
  }
  /** Lyrics YouTube Music showed in its Lyrics tab, by song id (`Track.id`). */
  pageLyrics: {
    get(trackId: string): PageLyricsText | null
    /** Called with the song's id whenever lyrics for it arrive. */
    subscribe(listener: (trackId: string) => void): () => void
  }
}

export interface ExtensionAdapterOptions {
  secrets: SecretStore
  port?: number
  now?: () => number
}

/** YouTube Music in Chrome and Safari, through our browser extension. Works on any OS. */
export function createExtensionAdapter({
  secrets,
  port = EXTENSION_PORT,
  now = epochSeconds
}: ExtensionAdapterOptions): ExtensionAdapter {
  const pairing = createPairingCodes()
  const latest = new Map<BrowserKind, { state: PageState | null; at: number }>()
  const summaries = new Map<BrowserKind, string>()
  let server: ExtensionServer | null = null
  let ticker: ReturnType<typeof setInterval> | undefined
  let grace: DropGrace<BrowserKind> | null = null
  const pageLyrics = new Map<string, PageLyricsText>()
  const lyricsListeners = new Set<(trackId: string) => void>()
  const linked = new Map<BrowserKind, 'connected' | 'reconnecting'>()
  const linkListeners = new Set<() => void>()
  /** Read once: a browser that pairs later says so by connecting. */
  let paired: Set<BrowserKind> | null = null
  const isPaired = (browser: BrowserKind): boolean => {
    paired ??= new Set(BROWSERS.map((b) => b.kind).filter((b) => secrets.get(SECRET_FOR[b])))
    return paired.has(browser)
  }
  const setLink = (browser: BrowserKind, link: 'connected' | 'reconnecting' | null): void => {
    if ((linked.get(browser) ?? null) === link) return
    if (link) linked.set(browser, link)
    else linked.delete(browser)
    if (link === 'connected') paired?.add(browser)
    for (const listener of linkListeners) listener()
  }

  return {
    players: PLAYERS,
    start(onReport) {
      const emit = (browser: BrowserKind): void => {
        const entry = latest.get(browser)
        if (entry) onReport(pageReport(PLAYER_FOR[browser], entry.state, entry.at, now()))
      }
      const dropGrace = createDropGrace<BrowserKind>(RECONNECT_GRACE_MS, (browser) => {
        console.info(`[extension] ${browser} didn’t come back.`)
        setLink(browser, null)
        latest.delete(browser)
        summaries.delete(browser)
        onReport({ player: PLAYER_FOR[browser], at: now(), kind: 'closed' })
      })
      grace = dropGrace
      server = startExtensionServer({
        port,
        secrets,
        pairing,
        now,
        onState(browser, state) {
          dropGrace.back(browser)
          setLink(browser, 'connected')
          const summary = state ? (state.playing ? 'playing' : 'paused') : 'no song'
          // On change only, and without song details: enough to see what a browser is sending.
          if (summaries.get(browser) !== summary)
            console.info(`[extension] ${browser}: ${summary}.`)
          summaries.set(browser, summary)
          latest.set(browser, { state, at: now() })
          emit(browser)
        },
        onLyrics(_browser, lyrics) {
          const id = pageTrackId(lyrics)
          // Maps keep insertion order: re-adding makes it the newest, and the oldest goes first.
          pageLyrics.delete(id)
          pageLyrics.set(id, { text: lyrics.text, credit: lyrics.source })
          if (pageLyrics.size > PAGE_LYRICS_KEPT) {
            const oldest = pageLyrics.keys().next().value
            if (oldest !== undefined) pageLyrics.delete(oldest)
          }
          // Without the song or its words: those stay out of the log.
          console.info('[extension] YouTube Music showed lyrics for the song.')
          for (const listener of lyricsListeners) listener(id)
        },
        onDisconnect(browser) {
          // Until it's back (or the wait runs out), the last reading stands.
          dropGrace.dropped(browser)
          setLink(browser, 'reconnecting')
        }
      })
      ticker = setInterval(() => {
        for (const browser of latest.keys()) emit(browser)
      }, REPORT_INTERVAL_MS)
    },
    async command(player, command) {
      const browser = browserFor(player)
      if (browser) server?.send(browser, command)
      // The page reports the result itself as soon as it changes.
      return null
    },
    async loadArtwork(player, track) {
      const browser = browserFor(player)
      if (!browser || !track.artworkRef || !server) return null
      return server.requestArtwork(browser, track.artworkRef)
    },
    startPairing: () => pairing.create(now()),
    links: {
      get: () =>
        BROWSERS.map(({ kind, name }) => ({
          name,
          paired: isPaired(kind),
          link: linked.get(kind) ?? 'off'
        })),
      subscribe(listener) {
        linkListeners.add(listener)
        return () => linkListeners.delete(listener)
      }
    },
    pageLyrics: {
      get: (trackId) => pageLyrics.get(trackId) ?? null,
      subscribe(listener) {
        lyricsListeners.add(listener)
        return () => lyricsListeners.delete(listener)
      }
    },
    dispose() {
      clearInterval(ticker)
      grace?.dispose()
      grace = null
      server?.close()
      server = null
      latest.clear()
      linked.clear()
      linkListeners.clear()
      pageLyrics.clear()
      lyricsListeners.clear()
    }
  }
}
