import type {
  CalendarInfo,
  CalendarState,
  GoogleCalendarStatus,
  SettingsPatch,
  Settings
} from '../../../main/ipc'
import { Section, ToggleRow } from './controls'
import { calendarLabels } from './customizeView'
import { SchoolRows } from './SchoolRows'

/** Next class (macOS): the switch, macOS access, and which calendars hold classes. */
export function NextClassSection({
  settings,
  calendar,
  update
}: {
  settings: Settings
  calendar: CalendarState | null
  update: (patch: SettingsPatch) => void
}): React.JSX.Element | null {
  if (!calendar?.supported) return null
  const on = settings.widgets.nextClass
  return (
    <Section title="Next class">
      <div className="customize__rows">
        <ToggleRow
          label="Show next class"
          hint="In the top bar, from Apple Calendar or Google Calendar"
          on={on}
          onToggle={(nextClass) => update({ widgets: { nextClass } })}
        />
        {on && <CalendarAccessRows calendar={calendar} />}
        {on && <GoogleCalendarRow status={calendar.google} />}
        {on && (calendar.access === 'granted' || calendar.google?.connection === 'connected') && (
          <CalendarPicker
            calendars={calendar.calendars}
            picked={settings.nextClass.calendars}
            pick={(calendars) => update({ nextClass: { calendars } })}
          />
        )}
        {on && <SchoolRows update={update} />}
      </div>
    </Section>
  )
}

/** Apple Calendar's side: macOS access, until it's given. */
function CalendarAccessRows({ calendar }: { calendar: CalendarState }): React.JSX.Element | null {
  const openSettings = (): void =>
    window.focusScreen.sendCalendarCommand({ kind: 'openPrivacySettings' })
  if (calendar.problem) return <p className="customize__note">{calendar.problem}</p>
  switch (calendar.access) {
    case null:
      return <p className="customize__note">Starting…</p>
    case 'notDetermined':
      return (
        <div className="customize__row">
          <span className="customize__toggle-text">
            <span>Allow calendar access</span>
            <span className="customize__hint">macOS asks for “Focus Screen Reminders”</span>
          </span>
          <button type="button" className="customize__button" onClick={openSettings}>
            Allow…
          </button>
        </div>
      )
    case 'denied':
      return (
        <div className="customize__row">
          <span className="customize__toggle-text">
            <span>Let Focus Screen see your calendars</span>
            <span className="customize__hint">
              Privacy &amp; Security › Calendars › Focus Screen Reminders
            </span>
          </span>
          <button type="button" className="customize__button" onClick={openSettings}>
            Open System Settings
          </button>
        </div>
      )
    case 'restricted':
      return (
        <p className="customize__note">
          Calendar access is blocked on this Mac (by Screen Time or a device profile).
        </p>
      )
    case 'granted':
      return null
  }
}

/** Google Calendar's side: signed in on its own, read-only, its calendars in the same picker. */
function GoogleCalendarRow({
  status
}: {
  status: GoogleCalendarStatus | undefined
}): React.JSX.Element | null {
  if (!status) return null
  const connected = status.connection === 'connected'
  const connecting = status.connection === 'connecting'
  const hint =
    status.problem ??
    (connected
      ? 'Signed in · read-only'
      : connecting
        ? 'Finish signing in in your browser…'
        : 'Sign in to pick Google calendars too')
  return (
    <div className="customize__row">
      <span className="customize__toggle-text">
        <span>Google Calendar</span>
        <span className="customize__hint">{hint}</span>
      </span>
      <button
        type="button"
        className="customize__button"
        disabled={connecting}
        onClick={() =>
          window.focusScreen.sendCalendarCommand({
            kind: connected ? 'disconnectGoogle' : 'connectGoogle'
          })
        }
      >
        {connected ? 'Disconnect…' : 'Sign in…'}
      </button>
    </div>
  )
}

/** Pick any number of calendars; only those are ever read. */
function CalendarPicker({
  calendars,
  picked,
  pick
}: {
  calendars: CalendarInfo[]
  picked: string[]
  pick: (calendars: string[]) => void
}): React.JSX.Element {
  if (calendars.length === 0) return <p className="customize__note">No calendars yet.</p>
  const labels = calendarLabels(calendars)
  return (
    <div className="customize__group">
      <span className="customize__group-label">Class calendars · only these are read</span>
      <div className="customize__pills" role="group" aria-label="Class calendars">
        {calendars.map((calendar) => {
          const chosen = picked.includes(calendar.id)
          return (
            <button
              key={calendar.id}
              type="button"
              className="customize__pill customize__calendar"
              aria-pressed={chosen}
              onClick={() =>
                pick(chosen ? picked.filter((id) => id !== calendar.id) : [...picked, calendar.id])
              }
            >
              <span
                className="customize__calendar-dot"
                style={calendar.color ? { background: calendar.color } : undefined}
                aria-hidden="true"
              />
              {labels.get(calendar.id)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
