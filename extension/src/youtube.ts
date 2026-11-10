// Runs on www.youtube.com: treats the video you're watching as the song now playing, and
// presses the player's own buttons. Added by Bek (bomonov) on top of KennyLewd's YouTube Music
// script (content.ts), using the same messages so the app needs no changes to read it.
import type { PageCommand, PageState } from '../../src/main/services/music/extension-ws/protocol'
import { ext, PAGE_LINE, type PageMessage, type TabMessage } from './messages'
import { lineRetryMs, stateChanged } from './page'
import { songFromVideo, thumbnailFor, watchVideoId } from './youtubePage'

const CHECK_MS = 1000
const HEARTBEAT_MS = 5000
const IDLE_HEARTBEAT_MS = 10_000
const GONE_AFTER_MS = 3000

let last: PageState | null | undefined
let lastSentAt = 0
let goneSince: number | null = null
let stopped = false

const player = (): HTMLElement | null => document.querySelector('#movie_player')
const video = (): HTMLVideoElement | null =>
  document.querySelector<HTMLVideoElement>('#movie_player video.html5-main-video') ??
  document.querySelector<HTMLVideoElement>('#movie_player video')

function pageTitle(): string {
  return (
    document.querySelector('ytd-watch-metadata h1')?.textContent?.trim() ??
    document.title.replace(/\s*-\s*YouTube$/, '').trim()
  )
}

function channelName(): string {
  return (
    document.querySelector('ytd-watch-metadata ytd-channel-name a')?.textContent?.trim() ??
    document.querySelector('#owner #channel-name a')?.textContent?.trim() ??
    ''
  )
}

function readState(): PageState | null {
  const videoId = watchVideoId(location.href)
  const media = video()
  if (!videoId || !media || !(media.duration > 0)) return null
  const metadata = navigator.mediaSession?.metadata ?? null
  const rawTitle = metadata?.title || pageTitle()
  if (!rawTitle) return null
  const song = songFromVideo(rawTitle, metadata?.artist || channelName())
  const playlistId = new URL(location.href).searchParams.get('list')?.trim().slice(0, 200) || null
  return {
    videoId,
    playlistId,
    title: song.title,
    artist: song.artist,
    album: '',
    durationSec: Number.isFinite(media.duration) ? media.duration : 0,
    positionSec: media.currentTime,
    playing: !media.paused && !media.ended,
    shuffle: null,
    repeat: media.loop ? 'one' : 'off',
    artworkUrl: thumbnailFor(videoId),
    ad: player()?.classList.contains('ad-showing') ?? false,
    next: null
  }
}

function report(force = false): void {
  if (stopped) return
  const state = readState()
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
    if (!ext.runtime.id) stopped = true
    else lastSentAt = 0
  })
}

function press(selector: string): boolean {
  const button = document.querySelector<HTMLElement>(selector)
  if (!button) return false
  button.click()
  return true
}

function run(command: PageCommand): void {
  const media = video()
  switch (command.kind) {
    case 'playPause':
      if (media) {
        if (media.paused) void media.play().catch(() => press('.ytp-play-button'))
        else media.pause()
      }
      break
    case 'next':
      press('.ytp-next-button')
      break
    case 'previous':
      if (!press('.ytp-prev-button') && media) media.currentTime = 0
      break
    case 'restart':
      if (media) media.currentTime = 0
      break
    case 'seek':
      if (media && media.duration > 0) {
        media.currentTime = Math.min(command.positionSec, media.duration)
      }
      break
    case 'setRepeat':
      // A single video can only loop itself; "all" means the playlist, which YouTube handles.
      if (media) media.loop = command.mode === 'one'
      break
    case 'setShuffle':
      break
  }
  for (const delay of [50, 300, 1200]) setTimeout(() => report(), delay)
}

function isTabMessage(raw: unknown): raw is TabMessage {
  return typeof raw === 'object' && raw !== null && 'type' in raw
}

ext.runtime.onMessage.addListener((raw) => {
  if (!isTabMessage(raw)) return
  if (raw.type === 'command') run(raw.command)
  else report(true)
})

let lineWaitMs = 0

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
    stopped = true
  }
}

for (const event of ['play', 'pause', 'seeked', 'ended', 'durationchange', 'emptied']) {
  document.addEventListener(event, () => report(), true)
}
// YouTube is a single-page app: moving to another video fires this instead of a page load.
document.addEventListener('yt-navigate-finish', () => report(true))
setInterval(() => report(), CHECK_MS)
report(true)
holdLine()
