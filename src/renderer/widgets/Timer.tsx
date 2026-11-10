import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  PomodoroPhase,
  TimerCommand,
  TimerMode,
  TimerSettings,
  TimerState
} from '../../main/ipc'
import { spokenLength } from '../../main/services/timer/lengths'
import { useTimer } from '../hooks/useTimer'
import { useTimerNow } from '../hooks/useTimerNow'
import { Card } from './Card'
import { HourglassIcon, StopwatchIcon, TomatoIcon } from './icons'
import { TabBar, type TabOption } from './TabBar'
import { TimerBar } from './timer/TimerBar'
import { TimerFlip } from './timer/TimerFlip'
import { TimerLengthEditor } from './timer/TimerLengthEditor'
import { TimerRing } from './timer/TimerRing'
import { timerView } from './timer/timerView'
import './Timer.css'

const MODES: readonly TabOption<TimerMode>[] = [
  { value: 'pomodoro', label: 'Pomodoro', icon: <TomatoIcon /> },
  { value: 'countdown', label: 'Countdown', icon: <HourglassIcon /> },
  { value: 'stopwatch', label: 'Stopwatch', icon: <StopwatchIcon /> }
]

const FACES = { ring: TimerRing, bar: TimerBar, flip: TimerFlip }

function send(command: TimerCommand): void {
  window.focusScreen.sendTimerCommand(command)
}

interface TimerProps {
  /** null until the main process answers. */
  settings: TimerSettings | null
}

/** The length can be set before a run starts or once it's over, never while it's going. */
function canSetLength(timer: TimerState): boolean {
  return timer.mode !== 'stopwatch' && (timer.status === 'idle' || timer.status === 'finished')
}

export function Timer({ settings }: TimerProps): React.JSX.Element {
  const timer = useTimer()
  const style = settings?.style ?? 'ring'
  const status = timer?.status ?? 'idle'
  /** The length editor, while it's open: its switch, and which request opened it last. */
  const [editing, setEditing] = useState<{ phase: PomodoroPhase; request: number } | null>(null)
  const open = editing !== null && timer !== null && canSetLength(timer)
  const edit = useCallback(
    (phase: PomodoroPhase) => setEditing((was) => ({ phase, request: (was?.request ?? 0) + 1 })),
    []
  )
  /** Whether closing should hand the keyboard back to the card (not after a press elsewhere). */
  const refocus = useRef(false)
  const close = useCallback((back: boolean) => {
    refocus.current = back
    setEditing(null)
  }, [])
  // Back on the face (or Pause, once a run started) rather than lost to the page.
  useEffect(() => {
    if (open || !refocus.current) return
    refocus.current = false
    document
      .querySelector<HTMLElement>('.timer .timer__face-button, .timer .timer__button--primary')
      ?.focus({ preventScroll: true })
  }, [open])

  // A Timer menu's "Set on the Timer Card…" (main has already turned the card to that mode).
  // It waits in main until it's taken: as the card mounts (a window opened for it wasn't
  // listening yet), and whenever main says one is waiting.
  useEffect(() => {
    let live = true
    const takeRequest = (): void => {
      void window.focusScreen.takeTimerEdit().then((length) => {
        if (live && length) edit(length === 'break' ? 'break' : 'focus')
      })
    }
    takeRequest()
    const stop = window.focusScreen.onTimerEditLength(takeRequest)
    return () => {
      live = false
      stop()
    }
  }, [edit])

  // Started from a hotkey or switched to the stopwatch while open: the editor goes away, and
  // doesn't come back by itself when the run is over. (Set while rendering, as React suggests
  // for state that follows other state, rather than in an effect.)
  if (editing !== null && timer && !canSetLength(timer)) setEditing(null)

  return (
    <Card
      label="Timer"
      className={`timer timer--${style} timer--${status}${open ? ' timer--editing' : ''}`}
    >
      <div className="timer__header">
        <h2 className="card__title">Timer</h2>
        <TabBar
          className="timer__modes"
          label="Timer mode"
          options={MODES}
          value={timer?.mode ?? null}
          onPick={(mode) => send({ kind: 'selectMode', mode })}
        />
      </div>
      {timer && settings ? (
        <TimerBody
          timer={timer}
          settings={settings}
          onSetLength={canSetLength(timer) ? () => edit(timer.phase) : null}
        />
      ) : (
        <div className="timer__face" />
      )}
      {/* Over the card's own content, which stays (hidden) to keep the card's size: opening the
          wheels never moves the other cards. */}
      {timer && settings && open && (
        <TimerLengthEditor
          timer={timer}
          settings={settings}
          phase={editing.phase}
          request={editing.request}
          onClose={close}
        />
      )}
    </Card>
  )
}

function TimerBody({
  timer,
  settings,
  onSetLength
}: {
  timer: TimerState
  settings: TimerSettings
  /** Opens the length editor; null while the length can't be set. */
  onSetLength: (() => void) | null
}): React.JSX.Element {
  const now = useTimerNow(timer)
  const view = timerView(timer, settings.direction, now)
  const Face = FACES[settings.style]
  const which = timer.mode === 'countdown' ? 'countdown' : timer.phase
  const length =
    which === 'countdown'
      ? settings.countdownSec
      : which === 'focus'
        ? settings.focusSec
        : settings.breakSec

  return (
    <>
      <div className="timer__face">
        {onSetLength ? (
          // The whole face is the button: big enough to hit from across the desk.
          <button
            type="button"
            className="timer__face-button"
            aria-label={`Set ${which} length, ${spokenLength(length)}`}
            title="Set the length"
            onClick={onSetLength}
          >
            <Face view={view} />
          </button>
        ) : (
          <Face view={view} />
        )}
      </div>
      <div className="timer__controls">
        <button
          type="button"
          className="timer__button timer__button--primary"
          onClick={() => send(view.primary.command)}
        >
          {view.primary.label}
        </button>
        <button type="button" className="timer__button" onClick={() => send({ kind: 'reset' })}>
          Reset
        </button>
        {view.canAddTime && (
          <button
            type="button"
            className="timer__button"
            onClick={() => send({ kind: 'addFiveMinutes' })}
          >
            +5 min
          </button>
        )}
      </div>
    </>
  )
}
