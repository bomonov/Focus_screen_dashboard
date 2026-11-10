import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HelperProcess } from '../helperProcess'
import { createAlignerClient, parseAlignerReply, type StartAligner } from './aligner'

describe('parseAlignerReply', () => {
  it('reads timings and failures', () => {
    expect(
      parseAlignerReply({ type: 'reply', id: 2, ok: true, lines: [{ start: 1, end: 2 }, null] })
    ).toEqual({ id: 2, ok: true, lines: [{ start: 1, end: 2 }, null] })
    expect(parseAlignerReply({ type: 'reply', id: 1, ok: true, device: 'mps' })).toEqual({
      id: 1,
      ok: true,
      lines: null
    })
    expect(parseAlignerReply({ type: 'reply', id: 3, ok: false, error: 'bad audio' })).toEqual({
      id: 3,
      ok: false,
      error: 'bad audio'
    })
  })

  it('drops anything off-shape', () => {
    expect(parseAlignerReply({ type: 'ready' })).toBeNull()
    expect(parseAlignerReply({ type: 'reply', id: '1', ok: true })).toBeNull()
    expect(
      parseAlignerReply({ type: 'reply', id: 1, ok: true, lines: [{ start: 'soon', end: 2 }] })
    ).toBeNull()
    expect(
      parseAlignerReply({ type: 'reply', id: 1, ok: true, lines: [{ start: NaN, end: 2 }] })
    ).toBeNull()
  })
})

/** A worker that answers each request with `answer`, after `delayMs`. */
function fakeWorker(
  answer: (request: Record<string, unknown>) => unknown,
  delayMs = 10
): {
  start: StartAligner
  started: number
  stopped: number
  sent: Record<string, unknown>[]
  exit(): void
} {
  const fake = {
    started: 0,
    stopped: 0,
    sent: [] as Record<string, unknown>[],
    exit: () => {},
    start: (({ onMessage, onExit }) => {
      fake.started += 1
      fake.exit = onExit
      const process: HelperProcess = {
        send(message) {
          const request = message as Record<string, unknown>
          fake.sent.push(request)
          setTimeout(() => onMessage(answer(request)), delayMs)
          return true
        },
        stop() {
          fake.stopped += 1
        }
      }
      return process
    }) as StartAligner
  }
  return fake
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createAlignerClient', () => {
  const timings = (request: Record<string, unknown>): unknown => ({
    type: 'reply',
    id: request.id,
    ok: true,
    lines: (request.lines as string[] | undefined)?.map((_, index) => ({
      start: index * 2,
      end: index * 2 + 1
    }))
  })

  it('starts the worker on demand and returns its timings', async () => {
    const worker = fakeWorker(timings)
    const client = createAlignerClient(worker.start)
    expect(worker.started).toBe(0)
    const result = client.align('/tmp/song.wav', ['one', 'two'], 'ja')
    await vi.advanceTimersByTimeAsync(20)
    await expect(result).resolves.toEqual({
      ok: true,
      lines: [
        { start: 0, end: 1 },
        { start: 2, end: 3 }
      ]
    })
    expect(worker.sent[0]).toMatchObject({ op: 'align', wav: '/tmp/song.wav', language: 'ja' })
  })

  it('loads the model ahead of time and reuses the worker', async () => {
    const worker = fakeWorker(timings)
    const client = createAlignerClient(worker.start)
    client.prepare()
    await vi.advanceTimersByTimeAsync(20)
    void client.align('/tmp/song.wav', ['one'], null)
    await vi.advanceTimersByTimeAsync(20)
    expect(worker.started).toBe(1)
    expect(worker.sent.map((request) => request.op)).toEqual(['load', 'align'])
  })

  it('stops the worker after a while with nothing to do', async () => {
    const worker = fakeWorker(timings)
    const client = createAlignerClient(worker.start, { idleStopMs: 1000 })
    client.prepare()
    await vi.advanceTimersByTimeAsync(500)
    expect(worker.stopped).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(worker.stopped).toBe(1)
    void client.align('/tmp/song.wav', ['one'], null)
    expect(worker.started).toBe(2)
  })

  it('reports failures, timeouts, a worker that quits, and answers for the wrong lines', async () => {
    const failing = fakeWorker((request) => ({
      type: 'reply',
      id: request.id,
      ok: false,
      error: 'bad audio'
    }))
    const failed = createAlignerClient(failing.start).align('/x.wav', ['one'], null)
    await vi.advanceTimersByTimeAsync(20)
    await expect(failed).resolves.toEqual({ ok: false, error: 'bad audio' })

    const silent = fakeWorker(() => null)
    const slow = createAlignerClient(silent.start, { timeoutMs: 1000 }).align(
      '/x.wav',
      ['one'],
      null
    )
    await vi.advanceTimersByTimeAsync(1000)
    await expect(slow).resolves.toMatchObject({ ok: false })

    const quitting = fakeWorker(() => null)
    const gone = createAlignerClient(quitting.start).align('/x.wav', ['one'], null)
    quitting.exit()
    await expect(gone).resolves.toEqual({ ok: false, error: 'The aligner stopped.' })

    const short = fakeWorker((request) => ({ type: 'reply', id: request.id, ok: true, lines: [] }))
    const wrong = createAlignerClient(short.start).align('/x.wav', ['one'], null)
    await vi.advanceTimersByTimeAsync(20)
    await expect(wrong).resolves.toMatchObject({ ok: false })
  })
})

describe('word timings in replies', () => {
  it('keeps a line’s words, and drops words that don’t check out without losing the line', () => {
    const reply = parseAlignerReply({
      type: 'reply',
      id: 2,
      ok: true,
      lines: [
        {
          start: 1,
          end: 3,
          words: [
            { text: 'hi', start: 1, end: 1.4 },
            { text: ' there', start: 1.5, end: 3 }
          ]
        },
        { start: 4, end: 5, words: [{ text: 'bad', start: 5, end: 4 }] },
        null
      ]
    })
    expect(reply).toEqual({
      id: 2,
      ok: true,
      lines: [
        {
          start: 1,
          end: 3,
          words: [
            { text: 'hi', start: 1, end: 1.4 },
            { text: ' there', start: 1.5, end: 3 }
          ]
        },
        { start: 4, end: 5 },
        null
      ]
    })
  })
})
