import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TodoSourceError } from '../provider'
import { fakeHelper, type FakeHelper } from './fakeHelper'
import {
  ACCESS_PROMPT_TIMEOUT_MS,
  createRemindersProvider,
  HELPER_START_TIMEOUT_MS,
  type RemindersProvider
} from './provider'

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

interface Setup {
  helper: FakeHelper
  provider: RemindersProvider
  saved: boolean[]
  changes: string[]
  itemsChanged: () => number
  settingsOpened: () => number
}

function setup(enabled: boolean, withHelper = true): Setup {
  const helper = fakeHelper()
  const saved: boolean[] = []
  const changes: string[] = []
  let items = 0
  let opened = 0
  const provider = createRemindersProvider({
    startHelper: withHelper ? helper.start : null,
    enabled,
    saveEnabled: (on) => saved.push(on),
    openSystemSettings: () => opened++
  })
  provider.start(
    () => changes.push(provider.connection()),
    () => items++
  )
  return {
    helper,
    provider,
    saved,
    changes,
    itemsChanged: () => items,
    settingsOpened: () => opened
  }
}

const LISTS = [{ id: 'L1', title: 'Home' }]
const ITEM = {
  id: 'r1',
  list: 'L1',
  title: 'Pick up groceries',
  due: { day: '2026-10-14' },
  done: false,
  completedAt: null,
  createdAt: 1
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Apple Reminders provider', () => {
  it('stays off, with no helper running, until connected', () => {
    const { provider, helper } = setup(false)
    expect(provider.connection()).toBe('disconnected')
    expect(helper.starts).toBe(0)
  })

  it('asks macOS on the first connect, then reads the list', async () => {
    const { provider, helper, saved, changes } = setup(false)
    const connecting = provider.connect()
    expect(saved).toEqual([true])
    expect(provider.connection()).toBe('disconnected')
    helper.say({ type: 'access', status: 'notDetermined' })
    await flush()
    expect(provider.connection()).toBe('connecting')
    expect(helper.sent.at(-1)).toMatchObject({ op: 'requestAccess' })

    helper.say({ type: 'access', status: 'granted' })
    helper.reply('requestAccess', { ok: true, status: 'granted' })
    await connecting
    expect(changes).toEqual(['connecting', 'connected'])

    const listing = provider.list()
    await flush()
    helper.reply('list', { ok: true, lists: LISTS, items: [ITEM] })
    await expect(listing).resolves.toEqual([
      {
        id: 'r1',
        title: 'Pick up groceries',
        context: 'Apple Reminders',
        due: { kind: 'day', day: '2026-10-14' },
        done: false,
        completedAt: null
      }
    ])
  })

  it('connects straight away when access was given before', async () => {
    const { provider, helper, changes } = setup(false)
    const connecting = provider.connect()
    helper.say({ type: 'access', status: 'granted' })
    await connecting
    expect(changes).toEqual(['connected'])
    expect(helper.sent).toEqual([])
  })

  it('says how to fix access that was turned down', async () => {
    const { provider, helper } = setup(true)
    const listing = provider.list()
    helper.say({ type: 'access', status: 'denied' })
    await expect(listing).rejects.toMatchObject({
      kind: 'permission',
      message: expect.stringContaining('Privacy & Security › Reminders')
    })
    expect(helper.sent).toEqual([])
  })

  it('treats access blocked by Screen Time or a profile as a setup problem', async () => {
    const { provider, helper } = setup(true)
    helper.say({ type: 'access', status: 'restricted' })
    await expect(provider.list()).rejects.toMatchObject({ kind: 'setup' })
  })

  it('asks again on its own if macOS forgot, but only once', async () => {
    const { provider, helper } = setup(true)
    helper.say({ type: 'access', status: 'notDetermined' })
    expect(provider.connection()).toBe('connecting')
    helper.reply('requestAccess', { ok: true, status: 'notDetermined' })
    await flush()
    expect(provider.connection()).toBe('connected')
    helper.crash()
    helper.say({ type: 'access', status: 'notDetermined' })
    expect(provider.connection()).toBe('connected')
    await expect(provider.list()).rejects.toMatchObject({ kind: 'permission' })
  })

  it('opens System Settings for denied access, but asks macOS if it never was', async () => {
    const { provider, helper, settingsOpened } = setup(true)
    helper.say({ type: 'access', status: 'denied' })
    provider.openPrivacySettings()
    expect(settingsOpened()).toBe(1)

    const second = setup(true)
    second.helper.say({ type: 'access', status: 'notDetermined' })
    second.helper.reply('requestAccess', { ok: true, status: 'notDetermined' })
    await flush()
    second.provider.openPrivacySettings()
    expect(second.provider.connection()).toBe('connecting')
    expect(second.settingsOpened()).toBe(0)
  })

  it('gives up on an unanswered prompt after a while and stays connected', async () => {
    const { provider, helper } = setup(false)
    const connecting = provider.connect()
    helper.say({ type: 'access', status: 'notDetermined' })
    await flush()
    vi.advanceTimersByTime(ACCESS_PROMPT_TIMEOUT_MS)
    await connecting
    expect(provider.connection()).toBe('connected')
  })

  it('reads again when Reminders changes or access changes', async () => {
    const { helper, itemsChanged } = setup(true)
    helper.say({ type: 'access', status: 'granted' })
    helper.say({ type: 'changed' })
    helper.say({ type: 'access', status: 'denied' })
    expect(itemsChanged()).toBe(3)
  })

  it('checks reminders off and explains refusals', async () => {
    const { provider, helper } = setup(true)
    helper.say({ type: 'access', status: 'granted' })
    const done = provider.setDone('r1', true)
    expect(helper.sent.at(-1)).toMatchObject({ op: 'setDone', item: 'r1', done: true })
    helper.reply('setDone', { ok: true })
    await expect(done).resolves.toBeUndefined()

    const gone = provider.setDone('r2', true)
    helper.reply('setDone', { ok: false, error: 'notFound' })
    await expect(gone).rejects.toMatchObject({
      kind: 'offline',
      message: 'It’s no longer in Reminders.'
    })
    const shared = provider.setDone('r3', false)
    helper.reply('setDone', { ok: false, error: 'readOnly' })
    await expect(shared).rejects.toMatchObject({ kind: 'offline' })
    const denied = provider.setDone('r4', true)
    helper.reply('setDone', { ok: false, error: 'access', status: 'denied' })
    await expect(denied).rejects.toMatchObject({ kind: 'permission' })
  })

  it('counts a helper that never starts, or stops mid-list, as offline', async () => {
    const { provider, helper } = setup(true)
    const silent = provider.list()
    vi.advanceTimersByTime(HELPER_START_TIMEOUT_MS)
    await expect(silent).rejects.toMatchObject({ kind: 'offline' })

    helper.say({ type: 'access', status: 'granted' })
    const listing = provider.list()
    await flush()
    helper.crash()
    await expect(listing).rejects.toBeInstanceOf(TodoSourceError)
  })

  it('rejects a list reply it can’t read', async () => {
    const { provider, helper } = setup(true)
    helper.say({ type: 'access', status: 'granted' })
    const listing = provider.list()
    await flush()
    helper.reply('list', { ok: true })
    await expect(listing).rejects.toMatchObject({
      kind: 'offline',
      message: 'Apple Reminders sent something unexpected.'
    })
  })

  it('says how to build a missing helper', async () => {
    const { provider } = setup(true, false)
    await expect(provider.list()).rejects.toMatchObject({
      kind: 'setup',
      message: expect.stringContaining('npm run build:reminders')
    })
  })

  it('disconnects: stops the helper, saves the choice, and drops a prompt in flight', async () => {
    const { provider, helper, saved, changes } = setup(false)
    const connecting = provider.connect()
    helper.say({ type: 'access', status: 'notDetermined' })
    await flush()
    provider.disconnect()
    await connecting
    expect(provider.connection()).toBe('disconnected')
    expect(saved).toEqual([true, false])
    expect(helper.stops).toBe(1)
    expect(changes).toEqual(['connecting', 'disconnected'])
  })
})
