import { describe, expect, it } from 'vitest'
import { defaultSettings, type Settings } from '../settings/schema'
import { fakeHelper, type FakeHelper } from '../todos/apple-reminders/fakeHelper'
import type { GoogleCalendar } from './google'
import { parseEventsReply } from './protocol'
import { createCalendarService, eventWindow, type CalendarService } from './service'
import type { CalendarInfo, ClassEvent } from './types'

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function settingsStore(initial: Settings): {
  get(): Settings
  subscribe(listener: (settings: Settings) => void): () => void
  set(change: (current: Settings) => Settings): void
} {
  let current = initial
  const listeners = new Set<(settings: Settings) => void>()
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(change) {
      current = change(current)
      for (const listener of listeners) listener(current)
    }
  }
}

function withNextClass(on: boolean, calendars: string[] = []): Settings {
  const base = defaultSettings()
  return {
    ...base,
    widgets: { ...base.widgets, nextClass: on },
    nextClass: { ...base.nextClass, calendars }
  }
}

const NOW = new Date(2026, 9, 15, 10, 0)
const CALENDARS = [
  { id: 'C1', title: 'Classes', source: 'iCloud', color: '#FFC627' },
  { id: 'C2', title: 'Work', source: 'Google', color: 'red' }
]
const EVENT = {
  id: 'e1@1',
  calendar: 'C1',
  title: 'BIO 181',
  location: 'LSE 104',
  start: NOW.getTime() / 1000 + 1800,
  end: NOW.getTime() / 1000 + 6300
}

interface Setup {
  helper: FakeHelper
  store: ReturnType<typeof settingsStore>
  service: CalendarService
  opened: () => number
}

function setup(settings: Settings, opts: { supported?: boolean; helper?: boolean } = {}): Setup {
  const helper = fakeHelper()
  const store = settingsStore(settings)
  let opened = 0
  const service = createCalendarService({
    settings: store,
    supported: opts.supported ?? true,
    startHelper: opts.helper === false ? null : helper.start,
    demo: true,
    openSystemSettings: () => opened++,
    now: () => NOW
  })
  return { helper, store, service, opened: () => opened }
}

describe('eventWindow', () => {
  it('covers today and the week after it in local time', () => {
    const { from, to } = eventWindow(NOW)
    expect(new Date(from * 1000)).toEqual(new Date(2026, 9, 15))
    expect(new Date(to * 1000)).toEqual(new Date(2026, 9, 23))
  })

  it('stays within the 8 × 24 h the helper takes across a clock change', () => {
    const zone = process.env.TZ
    // Node reads TZ again when it's set; New York's clocks go back on 1 Nov 2026.
    process.env.TZ = 'America/New_York'
    try {
      const { from, to } = eventWindow(new Date(2026, 9, 28, 12, 0))
      expect(new Date(from * 1000)).toEqual(new Date(2026, 9, 28))
      expect(to - from).toBe(8 * 24 * 3600)
    } finally {
      if (zone === undefined) delete process.env.TZ
      else process.env.TZ = zone
    }
  })
})

describe('parseEventsReply', () => {
  it('keeps well-formed events in start order and drops the rest', () => {
    const later = { ...EVENT, id: 'e2@2', start: EVENT.start + 7200, end: EVENT.end + 7200 }
    const reply = parseEventsReply({
      ok: true,
      events: [
        later,
        EVENT,
        { ...EVENT, id: '' },
        { ...EVENT, id: 'e3', end: EVENT.start - 1 },
        { ...EVENT, id: 'e4', end: EVENT.start + 2 * 86400 }
      ]
    })
    expect(reply).toEqual({ ok: true, events: [EVENT, later] })
  })

  it('reads a refusal as an access answer', () => {
    expect(parseEventsReply({ ok: false, error: 'access', status: 'denied' })).toEqual({
      ok: false,
      access: 'denied'
    })
    expect(parseEventsReply({ ok: true })).toBeNull()
  })
})

describe('createCalendarService', () => {
  it('starts nothing while Next class is off', () => {
    const { helper, service } = setup(withNextClass(false))
    expect(helper.starts).toBe(0)
    expect(service.get()).toMatchObject({ supported: true, access: null, events: [] })
  })

  it('asks macOS once when it never was', async () => {
    const { helper, store } = setup(withNextClass(false))
    store.set((s) => ({ ...s, widgets: { ...s.widgets, nextClass: true } }))
    expect(helper.starts).toBe(1)
    helper.say({ type: 'access', status: 'notDetermined' })
    await flush()
    expect(helper.sent.filter((m) => m.op === 'requestAccess')).toHaveLength(1)
    helper.reply('requestAccess', { ok: true, status: 'denied' })
    helper.say({ type: 'access', status: 'denied' })
    await flush()
    expect(helper.sent.filter((m) => m.op === 'requestAccess')).toHaveLength(1)
  })

  it('reads the picked calendars that still exist', async () => {
    const { helper, service } = setup(withNextClass(true, ['C1', 'gone']))
    helper.say({ type: 'access', status: 'granted' })
    await flush()
    helper.reply('calendars', { ok: true, calendars: CALENDARS })
    await flush()
    const request = helper.sent.find((m) => m.op === 'events')
    expect(request).toMatchObject({ calendars: ['C1'], ...eventWindow(NOW) })
    helper.reply('events', { ok: true, events: [EVENT] })
    await flush()
    expect(service.get()).toMatchObject({
      access: 'granted',
      calendars: [CALENDARS[0], { ...CALENDARS[1], color: '' }],
      events: [EVENT],
      problem: null
    })
  })

  it('reads no events until a class calendar is picked, then reads them', async () => {
    const { helper, store, service } = setup(withNextClass(true))
    helper.say({ type: 'access', status: 'granted' })
    await flush()
    helper.reply('calendars', { ok: true, calendars: CALENDARS })
    await flush()
    expect(helper.sent.some((m) => m.op === 'events')).toBe(false)
    expect(service.get().calendars).toHaveLength(2)

    store.set((s) => ({ ...s, nextClass: { ...s.nextClass, calendars: ['C1'] } }))
    await flush()
    helper.reply('calendars', { ok: true, calendars: CALENDARS })
    await flush()
    helper.reply('events', { ok: true, events: [EVENT] })
    await flush()
    expect(service.get().events).toEqual([EVENT])
  })

  it('reads again when Calendar changes', async () => {
    const { helper } = setup(withNextClass(true, ['C1']))
    helper.say({ type: 'access', status: 'granted' })
    await flush()
    helper.reply('calendars', { ok: true, calendars: CALENDARS })
    await flush()
    helper.reply('events', { ok: true, events: [] })
    await flush()
    helper.say({ type: 'changed' })
    await flush()
    expect(helper.sent.filter((m) => m.op === 'calendars')).toHaveLength(2)
  })

  it('stops the helper and forgets everything when turned off', async () => {
    const { helper, store, service } = setup(withNextClass(true, ['C1']))
    helper.say({ type: 'access', status: 'granted' })
    await flush()
    helper.reply('calendars', { ok: true, calendars: CALENDARS })
    await flush()
    helper.reply('events', { ok: true, events: [EVENT] })
    await flush()
    store.set((s) => ({ ...s, widgets: { ...s.widgets, nextClass: false } }))
    expect(helper.stops).toBe(1)
    expect(service.get()).toMatchObject({ access: null, calendars: [], events: [] })
  })

  it('says so when the helper isn’t built, and does nothing off macOS', () => {
    expect(setup(withNextClass(true), { helper: false }).service.get().problem).toMatch(
      /build:reminders/
    )
    const { helper, service } = setup(withNextClass(true), { supported: false })
    expect(helper.starts).toBe(0)
    expect(service.get().supported).toBe(false)
  })

  it('opens System Settings once macOS has answered', async () => {
    const { helper, service, opened } = setup(withNextClass(true))
    helper.say({ type: 'access', status: 'denied' })
    await flush()
    service.openPrivacySettings()
    expect(opened()).toBe(1)
  })

  it('shows made-up classes in the demo', () => {
    const { service } = setup(withNextClass(false))
    service.setDemoEnabled(true)
    expect(service.get().demo).toBe(true)
    expect(service.get().events.length).toBeGreaterThan(0)
  })
})

describe('Google Calendar beside Apple’s', () => {
  const GOOGLE_CALENDAR: CalendarInfo = {
    id: 'google:cal',
    title: 'ASU classes',
    source: 'Google Calendar',
    color: ''
  }
  const GOOGLE_EVENT: ClassEvent = {
    id: 'google:cal:e2',
    calendar: 'google:cal',
    title: 'CSE 230',
    location: 'BYENG 210',
    start: EVENT.start - 600,
    end: EVENT.start + 3000
  }

  function fakeGoogleCalendar(state: 'connected' | 'disconnected' = 'connected'): GoogleCalendar & {
    asked: string[][]
    fail: Error | null
  } {
    const asked: string[][] = []
    return {
      asked,
      fail: null,
      state: () => state,
      hasClient: () => true,
      setClient: () => undefined,
      connect: async () => ({ kind: 'connected' }),
      cancelConnect: () => undefined,
      disconnect: async () => undefined,
      onChange: () => () => undefined,
      async calendars() {
        if (this.fail) throw this.fail
        return [GOOGLE_CALENDAR]
      },
      async events(ids) {
        asked.push([...ids])
        return [GOOGLE_EVENT]
      }
    }
  }

  function setupWith(google: GoogleCalendar, picked: string[]): Setup {
    const helper = fakeHelper()
    const store = settingsStore(withNextClass(true, picked))
    const service = createCalendarService({
      settings: store,
      supported: true,
      startHelper: helper.start,
      demo: false,
      openSystemSettings: () => undefined,
      google,
      now: () => NOW
    })
    return { helper, store, service, opened: () => 0 }
  }

  it('lists Google’s calendars too, and reads only the picked ones, by their own ids', async () => {
    const google = fakeGoogleCalendar()
    const { service } = setupWith(google, ['google:cal'])
    await flush()
    expect(service.get().calendars).toContainEqual(GOOGLE_CALENDAR)
    expect(service.get().events).toEqual([GOOGLE_EVENT])
    expect(google.asked).toEqual([['cal']])
    expect(service.get().google).toEqual({ connection: 'connected', problem: null })
  })

  it('says what went wrong with Google, without touching Apple’s side', async () => {
    const google = fakeGoogleCalendar()
    google.fail = new Error('boom')
    const { service } = setupWith(google, ['google:cal'])
    await flush()
    expect(service.get().google?.problem).toBe('Couldn’t read Google Calendar.')
    expect(service.get().problem).toBeNull()
  })

  it('reads nothing from Google until signed in', async () => {
    const google = fakeGoogleCalendar('disconnected')
    const { service } = setupWith(google, ['google:cal'])
    await flush()
    expect(service.get().calendars).not.toContainEqual(GOOGLE_CALENDAR)
    expect(google.asked).toEqual([])
  })
})
