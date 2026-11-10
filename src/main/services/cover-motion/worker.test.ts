import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeHelper, type FakeHelper } from '../todos/apple-reminders/fakeHelper'
import { createCoverWorker, parseCoverReply, SEGMENT_TIMEOUT_MS, type CoverWorker } from './worker'

describe('the cover worker client', () => {
  let fake: FakeHelper
  let worker: CoverWorker

  beforeEach(() => {
    vi.useFakeTimers()
    fake = fakeHelper()
    worker = createCoverWorker(fake.start)
  })
  afterEach(() => {
    worker.dispose()
    vi.useRealTimers()
  })

  const cutRequest = {
    cover: '/c/cover.jpg',
    base: null,
    strokes: [{ point: [10, 20] as [number, number], add: true, size: null }],
    out: '/c/p1.png'
  }

  it('cuts a part out of its clicks', async () => {
    const result = worker.cut(cutRequest)
    expect(fake.sent[0]).toMatchObject({
      op: 'cut',
      cover: '/c/cover.jpg',
      base: null,
      strokes: [{ point: [10, 20], add: true, size: null }],
      out: '/c/p1.png'
    })
    fake.reply('cut', { ok: true, area: 0.25, sizes: [1] })
    await expect(result).resolves.toEqual({ ok: true, area: 0.25, sizes: [1] })
  })

  it('reads the cover ahead, so the first click is quick', async () => {
    const result = worker.prepare('/c/cover.jpg')
    expect(fake.sent[0]).toMatchObject({ op: 'prepare', cover: '/c/cover.jpg' })
    fake.reply('prepare', { ok: true })
    await expect(result).resolves.toEqual({ ok: true })
  })

  it('finds the part under a click', async () => {
    const result = worker.hit([10, 20], ['/c/p1.png', '/c/p2.png'])
    expect(fake.sent[0]).toMatchObject({
      op: 'hit',
      point: [10, 20],
      masks: ['/c/p1.png', '/c/p2.png']
    })
    fake.reply('hit', { ok: true, index: 1 })
    await expect(result).resolves.toEqual({ ok: true, index: 1 })
  })

  it('passes on a failure, cut short', async () => {
    const result = worker.cut(cutRequest)
    fake.reply('cut', { ok: false, error: 'x'.repeat(500) })
    await expect(result).resolves.toEqual({ ok: false, error: 'x'.repeat(200) })
  })

  it('ignores lines that are not replies', async () => {
    const result = worker.cut(cutRequest)
    fake.say('hello')
    fake.say({ type: 'reply', id: 'nope' })
    fake.reply('cut', { ok: true, area: 0.5, sizes: [0] })
    await expect(result).resolves.toEqual({ ok: true, area: 0.5, sizes: [0] })
  })

  it('fails what was asked when the worker stops', async () => {
    const result = worker.cut(cutRequest)
    fake.crash()
    await expect(result).resolves.toEqual({ ok: false, error: 'stopped' })
  })

  it('gives up on a worker that never answers (a first model load stuck)', async () => {
    const result = worker.cut(cutRequest)
    vi.advanceTimersByTime(SEGMENT_TIMEOUT_MS)
    await expect(result).resolves.toEqual({ ok: false, error: 'timed out' })
  })

  it('reads a build', async () => {
    const result = worker.build({
      cover: '/c/cover.jpg',
      parts: [],
      protected: [],
      plate: '/c/plate.jpg'
    })
    const part = { move: [0, -1], center: [300, 300], emitters: [[1, 2]], color: [250, 250, 240] }
    fake.reply('build', { ok: true, plate: false, parts: [part] })
    await expect(result).resolves.toEqual({ ok: true, plate: false, parts: [part] })
  })
})

describe('parseCoverReply', () => {
  const reply = (body: Record<string, unknown>): unknown => ({
    type: 'reply',
    id: 1,
    ok: true,
    ...body
  })

  it('refuses numbers that are not numbers, or out of range', () => {
    expect(parseCoverReply(reply({ area: Number.NaN }))).toBeNull()
    expect(parseCoverReply(reply({ area: 2 }))).toBeNull()
    expect(parseCoverReply(reply({ area: 0.2, sizes: [3] }))).toBeNull()
    expect(parseCoverReply(reply({ area: 0.2, sizes: [0.5] }))).toBeNull()
    expect(parseCoverReply(reply({ area: 0.2, sizes: Array(9).fill(0) }))).toBeNull()
    expect(parseCoverReply(reply({ index: -2 }))).toBeNull()
    expect(parseCoverReply(reply({ index: 6 }))).toBeNull()
    expect(parseCoverReply(reply({ index: '1' }))).toBeNull()
    const part = { move: [0, -1], center: [300, 300], emitters: [], color: [250, 250, 240] }
    expect(
      parseCoverReply(reply({ plate: false, parts: [{ ...part, color: [300, 0, 0] }] }))
    ).toBeNull()
    expect(parseCoverReply(reply({ plate: false, parts: [{ ...part, move: [0] }] }))).toBeNull()
    const many = Array.from({ length: 201 }, () => [1, 1])
    expect(
      parseCoverReply(reply({ plate: false, parts: [{ ...part, emitters: many }] }))
    ).toBeNull()
  })
})
