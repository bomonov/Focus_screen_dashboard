// Runs on music.youtube.com: reads what's playing and presses the player's own buttons.
// It only reads the player; nothing else on the page (account, history, library) is touched.
import type {
  PageCommand,
  PageState,
  PageUpNext
} from '../../src/main/services/music/extension-ws/protocol'
import {
  ext,
  PAGE_LINE,
  type PageLyricsMessage,
  type PageMessage,
  type TabMessage
} from './messages'
import {
  bestArtwork,
  clicksToRepeat,
  lineRetryMs,
  lyricsCredit,
  NEW_LYRICS_WATCH,
  parseRepeatTitle,
  parseQueueDuration,
  QUEUE_COVER_ATTRIBUTE,
  QUEUE_COVER_REQUEST,
  queueCover,
  splitByline,
  stateChanged,
  upNextIndex,
  watchLyrics
} from './page'

/** Catches title and repeat changes, which fire no media events. */
const CHECK_MS = 1000
/** While playing, report at least this often so the app's position stays exact. */
const HEARTBEAT_MS = 5000
/**
 * While paused, still report now and then: that wakes a sleeping background worker, so it
 * reconnects soon after Focus Screen starts. Safari slows a hidden tab's timers to about once
 * a minute or two, though, so the line below is what wakes it there.
 */
const IDLE_HEARTBEAT_MS = 10_000
/** Gives the player a moment to update its buttons between repeat clicks. */
const CLICK_GAP_MS = 150
/** Between songs the page has no song for about a second; only a longer gap means it's gone. */
const GONE_AFTER_MS = 3000

let last: PageState | null | undefined
let lastSentAt = 0
let goneSince: number | null = null
let stopped = false

const playerBar = (): Element | null => document.querySelector('ytmusic-player-bar')
const video = (): HTMLVideoElement | null => document.querySelector('video')
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function textOf(selector: string): string {
  return playerBar()?.querySelector(selector)?.textContent?.trim() ?? ''
}

/**
 * A queue row's cover. The page-world script (queueCovers.ts) reads it from the row's data,
 * since the row's own picture loads only once the row has been on screen; the event's listeners
 * run before dispatchEvent returns, so its answer is on the row by then.
 */
function rowCover(row: HTMLElement): string | null {
  row.dispatchEvent(new Event(QUEUE_COVER_REQUEST))
  const sizes = row.getAttribute(QUEUE_COVER_ATTRIBUTE)
  row.removeAttribute(QUEUE_COVER_ATTRIBUTE)
  return queueCover(sizes, row.querySelector<HTMLImageElement>('img')?.src ?? '')
}

/**
 * The song after this one in YouTube Music's queue (its Up next tab, there even while the
 * player is closed). Songs with a music video sit in the queue twice, the hidden twin under
 * "counterpart"; only the shown ones count.
 */
function readUpNext(repeat: PageState['repeat']): PageUpNext | null {
  const items = [
    ...document.querySelectorAll<HTMLElement>('ytmusic-player-queue ytmusic-player-queue-item')
  ].filter((item) => item.closest('#counterpart-renderer') === null)
  const toggle = document.querySelector('ytmusic-player-page #automix')
  // Autoplay is on unless its switch says otherwise.
  const autoplay = toggle === null || toggle.getAttribute('aria-pressed') !== 'false'
  const index = upNextIndex(
    items.map((item) => ({
      selected: item.hasAttribute('selected'),
      automix: item.hasAttribute('is-automix')
    })),
    autoplay,
    repeat
  )
  const item = index === null ? undefined : items[index]
  const title = item?.querySelector('.song-title')?.textContent?.trim() ?? ''
  if (!item || !title) return null
  return {
    title,
    artist: splitByline(item.querySelector('.byline')?.textContent ?? '').artist,
    durationSec: parseQueueDuration(item.querySelector('.duration')?.textContent ?? ''),
    artworkUrl: rowCover(item)
  }
}

function readState(): PageState | null {
  const media = video()
  const metadata = navigator.mediaSession?.metadata ?? null
  const title = metadata?.title || textOf('.title')
  if (!media || !title || !(media.duration > 0)) return null

  const byline = splitByline(textOf('.byline'))
  const image = playerBar()?.querySelector<HTMLImageElement>('img.image')?.src ?? null
  const params = new URL(location.href).searchParams
  const videoId = params.get('v')
  // Just the playlist's id, so the app can tell when a playlist it's working through ends.
  const playlistId = params.get('list')?.trim().slice(0, 200) || null
  const repeat = parseRepeatTitle(playerBar()?.querySelector('.repeat')?.getAttribute('title'))
  const ad = document.querySelector('.ad-showing') !== null
  return {
    videoId,
    playlistId,
    title,
    artist: metadata?.artist || byline.artist,
    album: metadata?.album || byline.album,
    durationSec: Number.isFinite(media.duration) ? media.duration : 0,
    positionSec: media.currentTime,
    playing: !media.paused && !media.ended,
    // The button looks the same either way; the player bar carries the state as an attribute.
    shuffle: playerBar()?.hasAttribute('shuffle-on') ?? null,
    repeat,
    artworkUrl: bestArtwork(metadata ? [...metadata.artwork] : []) ?? image,
    ad,
    next: ad ? null : readUpNext(repeat)
  }
}

/** YouTube Music's lyrics panel (its Lyrics tab), by its page type: the same in every language. */
const LYRICS_PANEL = 'ytmusic-description-shelf-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]'
let lyricsWatch = NEW_LYRICS_WATCH

/**
 * Sends the lyrics YouTube Music shows for the song, once per song, so Focus Screen can show
 * them when nobody else has the song. Only what the page already shows in its Lyrics tab: it's
 * never opened or asked for.
 */
function checkLyrics(state: PageState | null): void {
  if (!state || state.ad) return
  const panel = document.querySelector<HTMLElement>(LYRICS_PANEL)
  const words = panel
    ?.querySelector<HTMLElement>('yt-formatted-string.description')
    ?.innerText.trim()
  const song = state.videoId ?? `${state.title}\n${state.artist}`
  const { watch, send } = watchLyrics(
    lyricsWatch,
    song,
    words || null,
    panel !== null && panel.getClientRects().length > 0,
    Date.now()
  )
  lyricsWatch = watch
  if (!send || !panel) return
  const footer = panel.querySelector('yt-formatted-string.footer')?.textContent ?? ''
  const message: PageLyricsMessage = {
    type: 'lyrics',
    lyrics: {
      videoId: state.videoId,
      title: state.title,
      artist: state.artist,
      text: send,
      source: lyricsCredit(footer)
    }
  }
  ext.runtime.sendMessage(message).catch(() => {
    // Not taken (the background was waking): look again, and send again, next time.
    if (lyricsWatch.sent === send) lyricsWatch = { ...lyricsWatch, sent: null }
  })
}

function report(force = false): void {
  if (stopped) return
  const state = readState()
  checkLyrics(state)
  const now = Date.now()
  if (state === null && last) {
    goneSince ??= now
    if (now - goneSince < GONE_AFTER_MS) return
  } else {
    goneSince = null
  }
  const heartbeatDue = now - lastSentAt >= (state?.playing ? HEARTBEAT_MS : IDLE_HEARTBEAT_MS)
  if (!force && !heartbeatDue && !stateChanged(last, state, (now - lastSentAt) / 1000)) return
  last = state
  lastSentAt = now
  const message: PageMessage = { type: 'page', state }
  ext.runtime.sendMessage(message).catch(() => {
    // Only stop when the extension itself is gone (reloaded or removed: this copy is orphaned).
    // Safari also fails a message now and then while it wakes the extension; the next one goes.
    if (!ext.runtime.id) stopped = true
    else lastSentAt = 0
  })
}

/** Presses one of the player bar's buttons the way a click would. */
function press(selector: string): boolean {
  const host = playerBar()?.querySelector<HTMLElement>(selector)
  if (!host) return false
  ;(host.querySelector<HTMLElement>('button') ?? host).click()
  return true
}

async function run(command: PageCommand): Promise<void> {
  switch (command.kind) {
    case 'playPause':
      press('#play-pause-button')
      break
    case 'next':
      press('.next-button')
      break
    case 'previous':
      press('.previous-button')
      break
    case 'restart': {
      const media = video()
      if (media) media.currentTime = 0
      break
    }
    case 'seek': {
      // The player's own <video>: its scrubber follows, as when you drag it on the page.
      const media = video()
      if (media && media.duration > 0) {
        media.currentTime = Math.min(command.positionSec, media.duration)
      }
      break
    }
    case 'setShuffle':
      // Shuffle is a toggle, so only press it when it isn't already where we want it.
      if ((playerBar()?.hasAttribute('shuffle-on') ?? false) !== command.on) press('.shuffle')
      break
    case 'setRepeat': {
      const current = parseRepeatTitle(playerBar()?.querySelector('.repeat')?.getAttribute('title'))
      for (let i = clicksToRepeat(current, command.mode); i > 0; i--) {
        press('.repeat')
        await wait(CLICK_GAP_MS)
      }
      break
    }
  }
  // Report as soon as the player shows the result; repeat and shuffle fire no media event.
  // The later checks catch a new song that takes a moment to load.
  for (const delay of [50, 300, 1200]) setTimeout(() => report(), delay)
}

function isTabMessage(raw: unknown): raw is TabMessage {
  return typeof raw === 'object' && raw !== null && 'type' in raw
}

// Only our own background script can message a content script.
ext.runtime.onMessage.addListener((raw) => {
  if (!isTabMessage(raw)) return
  if (raw.type === 'command') void run(raw.command)
  else report(true)
})

let lineWaitMs = 0

/**
 * Keeps a line open to the background. Safari stops its background page (and with it the
 * connection to Focus Screen) about every half minute while nothing plays. The line closing
 * tells us the moment that happens, without a timer, and reopening it starts the page again,
 * which reconnects. An open line may also keep the page from stopping at all.
 */
function holdLine(): void {
  if (stopped) return
  const openedAt = Date.now()
  try {
    ext.runtime.connect({ name: PAGE_LINE }).onDisconnect.addListener(() => {
      if (!ext.runtime.id) {
        stopped = true
        return
      }
      lineWaitMs = lineRetryMs(Date.now() - openedAt, lineWaitMs)
      if (lineWaitMs === 0) holdLine()
      else setTimeout(holdLine, lineWaitMs)
    })
  } catch {
    // Throws only once the extension itself is gone (reloaded or removed).
    stopped = true
  }
}

// Media events don't bubble, but they do pass through the capture phase on their way down.
for (const event of ['play', 'pause', 'seeked', 'ended', 'durationchange', 'emptied']) {
  document.addEventListener(event, () => report(), true)
}
setInterval(() => report(), CHECK_MS)
report(true)
holdLine()
