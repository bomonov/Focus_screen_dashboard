import { describe, expect, it, vi } from 'vitest'
import type { PlaybackState } from '../music/types'
import type { TodoState } from '../todos/types'
import type { BrowserLink } from './cardStatus'
import { createStatusService } from './service'

const NOW = 1_800_000_000

function source<T>(initial: T): {
  get(): T
  subscribe(listener: () => void): () => void
  set(value: T): void
} {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      value = next
      for (const listener of listeners) listener()
    }
  }
}

const PAUSED: PlaybackState = {
  player: { id: 'ytmSafari', name: 'YouTube Music' },
  track: null,
  playing: false,
  positionSec: 0,
  positionAt: NOW,
  shuffle: false,
  repeat: 'off',
  repeatModes: ['off', 'all', 'one'],
  problem: null,
  supportedPlayers: []
}

const NO_TODOS: TodoState = {
  sources: [],
  items: [],
  exams: [],
  classes: [],
  supported: [],
  demo: false,
  notice: null
}

function setup(): {
  music: ReturnType<typeof source<PlaybackState>>
  browsers: ReturnType<typeof source<readonly BrowserLink[]>>
  service: ReturnType<typeof createStatusService>
} {
  const music = source(PAUSED)
  const browsers = source<readonly BrowserLink[]>([
    { name: 'Safari', paired: true, link: 'connected' }
  ])
  const service = createStatusService({
    music,
    todos: source(NO_TODOS),
    browsers,
    now: () => NOW
  })
  return { music, browsers, service }
}

describe('status service', () => {
  it('tells listeners when a dot changes, and not on every music tick', () => {
    const { music, browsers, service } = setup()
    const listener = vi.fn()
    service.subscribe(listener)

    music.set({ ...PAUSED, positionSec: 12 })
    expect(listener).not.toHaveBeenCalled()

    music.set({ ...PAUSED, player: null })
    browsers.set([{ name: 'Safari', paired: true, link: 'off' }])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.lastCall?.[0].music.tone).toBe('problem')
  })

  it('stops listening once disposed', () => {
    const { browsers, service } = setup()
    const listener = vi.fn()
    service.subscribe(listener)
    service.dispose()
    browsers.set([{ name: 'Safari', paired: true, link: 'off' }])
    expect(listener).not.toHaveBeenCalled()
  })
})
