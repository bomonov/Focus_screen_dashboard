import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StartAudioHelper } from '../../autosync/client'

// The tap is a thin cover over the audio helper's client; the helper itself is a fake that
// records what it's sent and lets the test speak for it. Nothing here runs the real helper.

let dir: string
let helperPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focus-screen-tap-'))
  helperPath = join(dir, 'focus-screen-audio')
  vi.resetModules()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.doUnmock('../../../platform')
  vi.doUnmock('../../../paths')
})

/** The tap module as it is on a Mac (or not), with the helper expected at `helperPath`. */
async function loadTap(mac: boolean): Promise<typeof import('./tap')> {
  vi.doMock('../../../platform', () => ({ isMac: mac }))
  vi.doMock('../../../paths', () => ({ audioHelperPath: helperPath }))
  return import('./tap')
}

function fakeHelper(): {
  start: StartAudioHelper
  sent: Record<string, unknown>[]
  stopped: ReturnType<typeof vi.fn>
  say(message: unknown): void
} {
  const sent: Record<string, unknown>[] = []
  const stopped = vi.fn()
  let onMessage: (message: unknown) => void = () => undefined
  const start: StartAudioHelper = (handlers) => {
    onMessage = handlers.onMessage
    return {
      send(message) {
        sent.push(message as Record<string, unknown>)
        return true
      },
      stop: stopped
    }
  }
  return { start, sent, stopped, say: (message) => onMessage(message) }
}

describe('singerTapOver', () => {
  it('starts, stops and reports access through the helper', async () => {
    const { singerTapOver } = await loadTap(true)
    const helper = fakeHelper()
    const tap = singerTapOver(helper.start)

    expect(tap.access()).toBeNull()
    helper.say({ type: 'access', status: 'denied' })
    expect(tap.access()).toBe('denied')

    const started = tap.start(['com.apple.WebKit.GPU', 'com.apple.Safari'])
    expect(helper.sent[0]).toMatchObject({
      op: 'start',
      bundles: ['com.apple.WebKit.GPU', 'com.apple.Safari']
    })
    helper.say({ type: 'reply', id: helper.sent[0]?.id, ok: false, error: 'noProcess' })
    expect(await started).toEqual({ ok: false, error: 'noProcess' })

    tap.stop()
    expect(helper.sent[1]).toMatchObject({ op: 'stop' })
  })

  it('passes the audio on until the listener leaves', async () => {
    const { singerTapOver } = await loadTap(true)
    const helper = fakeHelper()
    const tap = singerTapOver(helper.start)
    const heard = vi.fn()
    const leave = tap.onAudio(heard)

    const pcm = Buffer.from(new Int16Array([1, -2, 3]).buffer).toString('base64')
    helper.say({ type: 'audio', at: 1000.5, pcm })
    expect(heard).toHaveBeenCalledTimes(1)
    expect(heard.mock.calls[0]?.[0]).toBe(1000.5)
    expect(Array.from(heard.mock.calls[0]?.[1] as Int16Array)).toEqual([1, -2, 3])

    leave()
    helper.say({ type: 'audio', at: 1000.6, pcm })
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('lets the helper go with the tap, and offers nothing the editor shouldn’t use', async () => {
    const { singerTapOver } = await loadTap(true)
    const helper = fakeHelper()
    const tap = singerTapOver(helper.start)
    tap.dispose()
    expect(helper.stopped).toHaveBeenCalledTimes(1)
    // The editor listens; it never mutes the player or asks macOS on its own.
    expect(Object.keys(tap).sort()).toEqual(['access', 'dispose', 'onAudio', 'start', 'stop'])
  })
})

describe('openSingerTap', () => {
  it('is null on Windows, whatever is on disk', async () => {
    writeFileSync(helperPath, '')
    const { openSingerTap, noTapNote } = await loadTap(false)
    expect(openSingerTap()).toBeNull()
    expect(noTapNote()).toBe("There's no waveform on Windows yet.")
  })

  it('is null when the audio helper isn’t built', async () => {
    const { openSingerTap, noTapNote } = await loadTap(true)
    expect(openSingerTap()).toBeNull()
    expect(noTapNote()).toBe("There's no waveform: the audio helper isn't built on this Mac.")
  })
})
