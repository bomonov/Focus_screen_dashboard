// The YouTube video itself in the Now playing card (Bek's fork): a muted copy of the video playing
// in the browser tab, kept on the tab's time. The sound stays in the tab; this is only the picture.
import { useEffect, useRef, useState } from 'react'
import type { PlaybackState } from '../../../main/ipc'
import { expectedPosition } from './youTubeVideoView'

const EMBED_ORIGIN = 'https://www.youtube-nocookie.com'
/** Further apart than this and the copy jumps to the tab's time. */
const DRIFT_SEC = 1.5
const CHECK_MS = 1000

export function YouTubeVideo({
  videoId,
  state
}: {
  videoId: string
  state: PlaybackState
}): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  const latest = useRef(state)
  useEffect(() => {
    latest.current = state
  }, [state])
  const shownTime = useRef<number | null>(null)

  // Mounted once per video (keyed by it), starting wherever the tab was at that moment.
  const [src] = useState(() => {
    const params = new URLSearchParams({
      enablejsapi: '1',
      autoplay: '1',
      mute: '1',
      controls: '0',
      disablekb: '1',
      playsinline: '1',
      rel: '0',
      iv_load_policy: '3',
      start: String(Math.floor(expectedPosition(state, Date.now())))
    })
    if (location.origin.startsWith('http')) params.set('origin', location.origin)
    return `${EMBED_ORIGIN}/embed/${videoId}?${params.toString()}`
  })

  useEffect(() => {
    shownTime.current = null
    const send = (func: string, args: unknown[] = []): void => {
      frame.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func, args, id: 1, channel: 'widget' }),
        EMBED_ORIGIN
      )
    }
    const listen = (): void => {
      frame.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
        EMBED_ORIGIN
      )
    }
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== EMBED_ORIGIN || typeof event.data !== 'string') return
      try {
        const data = JSON.parse(event.data) as { event?: string; info?: { currentTime?: unknown } }
        const time = data.info?.currentTime
        if (data.event === 'infoDelivery' && typeof time === 'number') shownTime.current = time
      } catch {
        // Not one of the player's messages.
      }
    }
    window.addEventListener('message', onMessage)
    const tick = (): void => {
      const current = latest.current
      listen()
      send('mute')
      send(current.playing ? 'playVideo' : 'pauseVideo')
      const expected = expectedPosition(current, Date.now())
      if (shownTime.current === null || Math.abs(shownTime.current - expected) > DRIFT_SEC) {
        send('seekTo', [expected, true])
        shownTime.current = expected
      }
    }
    const timer = window.setInterval(tick, CHECK_MS)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('message', onMessage)
    }
  }, [videoId])

  return (
    <div className="now-playing__video">
      <iframe
        ref={frame}
        src={src}
        title="YouTube video"
        allow="autoplay; encrypted-media; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}
