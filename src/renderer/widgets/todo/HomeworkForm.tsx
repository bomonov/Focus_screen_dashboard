import { useId, useState } from 'react'
import type { HomeworkFormOpen, HomeworkKind, HomeworkResult } from '../../../main/ipc'
import { courseKey } from '../../../main/services/todos/homework/shared'
import { ExamIcon, PencilIcon } from '../icons'
import { TabBar } from '../TabBar'
import {
  DEFAULT_TIME,
  EXAM_NAMES,
  dueChoices,
  emptyForm,
  formProblem,
  formTitle,
  fromEntry,
  timeLabel,
  toInput,
  type FormValues
} from './homeworkFormView'

const KINDS = [
  { value: 'homework' as const, label: 'Homework', icon: <PencilIcon /> },
  { value: 'exam' as const, label: 'Exam', icon: <ExamIcon /> }
]

const SOMETHING_WRONG: HomeworkResult = { ok: false, message: 'Something went wrong. Try again.' }

const dayLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

function pickedDayLabel(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return dayLabel.format(new Date(year ?? 0, (month ?? 1) - 1, date ?? 1))
}

interface ChipProps {
  on: boolean
  onPick(): void
  children: React.ReactNode
}

function Chip({ on, onPick, children }: ChipProps): React.JSX.Element {
  return (
    <button type="button" className="homework-form__chip" aria-pressed={on} onClick={onPick}>
      {children}
    </button>
  )
}

interface HomeworkFormProps {
  open: HomeworkFormOpen
  /** The class chips (TodoState.classes). */
  classes: readonly string[]
  now: Date
  /** The Homework / Exam switch, while adding. */
  onKind(kind: HomeworkKind): void
  onClose(): void
}

/**
 * Adds one of the user's own homeworks or exams, or edits one: a name, the class (from the
 * class calendars), the due day and maybe a time. Main checks it again before saving.
 */
export function HomeworkForm({
  open,
  classes,
  now,
  onKind,
  onClose
}: HomeworkFormProps): React.JSX.Element {
  const id = useId()
  const editing = open.entry
  const [values, setValues] = useState<FormValues>(() =>
    editing ? fromEntry(editing) : emptyForm(open.kind)
  )
  const shown: FormValues = { ...values, kind: open.kind }
  const days = dueChoices(now)
  const [pickingDay, setPickingDay] = useState(
    () => shown.day !== null && !days.some((choice) => choice.day === shown.day)
  )
  const [pickingTime, setPickingTime] = useState(
    () => shown.time !== null && shown.time !== DEFAULT_TIME
  )
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)

  // A class the saved entry has but this week's calendar doesn't still gets its chip.
  const chips = [...classes]
  if (
    shown.course &&
    !chips.some((course) => courseKey(course) === courseKey(shown.course ?? ''))
  ) {
    chips.push(shown.course)
  }
  const set = (change: Partial<FormValues>): void => {
    setValues((current) => ({ ...current, ...change }))
    setAnswer(null)
  }
  const problem = tried ? formProblem(shown) : null
  const message = answer ?? problem

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
    setTried(true)
    const input = toInput(shown)
    if (!input) return
    setBusy(true)
    const result = await window.focusScreen
      .sendHomework(editing ? { kind: 'edit', id: editing.id, input } : { kind: 'add', input })
      .catch(() => SOMETHING_WRONG)
    setBusy(false)
    if (result.ok) onClose()
    else setAnswer(result.message)
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    onClose()
  }

  // The To-do card is short in the usual layout, so the form keeps to four rows: Add and Cancel
  // in the title row (always in reach), the switch beside the name, each label in its row.
  return (
    <form
      className="homework-form"
      onSubmit={(event) => void submit(event)}
      onKeyDown={onKeyDown}
      noValidate
    >
      <div className="todo-list__header homework-form__top">
        <h2 className="card__title">{formTitle(open.kind, editing !== null)}</h2>
        <div className="homework-form__actions">
          <button
            type="button"
            className="todo-list__action todo-list__action--quiet"
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="todo-list__action" disabled={busy}>
            {editing ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
      {message && (
        <p className="canvas-form__error homework-form__error" role="alert">
          {message}
        </p>
      )}
      <div className="homework-form__rows">
        <div className="homework-form__row">
          {!editing && (
            <TabBar
              className="homework-form__kind"
              label="What to add"
              options={KINDS}
              value={open.kind}
              onPick={onKind}
            />
          )}
          <input
            className="canvas-form__input homework-form__name"
            type="text"
            aria-label="Name"
            autoComplete="off"
            autoFocus
            maxLength={200}
            placeholder={open.kind === 'exam' ? 'Name: Midterm 1' : 'Name: Problem set 7'}
            value={shown.title}
            aria-invalid={problem === 'Give it a name.'}
            onChange={(event) => set({ title: event.target.value })}
          />
          {open.kind === 'exam' &&
            EXAM_NAMES.map((name) => (
              <Chip key={name} on={shown.title === name} onPick={() => set({ title: name })}>
                {name}
              </Chip>
            ))}
        </div>
        <div className="homework-form__row" role="group" aria-labelledby={`${id}-class`}>
          <span id={`${id}-class`} className="homework-form__label">
            Class
          </span>
          {chips.map((course) => (
            <Chip
              key={course}
              on={
                shown.course !== undefined &&
                shown.course !== null &&
                courseKey(shown.course) === courseKey(course)
              }
              onPick={() => set({ course })}
            >
              {course}
            </Chip>
          ))}
          <Chip on={shown.course === null} onPick={() => set({ course: null })}>
            No class
          </Chip>
        </div>
        <div className="homework-form__row" role="group" aria-labelledby={`${id}-due`}>
          <span id={`${id}-due`} className="homework-form__label">
            {open.kind === 'exam' ? 'Date' : 'Due'}
          </span>
          {days.map((choice) => (
            <Chip
              key={choice.day}
              on={!pickingDay && shown.day === choice.day}
              onPick={() => {
                setPickingDay(false)
                set({ day: choice.day })
              }}
            >
              {choice.label}
            </Chip>
          ))}
          <Chip on={pickingDay} onPick={() => setPickingDay(true)}>
            {pickingDay && shown.day ? pickedDayLabel(shown.day) : 'Pick a date…'}
          </Chip>
          {pickingDay && (
            <input
              className="canvas-form__input homework-form__picker"
              type="date"
              aria-label="Date"
              value={shown.day ?? ''}
              onChange={(event) => set({ day: event.target.value || null })}
            />
          )}
        </div>
        <div className="homework-form__row" role="group" aria-labelledby={`${id}-time`}>
          <span id={`${id}-time`} className="homework-form__label">
            Time
          </span>
          <Chip
            on={!pickingTime && shown.time === null}
            onPick={() => {
              setPickingTime(false)
              set({ time: null })
            }}
          >
            No time
          </Chip>
          <Chip
            on={!pickingTime && shown.time === DEFAULT_TIME}
            onPick={() => {
              setPickingTime(false)
              set({ time: DEFAULT_TIME })
            }}
          >
            {timeLabel(DEFAULT_TIME)}
          </Chip>
          <Chip on={pickingTime} onPick={() => setPickingTime(true)}>
            {pickingTime && shown.time ? timeLabel(shown.time) : 'Pick…'}
          </Chip>
          {pickingTime && (
            <input
              className="canvas-form__input homework-form__picker"
              type="time"
              aria-label="Time"
              value={shown.time ?? ''}
              onChange={(event) => set({ time: event.target.value || null })}
            />
          )}
        </div>
      </div>
    </form>
  )
}
