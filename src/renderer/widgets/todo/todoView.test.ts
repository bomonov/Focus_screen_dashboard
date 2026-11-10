import { describe, expect, it } from 'vitest'
import type { TodoDue, TodoItem, TodoSourceState, TodoState } from '../../../main/ipc'
import { dueText, heldOrder, metaText, todoView } from './todoView'

// Wednesday, October 14, 2026, 3:00 PM local time.
const NOW = new Date(2026, 9, 14, 15, 0)
const at = (days: number, hours: number, minutes = 0): number =>
  new Date(2026, 9, 14 + days, hours, minutes).getTime() / 1000
const day = (value: string): TodoDue => ({ kind: 'day', day: value })
const time = (seconds: number): TodoDue => ({ kind: 'time', at: seconds })

function item(id: string, changes: Partial<TodoItem> = {}): TodoItem {
  return {
    id,
    source: 'google',
    title: id,
    context: 'Google Tasks',
    course: null,
    due: null,
    done: false,
    completedAt: null,
    pending: false,
    ...changes
  }
}

function source(changes: Partial<TodoSourceState> = {}): TodoSourceState {
  return {
    id: 'google',
    name: 'Google Tasks',
    connection: 'connected',
    problem: null,
    syncedAt: 1,
    localCheckOffs: false,
    ...changes
  }
}

function state(changes: Partial<TodoState> = {}): TodoState {
  return {
    sources: [source()],
    items: [],
    exams: [],
    classes: [],
    supported: ['google'],
    demo: false,
    notice: null,
    ...changes
  }
}

describe('dueText', () => {
  const text = (due: TodoDue): string | undefined => dueText(due, NOW, 'en-US')?.text

  it('words plain days like the mockup', () => {
    expect(text(day('2026-10-14'))).toBe('Today')
    expect(text(day('2026-10-15'))).toBe('Tomorrow')
    expect(text(day('2026-10-16'))).toBe('Due Fri')
    expect(text(day('2026-10-30'))).toBe('Due Oct 30')
    expect(text(day('2027-01-04'))).toBe('Due Jan 4, 2027')
  })

  it('flags plain days in the past as overdue', () => {
    expect(dueText(day('2026-10-13'), NOW, 'en-US')).toEqual({
      text: 'Overdue · yesterday',
      overdue: true
    })
    expect(text(day('2026-10-10'))).toBe('Overdue · Sat')
    expect(text(day('2026-09-30'))).toBe('Overdue · Sep 30')
  })

  it('words deadlines with the time when they’re close', () => {
    expect(text(time(at(0, 23, 59)))).toBe('Due today 11:59 PM')
    expect(text(time(at(1, 9)))).toBe('Due tomorrow 9:00 AM')
    expect(text(time(at(2, 23, 59)))).toBe('Due Fri')
    expect(text(time(at(0, 9)))).toBe('Overdue · today 9:00 AM')
    expect(text(time(at(-1, 23, 59)))).toBe('Overdue · yesterday 11:59 PM')
  })

  it('ignores a day it can’t read', () => {
    expect(dueText(day('soon'), NOW)).toBeNull()
  })
})

describe('metaText', () => {
  it('joins the source and the due date', () => {
    expect(
      metaText(item('a', { context: 'Canvas · BIO 181', due: time(at(0, 23, 59)) }), NOW, 'en-US')
    ).toEqual({ text: 'Canvas · BIO 181 · Due today 11:59 PM', overdue: false })
    expect(metaText(item('b'), NOW).text).toBe('Google Tasks')
    expect(metaText(item('c', { done: true, due: day('2026-10-01') }), NOW).text).toBe(
      'Google Tasks · Done'
    )
  })

  it('says when a check-off stays on this computer', () => {
    const done = item('d', { source: 'canvas', context: 'Canvas · ENG 102', done: true })
    expect(metaText(done, NOW, 'en-US', true).text).toBe('Canvas · ENG 102 · Done on this computer')
  })
})

describe('todoView', () => {
  it('waits for the first answer', () => {
    expect(todoView(null, 'all').body).toEqual({ kind: 'loading' })
  })

  it('offers to connect when nothing is connected', () => {
    const view = todoView(state({ sources: [source({ connection: 'disconnected' })] }), 'all')
    expect(view.leftCount).toBeNull()
    expect(view.body).toEqual({
      kind: 'signedOut',
      heading: 'No to-do sources connected',
      hint: 'Your to-dos show up here once a source is connected.',
      actions: [{ label: 'Connect Google Tasks', command: { kind: 'connect', source: 'google' } }]
    })
  })

  it('still offers to connect while your own Homework is empty', () => {
    const homework = source({ id: 'homework', name: 'Homework' })
    const view = todoView(
      state({ sources: [source({ connection: 'disconnected' }), homework] }),
      'all'
    )
    expect(view.leftCount).toBeNull()
    expect(view.chips).toEqual([])
    expect(view.body).toEqual({
      kind: 'signedOut',
      heading: 'No to-do sources connected',
      hint: 'Connect one, or add your own homework with the + above.',
      actions: [{ label: 'Connect Google Tasks', command: { kind: 'connect', source: 'google' } }]
    })
  })

  it('shows your own homework with nothing else connected', () => {
    const homework = source({ id: 'homework', name: 'Homework' })
    const mine = item('homework:a', { source: 'homework', context: 'MAT 265' })
    const view = todoView(
      state({ sources: [source({ connection: 'disconnected' }), homework], items: [mine] }),
      'all'
    )
    expect(view.leftCount).toBe(1)
    expect(view.body).toEqual({ kind: 'list', items: [mine] })
  })

  it('counts an exam alone as something of your own', () => {
    const homework = source({ id: 'homework', name: 'Homework' })
    const exam = { id: 'x', title: 'Midterm', course: null, due: time(2000) }
    const view = todoView(
      state({ sources: [source({ connection: 'disconnected' }), homework], exams: [exam] }),
      'all'
    )
    expect(view.body).toEqual({ kind: 'empty', text: 'Nothing on your list' })
  })

  it('lists the sources whose check-offs stay on this computer', () => {
    const view = todoView(
      state({
        sources: [source({ id: 'canvas', name: 'Canvas', localCheckOffs: true }), source()]
      }),
      'all'
    )
    expect(view.localCheckOffs).toEqual(['canvas'])
  })

  it('offers every source the card can connect', () => {
    const view = todoView(
      state({
        sources: [
          source({ id: 'canvas', name: 'Canvas', connection: 'disconnected' }),
          source({ id: 'reminders', name: 'Apple Reminders', connection: 'disconnected' }),
          source({ connection: 'disconnected' })
        ]
      }),
      'all'
    )
    expect(view.body).toMatchObject({
      kind: 'signedOut',
      actions: [
        { label: 'Connect Canvas', command: { kind: 'connect', source: 'canvas' } },
        { label: 'Connect Apple Reminders', command: { kind: 'connect', source: 'reminders' } },
        { label: 'Connect Google Tasks', command: { kind: 'connect', source: 'google' } }
      ]
    })
  })

  it('asks to reconnect after the sign-in died', () => {
    const view = todoView(
      state({
        sources: [
          source({
            connection: 'disconnected',
            problem: { kind: 'reconnect', message: 'Expired.' }
          })
        ]
      }),
      'all'
    )
    expect(view.body).toMatchObject({
      kind: 'signedOut',
      heading: 'Sign in to Google Tasks again',
      hint: 'Expired.',
      actions: [{ label: 'Reconnect', command: { kind: 'connect', source: 'google' } }]
    })
  })

  it('shows the sign-in in progress', () => {
    const view = todoView(state({ sources: [source({ connection: 'connecting' })] }), 'all')
    expect(view.body).toEqual({
      kind: 'connecting',
      heading: 'Finish signing in to Google Tasks',
      hint: 'Focus Screen opened the sign-in page in your web browser.',
      cancel: { label: 'Cancel', command: { kind: 'cancelConnect', source: 'google' } }
    })
  })

  it('waits on the macOS prompt for Reminders, with nothing to cancel', () => {
    const reminders = source({
      id: 'reminders',
      name: 'Apple Reminders',
      connection: 'connecting'
    })
    expect(todoView(state({ sources: [reminders] }), 'all').body).toEqual({
      kind: 'connecting',
      heading: 'Allow access to your reminders',
      hint: 'Click Allow in the macOS message that just opened.',
      cancel: null
    })
    const withList = todoView(
      state({ sources: [source(), reminders], items: [item('google:1')] }),
      'all'
    )
    expect(withList.notes).toEqual([
      { text: 'Click Allow in the macOS message about your reminders.', action: null }
    ])
  })

  it('points denied access at System Settings', () => {
    const denied = source({
      id: 'reminders',
      name: 'Apple Reminders',
      syncedAt: null,
      problem: { kind: 'permission', message: 'Not allowed.' }
    })
    const settings = {
      label: 'Open System Settings',
      command: { kind: 'openPrivacySettings', source: 'reminders' }
    }
    expect(todoView(state({ sources: [denied] }), 'all').body).toEqual({
      kind: 'trouble',
      heading: 'Can’t show Apple Reminders',
      hint: 'Not allowed.',
      action: settings
    })
    const withList = todoView(
      state({ sources: [source(), denied], items: [item('google:1')] }),
      'all'
    )
    expect(withList.notes).toEqual([{ text: 'Not allowed.', action: settings }])
  })

  it('tells loading, trouble and an empty list apart', () => {
    const loading = todoView(state({ sources: [source({ syncedAt: null })] }), 'all')
    expect(loading.body).toEqual({ kind: 'loading' })
    expect(loading.leftCount).toBeNull()
    expect(
      todoView(
        state({
          sources: [
            source({ syncedAt: null, problem: { kind: 'setup', message: 'Turn on the API.' } })
          ]
        }),
        'all'
      ).body
    ).toEqual({
      kind: 'trouble',
      heading: 'Can’t show Google Tasks',
      hint: 'Turn on the API.',
      action: { label: 'Try Again', command: { kind: 'refresh' } }
    })
    expect(todoView(state(), 'all').body).toEqual({ kind: 'empty', text: 'Nothing on your list' })
  })

  it('counts what’s left across every source, whatever the filter', () => {
    const view = todoView(
      state({
        sources: [source({ id: 'canvas', name: 'Canvas' }), source()],
        items: [
          item('canvas:1', { source: 'canvas' }),
          item('google:1'),
          item('google:2', { done: true })
        ]
      }),
      'canvas'
    )
    expect(view.leftCount).toBe(2)
    expect(view.chips.map((chip) => chip.label)).toEqual(['All', 'Canvas', 'Google'])
    expect(view.body).toMatchObject({ kind: 'list', items: [{ id: 'canvas:1' }] })
  })

  it('hides the chips with one source and falls back to All', () => {
    const view = todoView(state({ items: [item('google:1')] }), 'canvas')
    expect(view.chips).toEqual([])
    expect(view.filter).toBe('all')
    expect(view.body).toMatchObject({ kind: 'list' })
  })

  it('notes passing problems and refused check-offs above the list', () => {
    const view = todoView(
      state({
        sources: [
          source({ problem: { kind: 'offline', message: 'Couldn’t reach Google Tasks.' } })
        ],
        items: [item('google:1')],
        notice: 'Couldn’t update “x”.'
      }),
      'all'
    )
    expect(view.notes).toEqual([
      { text: 'Couldn’t reach Google Tasks.', action: null },
      { text: 'Couldn’t update “x”.', action: null }
    ])
  })
})

describe('heldOrder', () => {
  const rows = (ids: string): { id: string }[] => ids.split('').map((id) => ({ id }))
  const ids = (list: { id: string }[]): string => list.map((row) => row.id).join('')

  it('keeps a ticked row where it was until the hold ends', () => {
    // b was ticked: the new order sends it to the end, the held one keeps it second.
    expect(ids(heldOrder(rows('acdb'), ['a', 'b', 'c', 'd']))).toBe('abcd')
  })

  it('adds rows that arrived meanwhile after the others, and drops rows that went', () => {
    expect(ids(heldOrder(rows('eacd'), ['a', 'b', 'c', 'd']))).toBe('acde')
  })
})
