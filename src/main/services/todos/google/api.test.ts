import { describe, expect, it } from 'vitest'
import {
  apiError,
  doneBody,
  listContext,
  orderTasks,
  parseTask,
  parseTaskListsPage,
  parseTasksPage,
  startOfLocalDay,
  taskListsUrl,
  tasksUrl,
  taskUrl,
  toProviderTodo,
  type GoogleTask
} from './api'

function task(id: string, changes: Partial<GoogleTask> = {}): GoogleTask {
  return {
    id,
    title: id,
    done: false,
    due: null,
    completedAt: null,
    parent: null,
    position: id,
    ...changes
  }
}

describe('URLs', () => {
  it('pages through task lists', () => {
    expect(taskListsUrl(null)).toBe(
      'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100'
    )
    expect(taskListsUrl('p2')).toContain('pageToken=p2')
  })

  it('asks for open tasks', () => {
    const url = new URL(tasksUrl('list/1', { kind: 'open' }, null))
    expect(url.pathname).toBe('/tasks/v1/lists/list%2F1/tasks')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      maxResults: '100',
      showAssigned: 'true',
      showCompleted: 'false'
    })
  })

  it('asks for tasks done since a moment, hidden ones included', () => {
    const url = new URL(tasksUrl('L', { kind: 'doneSince', since: 1_800_000_000 }, 'next'))
    expect(Object.fromEntries(url.searchParams)).toEqual({
      maxResults: '100',
      showAssigned: 'true',
      showCompleted: 'true',
      showHidden: 'true',
      completedMin: '2027-01-15T08:00:00.000Z',
      pageToken: 'next'
    })
  })

  it('escapes ids in a task URL', () => {
    expect(taskUrl('L 1', 'T/2')).toBe(
      'https://tasks.googleapis.com/tasks/v1/lists/L%201/tasks/T%2F2'
    )
  })
})

describe('doneBody', () => {
  it('checks off, and clears the completion when unchecking', () => {
    expect(JSON.parse(doneBody(true))).toEqual({ status: 'completed' })
    expect(JSON.parse(doneBody(false))).toEqual({ status: 'needsAction', completed: null })
  })
})

describe('parsing', () => {
  it('reads task lists and skips broken entries', () => {
    expect(
      parseTaskListsPage({
        kind: 'tasks#taskLists',
        items: [{ id: 'L1', title: ' My Tasks ' }, { title: 'no id' }, 'junk', { id: 'L2' }],
        nextPageToken: 'p2'
      })
    ).toEqual({
      items: [
        { id: 'L1', title: 'My Tasks' },
        { id: 'L2', title: '' }
      ],
      nextPageToken: 'p2'
    })
    expect(parseTaskListsPage({})).toEqual({ items: [], nextPageToken: null })
    expect(parseTaskListsPage('nope')).toBeNull()
  })

  it('reads a task’s day, completion and parent', () => {
    expect(
      parseTask({
        id: 'T1',
        title: 'Lab report',
        status: 'completed',
        due: '2026-10-15T00:00:00.000Z',
        completed: '2026-10-14T18:30:00.000Z',
        parent: 'T0',
        position: '00000000000000000001'
      })
    ).toEqual({
      id: 'T1',
      title: 'Lab report',
      done: true,
      due: '2026-10-15',
      completedAt: Date.parse('2026-10-14T18:30:00.000Z') / 1000,
      parent: 'T0',
      position: '00000000000000000001'
    })
  })

  it('skips deleted and untitled tasks', () => {
    expect(parseTask({ id: 'T', title: 'x', deleted: true })).toBeNull()
    expect(parseTask({ id: 'T', title: '  ' })).toBeNull()
    expect(parseTask({ title: 'x' })).toBeNull()
    expect(
      parseTasksPage({ items: [{ id: 'A', title: 'a', status: 'needsAction' }, null] })?.items
    ).toHaveLength(1)
  })

  it('ignores a due date it can’t read', () => {
    expect(parseTask({ id: 'T', title: 'x', due: 'Friday' })?.due).toBeNull()
  })
})

describe('orderTasks', () => {
  it('keeps Google’s order with subtasks under their parent', () => {
    const ordered = orderTasks([
      task('b', { position: '2' }),
      task('b2', { parent: 'b', position: '2' }),
      task('a', { position: '1' }),
      task('b1', { parent: 'b', position: '1' }),
      task('orphan', { parent: 'gone', position: '0' })
    ])
    expect(ordered.map((t) => t.id)).toEqual(['orphan', 'a', 'b', 'b1', 'b2'])
  })

  it('drops a task listed twice', () => {
    expect(orderTasks([task('a'), task('a')]).map((t) => t.id)).toEqual(['a'])
  })
})

describe('listContext', () => {
  it('names the list only when there are several', () => {
    expect(listContext({ id: 'L', title: 'My Tasks' }, 1)).toBe('Google Tasks')
    expect(listContext({ id: 'L', title: 'Groceries' }, 3)).toBe('Google · Groceries')
    expect(listContext({ id: 'L', title: '' }, 3)).toBe('Google Tasks')
  })
})

describe('toProviderTodo', () => {
  it('turns a task into a plain-day to-do keyed by list and task', () => {
    expect(
      toProviderTodo({ id: 'L', title: 'My Tasks' }, task('T', { due: '2026-10-15' }), 1)
    ).toEqual({
      id: 'L/T',
      title: 'T',
      context: 'Google Tasks',
      due: { kind: 'day', day: '2026-10-15' },
      done: false,
      completedAt: null
    })
  })
})

describe('apiError', () => {
  const googleError = (reason: string, status = 'PERMISSION_DENIED'): unknown => ({
    error: {
      code: 403,
      message: 'x',
      status,
      errors: [{ reason, domain: 'usageLimits' }],
      details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }]
    }
  })

  it('spots a Tasks API that is turned off', () => {
    expect(apiError(403, googleError('accessNotConfigured'))).toMatchObject({ kind: 'setup' })
    expect(apiError(403, googleError('SERVICE_DISABLED'))).toMatchObject({ kind: 'setup' })
  })

  it('asks to reconnect when the sign-in or scope is gone', () => {
    expect(apiError(401, null)).toMatchObject({ kind: 'reconnect' })
    expect(apiError(403, googleError('ACCESS_TOKEN_SCOPE_INSUFFICIENT'))).toMatchObject({
      kind: 'reconnect'
    })
  })

  it('treats rate limits, outages and missing tasks as passing problems', () => {
    expect(apiError(429, null)).toMatchObject({ kind: 'offline' })
    expect(apiError(403, googleError('userRateLimitExceeded'))).toMatchObject({ kind: 'offline' })
    expect(apiError(503, null)).toMatchObject({ kind: 'offline' })
    expect(apiError(404, null)).toMatchObject({ kind: 'offline' })
    expect(apiError(400, null).message).toContain('400')
  })
})

describe('startOfLocalDay', () => {
  it('goes back to local midnight', () => {
    const noon = new Date(2026, 9, 14, 12, 30).getTime() / 1000
    expect(startOfLocalDay(noon)).toBe(new Date(2026, 9, 14).getTime() / 1000)
  })
})
