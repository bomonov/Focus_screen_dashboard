import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TodoCommand, TodoItem, TodoSourceId } from '../../main/ipc'
import { useConnectForm } from '../hooks/useConnectForm'
import { useHomeworkForm } from '../hooks/useHomeworkForm'
import { useNow } from '../hooks/useNow'
import { useTodos } from '../hooks/useTodos'
import { Card } from './Card'
import { ListIcon, PlusIcon } from './icons'
import { TabBar } from './TabBar'
import { springEasing } from './tabBarMotion'
import { CanvasForm } from './todo/CanvasForm'
import { ExamStrip } from './todo/ExamStrip'
import { HomeworkForm } from './todo/HomeworkForm'
import { SourceIcon } from './todo/SourceIcon'
import {
  heldOrder,
  metaText,
  todoView,
  type TodoAction,
  type TodoBody,
  type TodoFilter,
  type TodoView
} from './todo/todoView'
import './TodoList.css'

function send(command: TodoCommand): void {
  window.focusScreen.sendTodoCommand(command)
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/** How long a ticked row stays put, its icon bouncing, before it glides to its new place. */
const HOLD_MS = 700

/** The icon filling in: a pop past full size that settles back, like iOS's checkmarks. */
const BOUNCE: Keyframe[] = [
  { transform: 'scale(1)' },
  { transform: 'scale(1.32)', offset: 0.3 },
  { transform: 'scale(0.9)', offset: 0.6 },
  { transform: 'scale(1.04)', offset: 0.82 },
  { transform: 'scale(1)' }
]
const BOUNCE_TIMING: KeyframeAnimationOptions = { duration: 520, easing: 'ease-out' }
/** Un-ticked: a small dip back to the outline. */
const UNBOUNCE: Keyframe[] = [{ transform: 'scale(0.8)' }, { transform: 'scale(1)' }]
const UNBOUNCE_TIMING: KeyframeAnimationOptions = { duration: 260, easing: 'ease-out' }

/** Rows gliding to their new places once the hold ends: a soft spring, no wobble to speak of. */
const MOVE_TIMING: KeyframeAnimationOptions = {
  duration: 600,
  easing: springEasing({ response: 0.42, damping: 0.88 }, 0.6)
}

export function TodoList(): React.JSX.Element {
  const todos = useTodos()
  // Minute ticks keep "Today" and "Overdue" right across midnight and deadlines.
  const now = useNow()
  const [filter, setFilter] = useState<TodoFilter>('all')
  const [form, closeForm] = useConnectForm()
  const [homework, openHomework, closeHomework] = useHomeworkForm()
  const addButton = useRef<HTMLButtonElement>(null)
  /** Set as the homework form closes, so the keyboard lands back on the +. */
  const refocus = useRef(false)
  const view = todoView(todos, filter)
  const showingList = !form && !homework
  const title = form ? 'Connect Canvas' : 'To-do'

  useEffect(() => {
    if (homework || !refocus.current) return
    refocus.current = false
    addButton.current?.focus()
  }, [homework])

  function closeHomeworkForm(): void {
    refocus.current = true
    closeHomework()
  }

  return (
    <Card label="To-do list" className="todo-list">
      {/* The filters share the title's row, as the timer's modes do, so the list gets the room.
          The homework form brings its own title row, with its Add and Cancel. */}
      {!homework && (
        <div className="todo-list__header">
          <div className="todo-list__heading">
            <h2 className="card__title">{title}</h2>
            {showingList && view.leftCount !== null && (
              <span className="todo-list__left">{view.leftCount} left</span>
            )}
          </div>
          {showingList && (
            <div className="todo-list__tools">
              {view.chips.length > 0 && (
                <TabBar
                  className="todo-list__chips"
                  label="Show to-dos from"
                  options={view.chips.map((chip) => ({
                    value: chip.filter,
                    label: chip.label,
                    icon:
                      chip.filter === 'all' ? (
                        <ListIcon />
                      ) : (
                        <SourceIcon source={chip.filter} filled />
                      )
                  }))}
                  value={view.filter}
                  onPick={setFilter}
                />
              )}
              <button
                ref={addButton}
                type="button"
                className="todo-list__add"
                aria-label="Add homework or an exam"
                title="Add homework or an exam"
                onClick={() => openHomework({ kind: 'homework', entry: null })}
              >
                <PlusIcon />
              </button>
            </div>
          )}
        </div>
      )}
      {form ? (
        <CanvasForm initialAddress={form.address} onClose={closeForm} />
      ) : homework ? (
        <HomeworkForm
          // A new Edit… from the menu starts the form over; switching Homework / Exam doesn't.
          key={homework.entry?.id ?? 'new'}
          open={homework}
          classes={todos?.classes ?? []}
          now={now}
          onKind={(kind) => openHomework({ kind, entry: null })}
          onClose={closeHomeworkForm}
        />
      ) : (
        <>
          {/* The next exam, on every filter: the countdown the user wanted "the whole time". */}
          {todos && todos.exams.length > 0 && <ExamStrip exams={todos.exams} now={now} />}
          <TodoContent view={view} now={now} />
        </>
      )}
    </Card>
  )
}

function TodoContent({ view, now }: { view: TodoView; now: Date }): React.JSX.Element {
  return (
    <>
      {view.notes.map((note) => (
        <p key={note.text} className="todo-list__note" role="status">
          {note.text}
          {note.action && <ActionButton action={note.action} className="todo-list__note-action" />}
        </p>
      ))}
      <Body body={view.body} now={now} localCheckOffs={view.localCheckOffs} />
    </>
  )
}

function Body({
  body,
  now,
  localCheckOffs
}: {
  body: TodoBody
  now: Date
  localCheckOffs: readonly TodoSourceId[]
}): React.JSX.Element | null {
  switch (body.kind) {
    case 'loading':
      return null
    case 'list':
      return <TodoItems items={body.items} now={now} localCheckOffs={localCheckOffs} />
    case 'empty':
      return <p className="card__empty">{body.text}</p>
    case 'signedOut':
      return (
        <Message heading={body.heading} hint={body.hint}>
          {body.actions.length > 0 && (
            <div className="todo-list__actions">
              {body.actions.map((action) => (
                <ActionButton key={action.label} action={action} className="todo-list__action" />
              ))}
            </div>
          )}
        </Message>
      )
    case 'connecting':
      return (
        <Message heading={body.heading} hint={body.hint}>
          {body.cancel && (
            <ActionButton
              action={body.cancel}
              className="todo-list__action todo-list__action--quiet"
            />
          )}
        </Message>
      )
    case 'trouble':
      return (
        <Message heading={body.heading} hint={body.hint}>
          <ActionButton
            action={body.action}
            className={`todo-list__action${body.action.command.kind === 'refresh' ? ' todo-list__action--quiet' : ''}`}
          />
        </Message>
      )
  }
}

/** Where each row is (by id), from the top of the list's content. */
function rowTops(list: HTMLElement | null): Map<string, number> {
  const tops = new Map<string, number>()
  for (const row of list?.querySelectorAll<HTMLElement>('[data-id]') ?? []) {
    tops.set(row.dataset.id ?? '', row.offsetTop)
  }
  return tops
}

/**
 * The rows. A tick holds the order as it was for a moment, so the icon's bounce is seen where it
 * was clicked; then every row glides from where it was to where the new order puts it (the ticked
 * one down among the done, the rest closing up), measured before and after (FLIP).
 */
function TodoItems({
  items,
  now,
  localCheckOffs
}: {
  items: TodoItem[]
  now: Date
  localCheckOffs: readonly TodoSourceId[]
}): React.JSX.Element {
  const list = useRef<HTMLUListElement>(null)
  /** The order on screen when the tick came; null when nothing's held. */
  const [held, setHeld] = useState<string[] | null>(null)
  const release = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Where the rows were just before the hold ended, to glide them from. */
  const before = useRef<Map<string, number> | null>(null)
  /** The row last ticked, which fades a little as it travels past the others. */
  const ticked = useRef<string | null>(null)
  const shown = held ? heldOrder(items, held) : items

  useEffect(() => () => clearTimeout(release.current), [])

  function toggle(item: TodoItem): void {
    send({ kind: 'setDone', id: item.id, done: !item.done })
    ticked.current = item.id
    setHeld((current) => current ?? shown.map((row) => row.id))
    // Another tick while held starts the wait again, so a run of ticks moves once, together.
    clearTimeout(release.current)
    release.current = setTimeout(() => {
      before.current = rowTops(list.current)
      setHeld(null)
    }, HOLD_MS)
  }

  useLayoutEffect(() => {
    const from = before.current
    if (!from || held) return
    before.current = null
    if (reducedMotion.matches) return
    for (const [id, top] of rowTops(list.current)) {
      const was = from.get(id)
      if (was === undefined || Math.abs(was - top) < 0.5) continue
      const row = list.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
      const start = `translateY(${was - top}px)`
      row?.animate(
        id === ticked.current
          ? [{ transform: start }, { opacity: 0.35, offset: 0.4 }, { transform: 'none' }]
          : [{ transform: start }, { transform: 'none' }],
        MOVE_TIMING
      )
    }
  })

  return (
    <ul ref={list} className="todo-list__items">
      {shown.map((item) => (
        <TodoRow
          key={item.id}
          item={item}
          now={now}
          localCheckOff={localCheckOffs.includes(item.source)}
          onToggle={toggle}
        />
      ))}
    </ul>
  )
}

function ActionButton({
  action,
  className
}: {
  action: TodoAction
  className: string
}): React.JSX.Element {
  return (
    <button type="button" className={className} onClick={() => send(action.command)}>
      {action.label}
    </button>
  )
}

function Message({
  heading,
  hint,
  children
}: {
  heading: string
  hint: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="todo-list__message">
      <p className="todo-list__heading">{heading}</p>
      <p className="todo-list__hint">{hint}</p>
      {children}
    </div>
  )
}

function TodoRow({
  item,
  now,
  localCheckOff,
  onToggle
}: {
  item: TodoItem
  now: Date
  localCheckOff: boolean
  onToggle(item: TodoItem): void
}): React.JSX.Element {
  const meta = metaText(item, now, undefined, localCheckOff)
  const classes = ['todo-item']
  if (item.done) classes.push('todo-item--done')
  if (item.pending) classes.push('todo-item--pending')
  const check = useRef<HTMLButtonElement>(null)
  const wasDone = useRef(item.done)

  // Only a change bounces: rows that arrive already done (a launch, a refresh) just show filled.
  useLayoutEffect(() => {
    if (item.done === wasDone.current) return
    wasDone.current = item.done
    if (reducedMotion.matches) return
    check.current?.firstElementChild?.animate(
      item.done ? BOUNCE : UNBOUNCE,
      item.done ? BOUNCE_TIMING : UNBOUNCE_TIMING
    )
  }, [item.done])

  return (
    <li
      className={classes.join(' ')}
      data-id={item.id}
      // The right-click menu's Edit… and Delete find the user's own homework by this.
      data-homework-id={item.source === 'homework' ? item.id.slice('homework:'.length) : undefined}
    >
      <button
        ref={check}
        type="button"
        className="todo-item__check"
        aria-label={`${item.done ? 'Mark not done' : 'Mark done'}: ${item.title}`}
        // The source's icon is the box to tick: the tooltip says so.
        title={item.done ? 'Mark not done' : 'Mark done'}
        aria-pressed={item.done}
        onClick={() => onToggle(item)}
      >
        <SourceIcon source={item.source} filled={item.done} />
      </button>
      <div className="todo-item__text">
        <span className="todo-item__title">{item.title}</span>
        <span className={`todo-item__meta${meta.overdue ? ' todo-item__meta--overdue' : ''}`}>
          {meta.text}
        </span>
      </div>
    </li>
  )
}
