import type { SettingsStore } from '../settings/store'
// The Reminders helper's client works for both of its modes: same lines, same replies.
import {
  createRemindersClient,
  type RemindersClient,
  type StartHelper
} from '../todos/apple-reminders/client'
import { GOOGLE_ID_PREFIX, GoogleCalendarError, type GoogleCalendar } from './google'
import { demoCalendars, demoEvents } from './mock'
import { parseCalendarsReply, parseEventsReply } from './protocol'
import type {
  CalendarAccess,
  CalendarInfo,
  CalendarState,
  ClassEvent,
  GoogleCalendarStatus
} from './types'

/** EventKit can take a while on a big account. */
export const READ_TIMEOUT_MS = 30_000
/** Long enough to read the macOS prompt and answer it. */
export const ACCESS_PROMPT_TIMEOUT_MS = 10 * 60 * 1000
/** Classes rarely move; the helper also says whenever anything in Calendar changes. */
export const REFRESH_EVERY_MS = 15 * 60 * 1000

const HELPER_MISSING =
  'The calendar helper isn’t built. Run “npm run build:reminders”, then restart Focus Screen.'
const UNREADABLE = 'Couldn’t read your calendars.'

export interface CalendarService {
  get(): CalendarState
  subscribe(listener: (state: CalendarState) => void): () => void
  /** Asks macOS if it never was; otherwise opens System Settings at Calendars. */
  openPrivacySettings(): void
  /** Reads the calendars again now (e.g. after the Mac wakes up). */
  refresh(): void
  /** Dev builds: made-up classes instead of the real calendars. */
  readonly hasDemo: boolean
  isDemoEnabled(): boolean
  setDemoEnabled(on: boolean): void
  dispose(): void
}

export interface CalendarServiceOptions {
  settings: Pick<SettingsStore, 'get' | 'subscribe'>
  /** False off macOS: there are no calendars to read. */
  supported: boolean
  /** The helper in calendar mode; null when it isn't built (a dev build) or can't exist. */
  startHelper: StartHelper | null
  /** Dev builds only. */
  demo: boolean
  /** System Settings › Privacy & Security › Calendars. */
  openSystemSettings(): void
  /** Google Calendar, beside Apple's; null where it isn't offered. */
  google?: GoogleCalendar | null
  now?: () => Date
}

/** Days read: today and the week after it, so a class that meets once a week is in it too. */
export const WINDOW_DAYS = 8
const DAY_SEC = 24 * 3600

/**
 * Today and the week after it, local time: enough for "now", "next", and the first class of
 * the next day that has any (the end-of-day swipe). Never over 8 × 24 h, which the helper
 * refuses, even on a day a clock change makes 25 h long.
 */
export function eventWindow(now: Date): { from: number; to: number } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + WINDOW_DAYS)
  const from = start.getTime() / 1000
  return { from, to: Math.min(end.getTime() / 1000, from + WINDOW_DAYS * DAY_SEC) }
}

export function createCalendarService(options: CalendarServiceOptions): CalendarService {
  const { settings, supported, startHelper, openSystemSettings } = options
  const now = options.now ?? ((): Date => new Date())
  const listeners = new Set<(state: CalendarState) => void>()

  const google = options.google ?? null
  let client: RemindersClient | null = null
  let access: CalendarAccess | null = null
  let calendars: CalendarInfo[] = []
  let events: ClassEvent[] = []
  let problem: string | null = null
  let googleCalendars: CalendarInfo[] = []
  let googleEvents: ClassEvent[] = []
  let googleProblem: string | null = null
  let googleGeneration = 0
  let demo = false
  /** macOS is asked once per turn-on, so a prompt the user ignored doesn't keep coming back. */
  let asked = false
  /** Bumped on every stop, so a read still under way knows it's out of date. */
  let generation = 0
  let reading = false
  let readAgain = false
  let timer: ReturnType<typeof setInterval> | undefined

  const enabled = (): boolean => settings.get().widgets.nextClass
  const picked = (): string[] => settings.get().nextClass.calendars
  const googleStatus = (): GoogleCalendarStatus | undefined =>
    google ? { connection: google.state(), problem: googleProblem } : undefined

  function compute(): CalendarState {
    const status = googleStatus()
    if (demo) {
      return {
        supported: true,
        access: 'granted',
        calendars: demoCalendars(),
        events: demoEvents(now()),
        problem: null,
        demo: true,
        ...(status ? { google: status } : {})
      }
    }
    return {
      supported,
      access,
      calendars: [...calendars, ...googleCalendars],
      events: [...events, ...googleEvents].sort((a, b) => a.start - b.start),
      problem,
      demo: false,
      ...(status ? { google: status } : {})
    }
  }

  let state = compute()

  function emit(): void {
    const next = compute()
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    for (const listener of listeners) listener(state)
  }

  async function ask(current: RemindersClient): Promise<void> {
    asked = true
    try {
      await current.request({ op: 'requestAccess' }, ACCESS_PROMPT_TIMEOUT_MS)
    } catch {
      // The access line the helper prints next says how it went.
    }
  }

  function onAccess(current: RemindersClient, status: CalendarAccess): void {
    access = status
    if (status === 'granted') {
      void refresh()
      return
    }
    calendars = []
    events = []
    emit()
    if (status === 'notDetermined' && !asked) void ask(current)
  }

  function start(): void {
    if (client) return
    if (!startHelper) {
      problem = HELPER_MISSING
      emit()
      return
    }
    const run = ++generation
    asked = false
    const current: RemindersClient = createRemindersClient(startHelper, {
      access: (status) => {
        if (run === generation) onAccess(current, status)
      },
      changed: () => {
        if (run === generation) void refresh()
      }
    })
    client = current
    timer = setInterval(() => void refresh(), REFRESH_EVERY_MS)
    void refreshGoogle()
  }

  function stop(): void {
    generation++
    googleGeneration++
    client?.stop()
    client = null
    clearInterval(timer)
    access = null
    calendars = []
    events = []
    problem = null
    googleCalendars = []
    googleEvents = []
    googleProblem = null
    emit()
  }

  function apply(): void {
    if (supported && enabled()) start()
    else stop()
  }

  /** Google's calendars, and the picked ones' events, read apart from Apple's. */
  async function refreshGoogle(): Promise<void> {
    const run = ++googleGeneration
    if (!google || !enabled() || google.state() !== 'connected') {
      googleCalendars = []
      googleEvents = []
      googleProblem = null
      emit()
      return
    }
    try {
      const listed = await google.calendars()
      if (run !== googleGeneration) return
      const ids = picked()
        .filter((id) => listed.some((calendar) => calendar.id === id))
        .map((id) => id.slice(GOOGLE_ID_PREFIX.length))
      const read = ids.length > 0 ? await google.events(ids, eventWindow(now())) : []
      if (run !== googleGeneration) return
      googleCalendars = listed
      googleEvents = read
      googleProblem = null
    } catch (error) {
      if (run !== googleGeneration) return
      // Its calendars stay listed through a hiccup, so the picks don't vanish meanwhile.
      googleEvents = []
      googleProblem =
        error instanceof GoogleCalendarError ? error.message : 'Couldn’t read Google Calendar.'
      if (google.state() !== 'connected') googleCalendars = []
    }
    emit()
  }

  async function refresh(): Promise<void> {
    void refreshGoogle()
    const current = client
    if (!current || access !== 'granted') return
    if (reading) {
      readAgain = true
      return
    }
    reading = true
    const run = generation
    try {
      const listed = parseCalendarsReply(
        await current.request({ op: 'calendars' }, READ_TIMEOUT_MS)
      )
      if (run !== generation) return
      if (!listed) throw new Error('Unexpected reply.')
      if (!listed.ok) {
        access = listed.access ?? access
        calendars = []
        events = []
        return
      }
      calendars = listed.calendars
      // A picked calendar that's gone (a deleted account) simply doesn't count.
      const ids = picked().filter(
        (id) => !id.startsWith(GOOGLE_ID_PREFIX) && calendars.some((calendar) => calendar.id === id)
      )
      if (ids.length === 0) {
        events = []
      } else {
        const body = await current.request(
          { op: 'events', calendars: ids, ...eventWindow(now()) },
          READ_TIMEOUT_MS
        )
        if (run !== generation) return
        const read = parseEventsReply(body)
        if (!read) throw new Error('Unexpected reply.')
        events = read.ok ? read.events : []
      }
      problem = null
    } catch {
      if (run === generation) problem = UNREADABLE
    } finally {
      reading = false
      emit()
      if (readAgain) {
        readAgain = false
        void refresh()
      }
    }
  }

  let pickedKey = picked().join('\n')
  const unsubscribe = settings.subscribe(() => {
    apply()
    const key = picked().join('\n')
    if (key === pickedKey) return
    pickedKey = key
    void refresh()
  })
  // Signing in (or out, or being signed out) shows at once.
  const unsubscribeGoogle = google?.onChange(() => void refreshGoogle())
  apply()

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    openPrivacySettings() {
      if (client && access === 'notDetermined') void ask(client)
      else openSystemSettings()
    },
    refresh: () => void refresh(),
    hasDemo: options.demo,
    isDemoEnabled: () => demo,
    setDemoEnabled(on) {
      demo = options.demo && on
      emit()
    },
    dispose() {
      unsubscribe()
      unsubscribeGoogle?.()
      stop()
      listeners.clear()
    }
  }
}
