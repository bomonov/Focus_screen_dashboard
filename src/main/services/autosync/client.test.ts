import { describe, expect, it } from 'vitest'
import { createAudioHelperClient } from './client'

/** A helper that records what it's sent; the test plays its side of the conversation. */
function fakeHelper(): {
  sent: Record<string, unknown>[]
  say(message: unknown): void
  exit(): void
  start: Parameters<typeof createAudioHelperClient>[0]
} {
  const sent: Record<string, unknown>[] = []
  let handlers: { onMessage(message: unknown): void; onExit(): void } | null = null
  return {
    sent,
    say: (message) => handlers?.onMessage(message),
    exit: () => handlers?.onExit(),
    start(given) {
      handlers = given
      return {
        send(message) {
          sent.push(message as Record<string, unknown>)
          return true
        },
        stop: () => undefined
      }
    }
  }
}

const answer = (helper: ReturnType<typeof fakeHelper>, ok = true): void => {
  const last = helper.sent.at(-1)
  helper.say({ type: 'reply', id: last?.id, ok, ...(ok ? {} : { error: 'failed' }) })
}

describe('audio helper client', () => {
  it('mutes and unmutes the player', async () => {
    const helper = fakeHelper()
    const client = createAudioHelperClient(helper.start)
    helper.say({ type: 'access', status: 'granted' })

    const muting = client.mute(true, ['com.apple.WebKit.GPU', 'com.apple.Safari'])
    expect(helper.sent.at(-1)).toEqual({
      op: 'mute',
      on: true,
      bundles: ['com.apple.WebKit.GPU', 'com.apple.Safari'],
      id: 1
    })
    answer(helper)
    expect(await muting).toEqual({ ok: true, error: null })

    const unmuting = client.mute(false)
    expect(helper.sent.at(-1)).toEqual({ op: 'mute', on: false, id: 2 })
    answer(helper, false)
    expect(await unmuting).toEqual({ ok: false, error: 'failed' })
  })

  it('mutes a restarted helper again, but not once unmuted', () => {
    const helper = fakeHelper()
    const client = createAudioHelperClient(helper.start)
    helper.say({ type: 'access', status: 'granted' })
    void client.mute(true, ['com.apple.Music'])
    answer(helper)

    helper.exit()
    helper.say({ type: 'access', status: 'granted' })
    expect(helper.sent.at(-1)).toMatchObject({ op: 'mute', on: true, bundles: ['com.apple.Music'] })

    void client.mute(false)
    helper.exit()
    const before = helper.sent.length
    helper.say({ type: 'access', status: 'granted' })
    expect(helper.sent).toHaveLength(before)
  })
})
