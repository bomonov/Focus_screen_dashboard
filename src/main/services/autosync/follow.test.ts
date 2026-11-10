import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StartAligner } from './aligner'
import {
  createFollowClient,
  encodePcm,
  FOLLOW_IDLE_STOP_MS,
  FOLLOW_READY_TIMEOUT_MS,
  parseFollowMessage,
  type FollowEvent,
  type FollowSong
} from './follow'

const SONG: FollowSong = { lines: ['夜に駆ける', 'さよなら'], language: 'ja', durationSec: 180 }

function fakeWorker(): {
  start: StartAligner
  sent: Record<string, unknown>[]
  starts: number
  stops: number
  say(message: unknown): void
  exit(): void
  refuse(): void
} {
  let handlers: { onMessage(message: unknown): void; onExit(): void } | null = null
  let accepting = true
  const fake = {
    sent: [] as Record<string, unknown>[],
    starts: 0,
    stops: 0,
    start: ((next) => {
      handlers = next
      fake.starts += 1
      return {
        send(message: unknown) {
          if (!accepting) return false
          fake.sent.push(message as Record<string, unknown>)
          return true
        },
        stop: () => void (fake.stops += 1)
      }
    }) satisfies StartAligner,
    say: (message: unknown) => handlers?.onMessage(message),
    exit: () => handlers?.onExit(),
    refuse: () => void (accepting = false)
  }
  return fake
}

let worker: ReturnType<typeof fakeWorker>
let events: FollowEvent[]

function client(): ReturnType<typeof createFollowClient> {
  return createFollowClient(worker.start, (event) => events.push(event))
}

const ops = (): unknown[] => worker.sent.map((message) => message.op)

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  worker = fakeWorker()
  events = []
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('parseFollowMessage', () => {
  it('reads replies, lines and lost', () => {
    expect(parseFollowMessage({ type: 'reply', id: 3, ok: true }, 2)).toEqual({
      type: 'reply',
      id: 3,
      ok: true,
      error: null
    })
    const line = { type: 'line', id: 3, epoch: 2, index: 1, start: 41.85, confidence: 0.8 }
    expect(parseFollowMessage(line, 2)).toEqual(line)
    expect(
      parseFollowMessage({ type: 'line', id: 3, epoch: 0, index: 0, start: 2 }, 2)
    ).toMatchObject({ confidence: null })
    const lost = { type: 'lost', id: 3, epoch: 1 }
    expect(parseFollowMessage(lost, 2)).toEqual(lost)
  })

  it('treats anything off-shape as no data', () => {
    for (const raw of [
      null,
      'line',
      [],
      { type: 'line', epoch: 0, index: 0, start: 1 },
      { type: 'line', id: 1.5, epoch: 0, index: 0, start: 1 },
      { type: 'line', id: 1, index: 0, start: 1 },
      { type: 'line', id: 1, epoch: -1, index: 0, start: 1 },
      { type: 'line', id: 1, epoch: 0, index: 2, start: 1 },
      { type: 'line', id: 1, epoch: 0, index: -1, start: 1 },
      { type: 'line', id: 1, epoch: 0, index: 0.5, start: 1 },
      { type: 'line', id: 1, epoch: 0, index: 0, start: Number.NaN },
      { type: 'line', id: 1, epoch: 0, index: 0, start: '1' },
      { type: 'lost', id: 1 },
      { type: 'reply', id: 1 },
      { type: 'ready' }
    ]) {
      expect(parseFollowMessage(raw, 2)).toBeNull()
    }
  })
})

describe('encodePcm', () => {
  it('sends 16-bit little-endian samples as base64', () => {
    const samples = new Int16Array([1, -2, 300])
    const bytes = Buffer.from(encodePcm(samples.subarray(1)), 'base64')
    expect([...bytes]).toEqual([0xfe, 0xff, 0x2c, 0x01])
  })
})

describe('createFollowClient', () => {
  it('follows a song once the worker is ready, and lights what it says', () => {
    const follow = client()
    follow.start(SONG)
    expect(worker.sent[0]).toEqual({
      id: 1,
      op: 'follow',
      lines: SONG.lines,
      language: 'ja',
      durationSec: 180
    })
    // Not ready yet: the audio would only pile up in the pipe.
    follow.audio(1, new Int16Array(1600))
    expect(ops()).toEqual(['follow'])
    worker.say({ type: 'reply', id: 1, ok: true })
    follow.audio(1.1, new Int16Array([1, 2]))
    expect(worker.sent[1]).toEqual({
      id: 1,
      epoch: 0,
      op: 'audio',
      songTime: 1.1,
      pcm: 'AQACAA=='
    })
    worker.say({ type: 'line', id: 1, epoch: 0, index: 0, start: 0.9, confidence: 0.7 })
    worker.say({ type: 'lost', id: 1, epoch: 0 })
    expect(events).toEqual([
      { type: 'line', index: 0, start: 0.9, confidence: 0.7 },
      { type: 'lost' }
    ])
  })

  it('never lets a late message from the last song light the next one', () => {
    const follow = client()
    follow.start(SONG)
    worker.say({ type: 'reply', id: 1, ok: true })
    follow.start({ ...SONG, lines: ['one', 'two', 'three'] })
    expect(events).toEqual([{ type: 'lost' }])
    worker.say({ type: 'line', id: 1, epoch: 0, index: 1, start: 30 })
    worker.say({ type: 'reply', id: 2, ok: true })
    worker.say({ type: 'line', id: 1, epoch: 0, index: 0, start: 31 })
    worker.say({ type: 'line', id: 2, epoch: 0, index: 2, start: 3 })
    expect(events).toEqual([
      { type: 'lost' },
      { type: 'line', index: 2, start: 3, confidence: null }
    ])
    expect(worker.starts).toBe(1)
  })

  it('passes seeks on and un-lights the old spot', () => {
    const follow = client()
    follow.start(SONG)
    worker.say({ type: 'reply', id: 1, ok: true })
    worker.say({ type: 'line', id: 1, epoch: 0, index: 0, start: 5 })
    follow.seek(80.0004)
    expect(worker.sent[1]).toEqual({ id: 1, epoch: 1, op: 'seek', songTime: 80 })
    // An answer about the spot before the seek, still on its way, lights nothing.
    worker.say({ type: 'line', id: 1, epoch: 0, index: 1, start: 6 })
    worker.say({ type: 'line', id: 1, epoch: 1, index: 1, start: 81 })
    follow.audio(80.1, new Int16Array(1))
    expect(worker.sent[2]).toMatchObject({ op: 'audio', epoch: 1 })
    expect(events).toEqual([
      { type: 'line', index: 0, start: 5, confidence: null },
      { type: 'lost' },
      { type: 'line', index: 1, start: 81, confidence: null }
    ])
  })

  it('stops following when the song ends, then lets the model go', () => {
    const follow = client()
    follow.start(SONG)
    worker.say({ type: 'reply', id: 1, ok: true })
    follow.stop()
    expect(ops()).toEqual(['follow', 'stop'])
    expect(events).toEqual([{ type: 'lost' }])
    follow.audio(2, new Int16Array(10))
    worker.say({ type: 'line', id: 1, epoch: 0, index: 0, start: 1 })
    expect(ops()).toEqual(['follow', 'stop'])
    expect(events).toHaveLength(1)
    vi.advanceTimersByTime(FOLLOW_IDLE_STOP_MS)
    expect(worker.stops).toBe(1)
  })

  it('keeps the plain lyrics when the worker can’t follow', () => {
    const follow = client()
    follow.start(SONG)
    // Today's worker answers `follow` with "bad request".
    worker.say({ type: 'reply', id: 1, ok: false, error: 'bad request' })
    follow.audio(1, new Int16Array(10))
    worker.say({ type: 'line', id: 1, epoch: 0, index: 0, start: 1 })
    expect(ops()).toEqual(['follow'])
    expect(events).toEqual([])
  })

  it('un-lights the line when the worker fails mid-song', () => {
    const follow = client()
    follow.start(SONG)
    worker.say({ type: 'reply', id: 1, ok: true })
    worker.say({ type: 'line', id: 1, epoch: 0, index: 0, start: 1 })
    worker.say({ type: 'reply', id: 1, ok: false, error: 'out of memory' })
    follow.audio(2, new Int16Array(10))
    worker.say({ type: 'line', id: 1, epoch: 0, index: 1, start: 2 })
    expect(events).toEqual([
      { type: 'line', index: 0, start: 1, confidence: null },
      { type: 'lost' }
    ])
    expect(ops()).toEqual(['follow'])
  })

  it('gives up on a song when the worker never gets ready', () => {
    const follow = client()
    follow.start(SONG)
    vi.advanceTimersByTime(FOLLOW_READY_TIMEOUT_MS)
    worker.say({ type: 'reply', id: 1, ok: true })
    follow.audio(1, new Int16Array(10))
    expect(ops()).toEqual(['follow', 'stop'])
  })

  it('un-lights when the worker stops or can’t be written to', () => {
    const follow = client()
    follow.start(SONG)
    worker.say({ type: 'reply', id: 1, ok: true })
    worker.exit()
    expect(events).toEqual([{ type: 'lost' }])
    follow.start(SONG)
    worker.say({ type: 'reply', id: 2, ok: true })
    worker.refuse()
    follow.audio(1, new Int16Array(10))
    expect(events).toEqual([{ type: 'lost' }, { type: 'lost' }])
  })

  it('doesn’t follow songs the worker would turn down, nor send odd audio', () => {
    const follow = client()
    follow.start({ ...SONG, lines: [] })
    follow.start({ ...SONG, durationSec: 0 })
    follow.start({ ...SONG, durationSec: 601 })
    expect(worker.sent).toEqual([])
    follow.start(SONG)
    worker.say({ type: 'reply', id: 1, ok: true })
    follow.audio(-1, new Int16Array(10))
    follow.audio(Number.NaN, new Int16Array(10))
    follow.audio(1, new Int16Array(0))
    follow.audio(1, new Int16Array(16_001))
    expect(ops()).toEqual(['follow'])
  })
})
