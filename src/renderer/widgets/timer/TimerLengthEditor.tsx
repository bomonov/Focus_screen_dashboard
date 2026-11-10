import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PomodoroPhase, TimerLength, TimerSettings, TimerState } from '../../../main/ipc'
import {
  BREAK_PICKS,
  COUNTDOWN_PICKS,
  FOCUS_PICKS,
  pickLabel
} from '../../../main/services/timer/lengths'
import { CupIcon, TomatoIcon } from '../icons'
import { TabBar, type TabOption } from '../TabBar'
import { adoptOutside, type Lengths } from './editorLengths'
import { LengthWheels } from './LengthWheels'

const PHASES: readonly TabOption<PomodoroPhase>[] = [
  { value: 'focus', label: 'Focus', icon: <TomatoIcon /> },
  { value: 'break', label: 'Break', icon: <CupIcon /> }
]

const PICKS: Record<TimerLength, readonly number[]> = {
  focus: FOCUS_PICKS,
  break: BREAK_PICKS,
  countdown: COUNTDOWN_PICKS
}

const SETTING: Record<TimerLength, 'focusSec' | 'breakSec' | 'countdownSec'> = {
  focus: 'focusSec',
  break: 'breakSec',
  countdown: 'countdownSec'
}

/** Wheel changes are saved once the wheels settle, not on every step. */
const SAVE_AFTER_MS = 300

function send(command: Parameters<typeof window.focusScreen.sendTimerCommand>[0]): void {
  window.focusScreen.sendTimerCommand(command)
}

/**
 * The Timer card's length editor: hours, minutes and seconds wheels in the face's place, with the
 * old presets as quick picks under them. In Pomodoro a Focus / Break switch picks which length
 * the wheels set, and Start starts that phase (the user's call: the most control). Done, Esc and
 * a press outside the card keep the lengths and put the face back.
 */
export function TimerLengthEditor({
  timer,
  settings,
  phase,
  request,
  onClose
}: {
  timer: TimerState
  settings: TimerSettings
  /** Which length the switch is on, for this request to open it. */
  phase: PomodoroPhase
  /** Counts the requests (the face, a menu): a new one while it's open moves the switch. */
  request: number
  /** `refocus`: give the keyboard back to the card (Done, Esc, Start), not after a press elsewhere. */
  onClose: (refocus: boolean) => void
}): React.JSX.Element {
  const pomodoro = timer.mode === 'pomodoro'
  const incoming: Lengths = {
    focus: settings.focusSec,
    break: settings.breakSec,
    countdown: settings.countdownSec
  }
  const [switchPhase, setSwitchPhase] = useState<PomodoroPhase>(phase)
  const [seenRequest, setSeenRequest] = useState(request)
  const [lengths, setLengths] = useState<Lengths>(incoming)
  const [seen, setSeen] = useState<Lengths>(incoming)
  /** Lengths turned here and not saved yet. */
  const [pending, setPending] = useState<readonly TimerLength[]>([])
  const target: TimerLength = pomodoro ? switchPhase : 'countdown'
  const cardLength: TimerLength = pomodoro ? timer.phase : 'countdown'

  // "Set on the Timer Card…" for the other length while it's open.
  if (request !== seenRequest) {
    setSeenRequest(request)
    setSwitchPhase(phase)
  }
  // A length set in Customize or a menu while it's open shows on the wheels (set while
  // rendering, as React suggests for state that follows other state).
  if (
    incoming.focus !== seen.focus ||
    incoming.break !== seen.break ||
    incoming.countdown !== seen.countdown
  ) {
    setSeen(incoming)
    const adopted = adoptOutside(lengths, seen, incoming, pending)
    if (adopted !== lengths) setLengths(adopted)
  }

  // Read by the save timer and the close handlers, which outlive a render.
  const lengthsRef = useRef(lengths)
  const unsaved = useRef(new Set<TimerLength>())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useLayoutEffect(() => {
    lengthsRef.current = lengths
  }, [lengths])

  const save = useCallback((): void => {
    clearTimeout(saveTimer.current)
    const patch: Partial<TimerSettings> = {}
    for (const length of unsaved.current) {
      const sec = lengthsRef.current[length]
      // 0:00:00 isn't a length; the last real one stays.
      if (sec >= 1) patch[SETTING[length]] = sec
    }
    unsaved.current.clear()
    setPending([])
    if (Object.keys(patch).length > 0) window.focusScreen.updateSettings({ timer: patch })
  }, [])

  function setLength(length: TimerLength, sec: number, now = false): void {
    lengthsRef.current = { ...lengthsRef.current, [length]: sec }
    setLengths(lengthsRef.current)
    unsaved.current.add(length)
    setPending([...unsaved.current])
    clearTimeout(saveTimer.current)
    if (now) save()
    else saveTimer.current = setTimeout(save, SAVE_AFTER_MS)
  }

  /** Done, Esc and a press outside: keep the lengths; a finished or snoozed run starts fresh. */
  const done = useCallback(
    (refocus = true): void => {
      save()
      const sec = lengthsRef.current[cardLength]
      if (sec >= 1) send({ kind: 'useLength', phase: timer.phase, durationSec: sec, start: false })
      onClose(refocus)
    },
    [save, cardLength, timer.phase, onClose]
  )

  function start(): void {
    const sec = lengthsRef.current[target]
    if (sec < 1) return
    save()
    send({
      kind: 'useLength',
      phase: pomodoro ? switchPhase : 'focus',
      durationSec: sec,
      start: true
    })
    onClose(true)
  }

  // Esc and a press anywhere outside the Timer card close it, as Done does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') done()
    }
    const onPress = (event: PointerEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest('.timer')) done(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPress, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPress, true)
    }
  }, [done])

  // The keyboard goes to the wheels, not left on the face button now hidden under them; and the
  // trackpad's tick (a helper on the Mac) gets ready, so landing on 0 the first time ticks too.
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('.length-wheel')?.focus({ preventScroll: true })
    window.focusScreen.timerHaptic('warm')
  }, [])

  // Whatever is still waiting is saved if the editor goes away some other way.
  useEffect(() => () => save(), [save])

  const sec = lengths[target]
  const picks = PICKS[target]
  const startLabel = !pomodoro || switchPhase === timer.phase ? 'Start' : `Start ${switchPhase}`
  const name = target === 'countdown' ? 'Countdown' : target === 'focus' ? 'Focus' : 'Break'

  return (
    <div ref={root} className="timer-editor">
      <div className="timer-editor__top">
        <h2 className="card__title">Timer</h2>
        {pomodoro ? (
          <TabBar
            className="timer__phase-switch"
            label="Which length to set"
            options={PHASES}
            value={switchPhase}
            onPick={setSwitchPhase}
          />
        ) : (
          <span className="timer-editor__what">Countdown length</span>
        )}
      </div>
      <div className="timer-editor__room">
        <div className="timer-editor__wheels">
          <LengthWheels
            valueSec={sec}
            onChange={(next) => setLength(target, next)}
            size="card"
            label={name}
            onZero={(fast) => window.focusScreen.timerHaptic(fast ? 'firm' : 'tick')}
          />
        </div>
        <div className="timer__picks" role="group" aria-label={`${name} quick picks`}>
          {picks.map((pick) => (
            <button
              key={pick}
              type="button"
              className="timer__pick"
              aria-pressed={pick === sec}
              onClick={() => setLength(target, pick, true)}
            >
              {pickLabel(pick)}
            </button>
          ))}
        </div>
      </div>
      <div className="timer__controls">
        <button
          type="button"
          className="timer__button timer__button--primary"
          disabled={sec < 1}
          onClick={start}
        >
          {startLabel}
        </button>
        <button type="button" className="timer__button" onClick={() => done()}>
          Done
        </button>
      </div>
    </div>
  )
}
