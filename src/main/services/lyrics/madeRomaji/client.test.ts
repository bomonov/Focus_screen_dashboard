import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRomajiMaker, type MakerProcess, type RomajiMakerOptions } from './client'
import type { MakerRequest } from './messages'

const SONGS = [{ original: '明日', romanized: 'asu' }]
const READINGS: [string, string][] = [['明日|名詞副詞可能|ashita', 'asu']]

/** The saved VocaDB romaji (stamped `now`) and what was learned from it before, if anything. */
function learning(
  before: { stamp: string; readings: [string, string][] } | null = {
    stamp: 's1',
    readings: READINGS
  },
  now = 's1'
): RomajiMakerOptions['learning'] & { written: [string, [string, string][]][] } {
  const written: [string, [string, string][]][] = []
  return {
    written,
    stamp: () => now,
    songs: () => SONGS,
    saved: {
      read: () => before,
      write: (stamp, readings) => written.push([stamp, readings])
    }
  }
}

interface FakeProcess {
  process: MakerProcess & { killed: boolean }
  sent: MakerRequest[]
  reply(message: unknown): void
  exit(): void
}

function fakeProcess(): FakeProcess {
  const sent: MakerRequest[] = []
  let onMessage: (message: unknown) => void = () => {}
  let onExit: () => void = () => {}
  const process: MakerProcess & { killed: boolean } = {
    killed: false,
    postMessage: (message) => sent.push(message),
    onMessage: (listener) => {
      onMessage = listener
    },
    onExit: (listener) => {
      onExit = listener
    },
    kill() {
      process.killed = true
      onExit()
    }
  }
  return {
    process,
    sent,
    reply: (message: unknown) => onMessage(message),
    exit: () => onExit()
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the romaji maker in its own process', () => {
  it('hands a new process the readings learned before, then gets romaji back', async () => {
    const fake = fakeProcess()
    const start = vi.fn(() => fake.process)
    const maker = createRomajiMaker({ start, learning: learning() })
    const made = maker.make(['明日を待つ', 'Hello'])
    expect(start).toHaveBeenCalledTimes(1)
    expect(fake.sent).toEqual([
      { kind: 'readings', readings: READINGS },
      { kind: 'make', id: 1, lines: ['明日を待つ', 'Hello'] }
    ])
    fake.reply({ kind: 'made', id: 1, romaji: ['asu o matsu', ''] })
    await expect(made).resolves.toEqual(['asu o matsu', ''])
    maker.dispose()
  })

  it('learns before the first song when nothing was learned yet, and keeps what it learned', () => {
    const fake = fakeProcess()
    const learn = learning(null)
    const maker = createRomajiMaker({ start: () => fake.process, learning: learn })
    void maker.make(['明日を待つ'])
    expect(fake.sent).toEqual([
      { kind: 'learn', songs: SONGS },
      { kind: 'make', id: 1, lines: ['明日を待つ'] }
    ])
    fake.reply({ kind: 'learned', readings: READINGS })
    expect(learn.written).toEqual([['s1', READINGS]])
    maker.dispose()
  })

  it('learns again after the song once more VocaDB romaji was saved', () => {
    const fake = fakeProcess()
    const learn = learning({ stamp: 's0', readings: READINGS }, 's1')
    const maker = createRomajiMaker({ start: () => fake.process, learning: learn })
    void maker.make(['明日を待つ'])
    void maker.make(['空'])
    expect(fake.sent).toEqual([
      { kind: 'readings', readings: READINGS },
      { kind: 'make', id: 1, lines: ['明日を待つ'] },
      { kind: 'learn', songs: SONGS },
      { kind: 'make', id: 2, lines: ['空'] }
    ])
    fake.reply({ kind: 'learned', readings: [['bad']] })
    expect(learn.written).toEqual([])
    fake.reply({ kind: 'learned', readings: [] })
    expect(learn.written).toEqual([['s1', []]])
    maker.dispose()
  })

  it('keeps one process for songs close together, and stops it once it sits idle', async () => {
    vi.useFakeTimers()
    const fake = fakeProcess()
    const start = vi.fn(() => fake.process)
    const maker = createRomajiMaker({ start, learning: learning(), idleMs: 60_000 })
    const first = maker.make(['空'])
    fake.reply({ kind: 'made', id: 1, romaji: ['sora'] })
    await first
    vi.advanceTimersByTime(30_000)
    const second = maker.make(['海'])
    fake.reply({ kind: 'made', id: 2, romaji: ['umi'] })
    await second
    expect(start).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(59_000)
    expect(fake.process.killed).toBe(false)
    vi.advanceTimersByTime(1_000)
    expect(fake.process.killed).toBe(true)
    maker.dispose()
  })

  it('treats a reply that does not fit the lines as no romaji', async () => {
    const fake = fakeProcess()
    const maker = createRomajiMaker({ start: () => fake.process, learning: learning() })
    const short = maker.make(['空', '海'])
    fake.reply({ kind: 'made', id: 1, romaji: ['sora'] })
    await expect(short).resolves.toBeNull()
    const odd = maker.make(['空'])
    fake.reply({ kind: 'made', id: 2, romaji: [42] })
    await expect(odd).resolves.toBeNull()
    const failed = maker.make(['空'])
    fake.reply({ kind: 'failed', id: 3 })
    await expect(failed).resolves.toBeNull()
    fake.reply('not a message')
    maker.dispose()
  })

  it('gives no romaji for what was asked when the process stops, and starts a new one next time', async () => {
    const first = fakeProcess()
    const second = fakeProcess()
    const start = vi.fn().mockReturnValueOnce(first.process).mockReturnValueOnce(second.process)
    const maker = createRomajiMaker({ start, learning: learning() })
    const lost = maker.make(['空'])
    first.exit()
    await expect(lost).resolves.toBeNull()
    const again = maker.make(['空'])
    second.reply({ kind: 'made', id: 2, romaji: ['sora'] })
    await expect(again).resolves.toEqual(['sora'])
    expect(start).toHaveBeenCalledTimes(2)
    maker.dispose()
  })

  it('gives up on an answer that takes too long, and stops the process', async () => {
    vi.useFakeTimers()
    const fake = fakeProcess()
    const maker = createRomajiMaker({
      start: () => fake.process,
      learning: learning(),
      timeoutMs: 20_000
    })
    const slow = maker.make(['空'])
    vi.advanceTimersByTime(20_000)
    await expect(slow).resolves.toBeNull()
    expect(fake.process.killed).toBe(true)
    maker.dispose()
  })

  it('gives no romaji when the process cannot be started', async () => {
    const maker = createRomajiMaker({
      start: () => {
        throw new Error('no')
      },
      learning: learning()
    })
    await expect(maker.make(['空'])).resolves.toBeNull()
    maker.dispose()
  })

  it('doesn’t count learning against the song’s time, nor stop the process while it learns', async () => {
    vi.useFakeTimers()
    const fake = fakeProcess()
    const learn = learning(null)
    const maker = createRomajiMaker({
      start: () => fake.process,
      learning: learn,
      timeoutMs: 20_000,
      idleMs: 60_000
    })
    const first = maker.make(['明日を待つ'])
    vi.advanceTimersByTime(25_000)
    expect(fake.process.killed).toBe(false)
    fake.reply({ kind: 'learned', readings: READINGS })
    fake.reply({ kind: 'made', id: 1, romaji: ['asu o matsu'] })
    await expect(first).resolves.toEqual(['asu o matsu'])
    maker.dispose()
  })

  it('keeps a process that’s learning again after the song until it’s done', async () => {
    vi.useFakeTimers()
    const fake = fakeProcess()
    const learn = learning({ stamp: 's0', readings: READINGS }, 's1')
    const maker = createRomajiMaker({ start: () => fake.process, learning: learn, idleMs: 60_000 })
    const first = maker.make(['明日を待つ'])
    fake.reply({ kind: 'made', id: 1, romaji: ['asu o matsu'] })
    await first
    vi.advanceTimersByTime(60_000)
    expect(fake.process.killed).toBe(false)
    fake.reply({ kind: 'learned', readings: READINGS })
    vi.advanceTimersByTime(60_000)
    expect(fake.process.killed).toBe(true)
    maker.dispose()
  })

  it('stops learning that never finishes, and a failed one stops counting as learning', async () => {
    vi.useFakeTimers()
    const fake = fakeProcess()
    const maker = createRomajiMaker({
      start: () => fake.process,
      learning: learning(null),
      learnTimeoutMs: 120_000
    })
    const stuck = maker.make(['空'])
    vi.advanceTimersByTime(120_000)
    await expect(stuck).resolves.toBeNull()
    expect(fake.process.killed).toBe(true)

    const again = fakeProcess()
    const other = createRomajiMaker({
      start: () => again.process,
      learning: learning({ stamp: 's0', readings: READINGS }, 's1'),
      idleMs: 60_000
    })
    const made = other.make(['空'])
    again.reply({ kind: 'made', id: 1, romaji: ['sora'] })
    await made
    again.reply({ kind: 'learnFailed' })
    vi.advanceTimersByTime(60_000)
    expect(again.process.killed).toBe(true)
    maker.dispose()
    other.dispose()
  })

  it('keeps the other lines when one line’s romaji is far too long', async () => {
    const fake = fakeProcess()
    const maker = createRomajiMaker({ start: () => fake.process, learning: learning() })
    const made = maker.make(['空', '海'])
    fake.reply({ kind: 'made', id: 1, romaji: ['a'.repeat(5000), 'umi'] })
    await expect(made).resolves.toEqual([null, 'umi'])
    maker.dispose()
  })

  it('ignores what a stopped process still sends', async () => {
    const first = fakeProcess()
    const second = fakeProcess()
    const learn = learning(null)
    const start = vi.fn().mockReturnValueOnce(first.process).mockReturnValueOnce(second.process)
    const maker = createRomajiMaker({ start, learning: learn })
    void maker.make(['空'])
    first.exit()
    const again = maker.make(['海'])
    first.reply({ kind: 'learned', readings: [['old', 'reading']] })
    first.reply({ kind: 'made', id: 2, romaji: ['wrong'] })
    expect(learn.written).toEqual([])
    second.reply({ kind: 'made', id: 2, romaji: ['umi'] })
    await expect(again).resolves.toEqual(['umi'])
    maker.dispose()
  })
})
