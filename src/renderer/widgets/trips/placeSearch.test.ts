import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Place } from '../../../main/ipc'
import { APPLE_DELAY_MS, createPlaceSearch, type PlaceResults } from './placeSearch'

const place = (name: string, kind: Place['kind'] = 'stop'): Place => ({
  id: `${kind}:${name}`,
  kind,
  name,
  detail: '',
  lat: 33.4,
  lon: -111.9
})

/** An answer the test lets go of when it wants, so late answers can be made. */
function held<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

interface Rig {
  local: ReturnType<typeof vi.fn<(text: string) => Promise<Place[]>>>
  apple: ReturnType<typeof vi.fn<(text: string) => Promise<Place[]>>>
  shown: PlaceResults[]
  last(): PlaceResults | undefined
  appleOn: { value: boolean }
}

function rig(): Rig & { search: ReturnType<typeof createPlaceSearch> } {
  const local = vi.fn((text: string) => Promise.resolve([place(`${text} local`)]))
  const apple = vi.fn((text: string) => Promise.resolve([place(`${text} apple`, 'apple')]))
  const shown: PlaceResults[] = []
  const appleOn = { value: true }
  const search = createPlaceSearch({
    local,
    apple,
    appleOn: () => appleOn.value,
    onResults: (results) => shown.push(results)
  })
  return { local, apple, shown, last: () => shown.at(-1), appleOn, search }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createPlaceSearch', () => {
  it('asks the Mac at once on every change, and Apple only after a pause', async () => {
    const { local, apple, last, search } = rig()
    search.type('tr')
    search.type('tra')
    expect(local.mock.calls).toEqual([['tr'], ['tra']])
    await vi.advanceTimersByTimeAsync(APPLE_DELAY_MS - 1)
    expect(apple).not.toHaveBeenCalled()
    expect(last()).toEqual({
      text: 'tra',
      local: [place('tra local')],
      apple: [],
      localWaiting: false,
      appleWaiting: true
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(apple.mock.calls).toEqual([['tra']])
    expect(last()).toEqual({
      text: 'tra',
      local: [place('tra local')],
      apple: [place('tra apple', 'apple')],
      localWaiting: false,
      appleWaiting: false
    })
  })

  it('keeps the last words’ rows up while the new words’ answer is on its way', async () => {
    const { local, last, search } = rig()
    search.type('tar')
    await vi.advanceTimersByTimeAsync(APPLE_DELAY_MS)
    const slow = held<Place[]>()
    local.mockReturnValueOnce(slow.promise)
    search.type('targ')
    expect(last()).toEqual({
      text: 'targ',
      local: [place('tar local')],
      apple: [place('tar apple', 'apple')],
      localWaiting: true,
      appleWaiting: true
    })
    slow.resolve([place('targ local')])
    await vi.advanceTimersByTimeAsync(0)
    // Apple's rows for the old words go with them; its answer for these is still to come.
    expect(last()).toEqual({
      text: 'targ',
      local: [place('targ local')],
      apple: [],
      localWaiting: false,
      appleWaiting: true
    })
  })

  it('says Apple isn’t coming when it won’t be asked, so nothing found can be said', async () => {
    const { local, last, appleOn, search } = rig()
    local.mockResolvedValue([])
    search.type('z')
    await vi.advanceTimersByTimeAsync(0)
    expect(last()).toMatchObject({ localWaiting: false, appleWaiting: false })
    appleOn.value = false
    search.type('zzz')
    await vi.advanceTimersByTimeAsync(0)
    expect(last()).toMatchObject({ localWaiting: false, appleWaiting: false })
  })

  it('waits 400 ms after the last key, not the first', async () => {
    const { apple, search } = rig()
    search.type('ta')
    await vi.advanceTimersByTimeAsync(300)
    search.type('tar')
    await vi.advanceTimersByTimeAsync(300)
    expect(apple).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(apple.mock.calls).toEqual([['tar']])
  })

  it('never asks Apple for one character, blank words or with no helper', async () => {
    const { apple, appleOn, search } = rig()
    search.type('t')
    search.type(' t  ')
    await vi.advanceTimersByTimeAsync(APPLE_DELAY_MS * 2)
    expect(apple).not.toHaveBeenCalled()
    appleOn.value = false
    search.type('target')
    await vi.advanceTimersByTimeAsync(APPLE_DELAY_MS * 2)
    expect(apple).not.toHaveBeenCalled()
  })

  it('counts characters, not UTF-16 units: one emoji is one', async () => {
    const { apple, search } = rig()
    search.type('🍕')
    await vi.advanceTimersByTimeAsync(APPLE_DELAY_MS)
    expect(apple).not.toHaveBeenCalled()
    search.type('é1')
    await vi.advanceTimersByTimeAsync(APPLE_DELAY_MS)
    expect(apple).toHaveBeenCalledTimes(1)
  })

  it('drops an answer that comes back for words no longer in the field', async () => {
    const { local, apple, last, search } = rig()
    const slowLocal = held<Place[]>()
    local.mockReturnValueOnce(slowLocal.promise)
    const slowApple = held<Place[]>()
    apple.mockReturnValueOnce(slowApple.promise)
    search.type('mill')
    await vi.advanceTimersByTimeAsync(APPLE_DELAY_MS)
    search.type('mill av')
    await vi.advanceTimersByTimeAsync(0)
    slowLocal.resolve([place('stale local')])
    slowApple.resolve([place('stale apple', 'apple')])
    await vi.advanceTimersByTimeAsync(0)
    expect(last()).toEqual({
      text: 'mill av',
      local: [place('mill av local')],
      apple: [],
      localWaiting: false,
      appleWaiting: true
    })
  })

  it('clears at once when the field is emptied, and drops answers on their way', async () => {
    const { local, apple, last, search } = rig()
    const slow = held<Place[]>()
    local.mockReturnValueOnce(slow.promise)
    const cleared = { text: '', local: [], apple: [], localWaiting: false, appleWaiting: false }
    search.type('home')
    search.type('')
    expect(last()).toEqual(cleared)
    slow.resolve([place('home local')])
    await vi.advanceTimersByTimeAsync(APPLE_DELAY_MS * 2)
    expect(apple).not.toHaveBeenCalled()
    expect(last()).toEqual(cleared)
    expect(local).toHaveBeenCalledTimes(1)
  })

  it('shows the Mac’s own matches when Apple’s search fails, without its heading', async () => {
    const { apple, last, search } = rig()
    apple.mockRejectedValueOnce(new Error('helper gone'))
    search.type('target')
    await vi.advanceTimersByTimeAsync(APPLE_DELAY_MS)
    expect(last()).toEqual({
      text: 'target',
      local: [place('target local')],
      apple: [],
      localWaiting: false,
      appleWaiting: false
    })
  })

  it('shows no matches, rather than old ones, when the Mac’s own search fails', async () => {
    const { local, last, search } = rig()
    local.mockRejectedValueOnce(new Error('no answer'))
    search.type('rural')
    await vi.advanceTimersByTimeAsync(0)
    expect(last()?.local).toEqual([])
  })

  it('treats junk from Apple as nothing found', async () => {
    const { apple, last, search } = rig()
    apple.mockResolvedValueOnce('junk' as unknown as Place[])
    search.type('target')
    await vi.advanceTimersByTimeAsync(APPLE_DELAY_MS)
    expect(last()?.apple).toEqual([])
  })

  it('asks the Mac again for the same words after a place is saved, not Apple', async () => {
    const { local, apple, search } = rig()
    search.type('target')
    await vi.advanceTimersByTimeAsync(APPLE_DELAY_MS)
    search.refresh()
    await vi.advanceTimersByTimeAsync(APPLE_DELAY_MS)
    expect(local.mock.calls).toEqual([['target'], ['target']])
    expect(apple).toHaveBeenCalledTimes(1)
  })

  it('stops for good once disposed', async () => {
    const { apple, shown, search } = rig()
    search.type('target')
    const before = shown.length
    search.dispose()
    await vi.advanceTimersByTimeAsync(APPLE_DELAY_MS * 2)
    expect(apple).not.toHaveBeenCalled()
    expect(shown.length).toBe(before)
    search.type('more')
    expect(shown.length).toBe(before)
  })
})
