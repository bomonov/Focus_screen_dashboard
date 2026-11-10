// Messages between the Focus Screen browser extension and the app, shared by both sides.
// Keep this file free of imports (and of Node or Electron APIs): the extension bundles it.

/** Loopback only. Fixed, so the extension finds the app with no setup. */
export const EXTENSION_PORT = 47833
export const PROTOCOL_VERSION = 1

/**
 * Chrome derives an extension's ID from the public key in its manifest; pinning the key pins
 * the ID, so the app can accept exactly our extension. Safari's ID is random per install, so
 * Safari connections are recognized by their scheme and kept honest by the pairing token.
 */
export const CHROME_EXTENSION_ID = 'aagpgcpcgjlpmllnkpgbkgejipicjned'

/** Covers bigger than this aren't sent; real ones are well under 1 MB. */
export const MAX_ARTWORK_BYTES = 2 * 1024 * 1024

export type RepeatSetting = 'off' | 'all' | 'one'

/**
 * Covers come only from the hosts YouTube Music itself uses, over https. Both sides check:
 * the app before asking for a cover, the extension before fetching one.
 */
export function isArtworkUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  const host = url.hostname
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.port &&
    (host.endsWith('.googleusercontent.com') ||
      host === 'i.ytimg.com' ||
      host.endsWith('.ggpht.com'))
  )
}

/** The song YouTube Music will play next, from its queue. */
export interface PageUpNext {
  title: string
  artist: string
  /** 0 when the queue doesn't say. */
  durationSec: number
  artworkUrl: string | null
}

/** What the YouTube Music tab shows right now. */
export interface PageState {
  /** YouTube's id for the song, from the page URL, when there is one. */
  videoId: string | null
  /**
   * The playlist the song plays from (the page URL's `list`), when there is one. Optional
   * because extensions built before it was added don't send it.
   */
  playlistId?: string | null
  title: string
  artist: string
  album: string
  /** 0 when unknown. */
  durationSec: number
  positionSec: number
  playing: boolean
  /** null when the page's shuffle button doesn't show an on/off state. */
  shuffle: boolean | null
  repeat: RepeatSetting
  artworkUrl: string | null
  /** An ad is playing instead of a song. */
  ad: boolean
  /**
   * The song after this one, from the queue; null when nothing follows (the queue's end with
   * autoplay off, or repeating this song). Optional: older extensions don't send it.
   */
  next?: PageUpNext | null
}

export type PageCommand =
  | { kind: 'playPause' }
  | { kind: 'next' }
  | { kind: 'previous' }
  | { kind: 'restart' }
  | { kind: 'setShuffle'; on: boolean }
  | { kind: 'setRepeat'; mode: RepeatSetting }
  /** Seconds into the song. An older extension drops it, like any command it doesn't know. */
  | { kind: 'seek'; positionSec: number }

/** YouTube Music's own lyrics for a song, read from its Lyrics tab while that's on screen. */
export interface PageLyrics {
  /** The song they're for, as in PageState: the app finds the song the same way. */
  videoId: string | null
  title: string
  artist: string
  /** The words as the page shows them, a line per line. */
  text: string
  /** Who YouTube Music credits ("Musixmatch"); null when it names nobody. */
  source: string | null
}

/** Extension → app. */
export type ExtensionMessage =
  /** Reconnecting with the token from an earlier pairing. */
  | { type: 'hello'; version: number; token: string }
  /** First connection: the six digits the app showed the user. */
  | { type: 'pair'; version: number; code: string }
  /** null when no YouTube Music tab is open. */
  | { type: 'state'; state: PageState | null }
  | { type: 'artwork'; requestId: number; base64: string }
  | { type: 'artworkFailed'; requestId: number }
  /** Sent once per song, when YouTube Music shows lyrics for it. */
  | { type: 'lyrics'; lyrics: PageLyrics }

/** App → extension. */
export type AppMessage =
  | { type: 'welcome' }
  | { type: 'paired'; token: string }
  | { type: 'rejected'; reason: 'badToken' | 'badCode' | 'version' }
  | { type: 'command'; command: PageCommand }
  | { type: 'artworkRequest'; requestId: number; url: string }
  /** Incoming messages keep Chrome's extension service worker (and so the socket) alive. */
  | { type: 'keepalive' }
