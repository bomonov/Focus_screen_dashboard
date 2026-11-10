import type { HelperProcess } from '../helperProcess'
import type { StartAligner } from './aligner'
import type { AlignLanguage } from './lines'

/**
 * Live sync on a song's first play: a second aligner worker hears the song as it plays and says
 * which line is being sung. Its protocol (`follow` / `audio` / `seek` / `stop` in, `line` /
 * `lost` out) is agreed in lyrics-sync/HANDOFF.md. Every message carries the follow request's
 * id, and all but `follow` an epoch the app counts up at each seek, so neither a late answer
 * about the last song nor one about the spot before a seek can light a line. The offline
 * `align` still times the whole song afterwards; that's what gets saved.
 */

export type FollowEvent =
  /** Line `index` (of the lines given to `start`) is being sung; light it now. */
  | { type: 'line'; index: number; start: number; confidence: number | null }
  /** The worker no longer knows where the singer is: light nothing until the next line. */
  | { type: 'lost' }

export interface FollowSong {
  /** The sung lines, prepared as for `align` (no companions, asides or decorations). */
  lines: string[]
  language: AlignLanguage | null
  durationSec: number
}

export interface FollowClient {
  /** Starts following a song, replacing the one followed before. */
  start(song: FollowSong): void
  /** Audio as it's heard: 16 kHz mono, `songTimeSec` being where its first sample belongs. */
  audio(songTimeSec: number, samples: Int16Array): void
  seek(songTimeSec: number): void
  /** The song ended or was left. */
  stop(): void
  dispose(): void
}

/** Loading the model can take ~30 s when it isn't in the disk cache; past this, give up on the song. */
export const FOLLOW_READY_TIMEOUT_MS = 120_000
/** The model holds a couple of GB; let it go once no song has been followed for a while. */
export const FOLLOW_IDLE_STOP_MS = 180_000
const MAX_LINES = 400
const MAX_SONG_SEC = 600
/** The audio helper's own chunks are ~100 ms; more than a second at once isn't live. */
const MAX_CHUNK_SAMPLES = 16_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type FollowMessage =
  | { type: 'reply'; id: number; ok: boolean; error: string | null }
  | ({ id: number; epoch: number } & FollowEvent)

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

/** The worker's output is untrusted like any helper's: anything off-shape is no data. */
export function parseFollowMessage(raw: unknown, lineCount: number): FollowMessage | null {
  if (!isRecord(raw) || !isCount(raw.id)) return null
  const { id, epoch } = raw
  switch (raw.type) {
    case 'reply':
      if (typeof raw.ok !== 'boolean') return null
      return {
        type: 'reply',
        id,
        ok: raw.ok,
        error: typeof raw.error === 'string' ? raw.error.slice(0, 200) : null
      }
    case 'line': {
      const { index, start, confidence } = raw
      if (
        !isCount(epoch) ||
        !isCount(index) ||
        index >= lineCount ||
        typeof start !== 'number' ||
        !Number.isFinite(start)
      ) {
        return null
      }
      return {
        type: 'line',
        id,
        epoch,
        index,
        start,
        confidence:
          typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : null
      }
    }
    case 'lost':
      return isCount(epoch) ? { type: 'lost', id, epoch } : null
    default:
      return null
  }
}

/** Little-endian, like every Mac, which is what the worker reads. */
export function encodePcm(samples: Int16Array): string {
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64')
}

interface Session {
  id: number
  lineCount: number
  /** The worker said it's following; audio before that isn't sent (it would only pile up). */
  ready: boolean
  /** Counted up at each seek; answers about an earlier epoch are about the old spot. */
  epoch: number
  timer: ReturnType<typeof setTimeout> | undefined
}

export function createFollowClient(
  startWorker: StartAligner,
  onEvent: (event: FollowEvent) => void,
  { readyTimeoutMs = FOLLOW_READY_TIMEOUT_MS, idleStopMs = FOLLOW_IDLE_STOP_MS } = {}
): FollowClient {
  let worker: HelperProcess | null = null
  let session: Session | null = null
  let nextId = 1
  let idleTimer: ReturnType<typeof setTimeout> | undefined

  function end(lost: boolean): void {
    if (!session) return
    clearTimeout(session.timer)
    const wasReady = session.ready
    session = null
    if (lost && wasReady) onEvent({ type: 'lost' })
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      worker?.stop()
      worker = null
    }, idleStopMs)
  }

  function ensureWorker(): HelperProcess {
    clearTimeout(idleTimer)
    if (worker) return worker
    worker = startWorker({
      onMessage(raw) {
        const message = session ? parseFollowMessage(raw, session.lineCount) : null
        // A late message about a song no longer followed must never light a line.
        if (!message || !session || message.id !== session.id) return
        if (message.type === 'reply') {
          clearTimeout(session.timer)
          if (message.ok) {
            session.ready = true
          } else {
            console.warn(`[autosync] Live sync isn't available: ${message.error ?? 'failed'}`)
            // Failing mid-song un-lights whatever it had lit.
            end(true)
          }
        } else if (session.ready && message.epoch === session.epoch) {
          onEvent(
            message.type === 'line'
              ? {
                  type: 'line',
                  index: message.index,
                  start: message.start,
                  confidence: message.confidence
                }
              : { type: 'lost' }
          )
        }
      },
      onExit() {
        // The worker forgot the song; the plain lyrics come back until the next one.
        end(true)
      }
    })
    return worker
  }

  function send(message: Record<string, unknown>): void {
    if (session && !worker?.send({ ...message, id: session.id, epoch: session.epoch })) end(true)
  }

  return {
    start(song) {
      end(true)
      if (
        song.lines.length === 0 ||
        song.lines.length > MAX_LINES ||
        !(song.durationSec > 0 && song.durationSec <= MAX_SONG_SEC)
      ) {
        return
      }
      const target = ensureWorker()
      const id = nextId++
      session = {
        id,
        lineCount: song.lines.length,
        ready: false,
        epoch: 0,
        timer: setTimeout(() => {
          console.warn("[autosync] Live sync didn't start in time.")
          send({ op: 'stop' })
          end(false)
        }, readyTimeoutMs)
      }
      if (
        !target.send({
          id,
          op: 'follow',
          lines: song.lines,
          language: song.language,
          durationSec: song.durationSec
        })
      ) {
        end(false)
      }
    },
    audio(songTimeSec, samples) {
      if (!session?.ready || !Number.isFinite(songTimeSec) || songTimeSec < 0) return
      if (samples.length === 0 || samples.length > MAX_CHUNK_SAMPLES) return
      send({
        op: 'audio',
        songTime: Math.round(songTimeSec * 1000) / 1000,
        pcm: encodePcm(samples)
      })
    },
    seek(songTimeSec) {
      if (!session?.ready || !Number.isFinite(songTimeSec)) return
      session.epoch += 1
      send({ op: 'seek', songTime: Math.max(0, Math.round(songTimeSec * 1000) / 1000) })
      // Whatever was lit belonged to the old spot.
      onEvent({ type: 'lost' })
    },
    stop() {
      send({ op: 'stop' })
      end(true)
    },
    dispose() {
      if (session) send({ op: 'stop' })
      end(false)
      clearTimeout(idleTimer)
      worker?.stop()
      worker = null
    }
  }
}
