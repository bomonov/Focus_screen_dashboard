import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHaptics, type HapticsProcess } from './haptics'

function fakeProcess(): HapticsProcess & { lines: string[]; exit(): void; killed: boolean } {
  let onExit = (): void => {}
  const fake = {
    lines: [] as string[],
    killed: false,
    write(line: string) {
      fake.lines.push(line)
    },
    onExit(listener: () => void) {
      onExit = listener
    },
    kill() {
      fake.killed = true
    },
    exit() {
      onExit()
    }
  }
  return fake
}

describe('the trackpad’s tick for the timer wheels', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts the helper when the wheels open, so the first tick isn’t late', () => {
    const started: ReturnType<typeof fakeProcess>[] = []
    const haptics = createHaptics({ start: () => (started.push(fakeProcess()), started.at(-1)!) })
    haptics.warm()
    haptics.warm()
    expect(started).toHaveLength(1)
  })

  it('sends one line a tick', () => {
    const process = fakeProcess()
    const haptics = createHaptics({ start: () => process })
    haptics.tick()
    vi.advanceTimersByTime(100)
    haptics.tick()
    expect(process.lines).toEqual(['tick\n', 'tick\n'])
  })

  it('sends a firmer tick for a wheel that comes onto zero fast', () => {
    const process = fakeProcess()
    const haptics = createHaptics({ start: () => process })
    haptics.tick(true)
    vi.advanceTimersByTime(100)
    haptics.tick(false)
    expect(process.lines).toEqual(['tick firm\n', 'tick\n'])
  })

  it('doesn’t pile ticks up while a fast scroll passes zero again and again', () => {
    const process = fakeProcess()
    const haptics = createHaptics({ start: () => process })
    haptics.tick()
    haptics.tick()
    vi.advanceTimersByTime(20)
    haptics.tick()
    expect(process.lines).toHaveLength(1)
  })

  it('stops the helper once the wheels have been quiet a minute', () => {
    const process = fakeProcess()
    const haptics = createHaptics({ start: () => process })
    haptics.tick()
    vi.advanceTimersByTime(59_000)
    expect(process.killed).toBe(false)
    vi.advanceTimersByTime(2_000)
    expect(process.killed).toBe(true)
  })

  it('starts it again after it went away', () => {
    const first = fakeProcess()
    const second = fakeProcess()
    const queue = [first, second]
    const haptics = createHaptics({ start: () => queue.shift()! })
    haptics.tick()
    first.exit()
    vi.advanceTimersByTime(100)
    haptics.tick()
    expect(second.lines).toEqual(['tick\n'])
  })

  it('gives up on a helper that won’t start, rather than trying on every tick', () => {
    const start = vi.fn(() => {
      throw new Error('no helper')
    })
    const haptics = createHaptics({ start })
    haptics.tick()
    vi.advanceTimersByTime(100)
    haptics.tick()
    expect(start).toHaveBeenCalledTimes(1)
  })
})
