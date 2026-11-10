import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDropGrace } from './dropGrace'

describe('createDropGrace', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('calls a browser gone only once the grace period passes', () => {
    const gone: string[] = []
    const grace = createDropGrace<string>(30_000, (key) => gone.push(key))
    grace.dropped('safari')
    vi.advanceTimersByTime(29_999)
    expect(gone).toEqual([])
    vi.advanceTimersByTime(1)
    expect(gone).toEqual(['safari'])
  })

  it('forgets the drop when the browser comes back in time', () => {
    const gone: string[] = []
    const grace = createDropGrace<string>(30_000, (key) => gone.push(key))
    grace.dropped('safari')
    vi.advanceTimersByTime(10_000)
    grace.back('safari')
    vi.advanceTimersByTime(60_000)
    expect(gone).toEqual([])
  })

  it('times each browser on its own, and restarts the wait on a second drop', () => {
    const gone: string[] = []
    const grace = createDropGrace<string>(30_000, (key) => gone.push(key))
    grace.dropped('safari')
    vi.advanceTimersByTime(20_000)
    grace.dropped('chrome')
    grace.dropped('safari')
    vi.advanceTimersByTime(29_000)
    expect(gone).toEqual([])
    vi.advanceTimersByTime(1000)
    expect(gone.sort()).toEqual(['chrome', 'safari'])
  })

  it('stops every wait when disposed', () => {
    const gone: string[] = []
    const grace = createDropGrace<string>(30_000, (key) => gone.push(key))
    grace.dropped('safari')
    grace.dispose()
    vi.advanceTimersByTime(60_000)
    expect(gone).toEqual([])
  })
})
