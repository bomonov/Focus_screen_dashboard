import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRemindersClient, HelperUnavailableError } from './client'
import { fakeHelper } from './fakeHelper'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function setup(): {
  helper: ReturnType<typeof fakeHelper>
  client: ReturnType<typeof createRemindersClient>
  events: { access: string[]; changed: number }
} {
  const helper = fakeHelper()
  const events = { access: [] as string[], changed: 0 }
  const client = createRemindersClient(helper.start, {
    access: (status) => events.access.push(status),
    changed: () => events.changed++
  })
  return { helper, client, events }
}

describe('Reminders client', () => {
  it('learns the access status and passes changes on', async () => {
    const { helper, client, events } = setup()
    expect(client.access()).toBeNull()
    const known = client.whenAccessKnown(1000)
    helper.say({ type: 'access', status: 'notDetermined' })
    await expect(known).resolves.toBe('notDetermined')
    helper.say({ type: 'access', status: 'notDetermined' })
    helper.say({ type: 'access', status: 'granted' })
    helper.say({ type: 'changed' })
    helper.say({ type: 'nonsense' })
    expect(events).toEqual({ access: ['notDetermined', 'granted'], changed: 1 })
    expect(client.access()).toBe('granted')
  })

  it('gives up waiting for a helper that never says anything', async () => {
    const { client } = setup()
    const known = client.whenAccessKnown(1000)
    vi.advanceTimersByTime(1000)
    await expect(known).rejects.toBeInstanceOf(HelperUnavailableError)
  })

  it('matches replies to requests by id', async () => {
    const { helper, client } = setup()
    const first = client.request({ op: 'list' }, 1000)
    const second = client.request({ op: 'setDone', item: 'r1', done: true }, 1000)
    expect(helper.sent).toEqual([
      { op: 'list', id: 1 },
      { op: 'setDone', item: 'r1', done: true, id: 2 }
    ])
    helper.say({ type: 'reply', id: 2, ok: true })
    helper.say({ type: 'reply', id: 99, ok: true })
    helper.say({ type: 'reply', id: 1, ok: true, lists: [], items: [] })
    await expect(second).resolves.toMatchObject({ id: 2, ok: true })
    await expect(first).resolves.toMatchObject({ id: 1, lists: [] })
  })

  it('fails requests that time out, and ignores their late replies', async () => {
    const { helper, client } = setup()
    const slow = client.request({ op: 'list' }, 1000)
    vi.advanceTimersByTime(1000)
    await expect(slow).rejects.toBeInstanceOf(HelperUnavailableError)
    expect(() => helper.say({ type: 'reply', id: 1, ok: true })).not.toThrow()
  })

  it('fails what’s pending when the helper stops, and forgets the access status', async () => {
    const { helper, client, events } = setup()
    helper.say({ type: 'access', status: 'granted' })
    const pending = client.request({ op: 'list' }, 1000)
    helper.crash()
    await expect(pending).rejects.toBeInstanceOf(HelperUnavailableError)
    expect(client.access()).toBeNull()
    // Back again: the same status counts as news, so the list gets read again.
    helper.say({ type: 'access', status: 'granted' })
    expect(events.access).toEqual(['granted', 'granted'])
  })

  it('stops the helper and refuses new requests', async () => {
    const { helper, client } = setup()
    client.stop()
    expect(helper.stops).toBe(1)
    await expect(client.request({ op: 'list' }, 1000)).rejects.toBeInstanceOf(
      HelperUnavailableError
    )
    await expect(client.whenAccessKnown(1000)).rejects.toBeInstanceOf(HelperUnavailableError)
  })
})
