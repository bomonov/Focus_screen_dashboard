import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TodoSourceError, type ProviderTodo, type TodoProvider } from './provider'
import { createTodoService, REFRESH_INTERVAL_SEC, type TodoService } from './service'
import type { TodoConnection, TodoSourceId } from './types'

const T0 = 1_800_000_000

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface FakeProvider extends TodoProvider {
  lists: Deferred<ProviderTodo[]>[]
  writes: { id: string; done: boolean; reply: Deferred<void> }[]
  setConnection(connection: TodoConnection): void
  /** The source announces a change of its own. */
  itemsChanged(): void
}

function fakeProvider(
  source: TodoSourceId,
  connection: TodoConnection = 'connected'
): FakeProvider {
  let onChange = (): void => {}
  let onItemsChanged = (): void => {}
  let current = connection
  const provider: FakeProvider = {
    source,
    name: `${source} name`,
    lists: [],
    writes: [],
    setConnection(next) {
      current = next
      onChange()
    },
    itemsChanged: () => onItemsChanged(),
    start(listener, itemsListener) {
      onChange = listener
      if (itemsListener) onItemsChanged = itemsListener
    },
    connection: () => current,
    list() {
      const next = deferred<ProviderTodo[]>()
      provider.lists.push(next)
      return next.promise
    },
    setDone(id, done) {
      const reply = deferred<void>()
      provider.writes.push({ id, done, reply })
      return reply.promise
    },
    dispose: () => {}
  }
  return provider
}

function todo(id: string, changes: Partial<ProviderTodo> = {}): ProviderTodo {
  return { id, title: id, context: 'ctx', due: null, done: false, completedAt: null, ...changes }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

let clock = T0
let service: TodoService | null = null

function start(providers: TodoProvider[], demo: TodoProvider[] | null = null): TodoService {
  service = createTodoService({ providers, demo, now: () => clock })
  return service
}

const ids = (s: TodoService): string[] => s.get().items.map((item) => item.id)

beforeEach(() => {
  vi.useFakeTimers()
  clock = T0
})

afterEach(() => {
  service?.dispose()
  service = null
  vi.useRealTimers()
})

describe('todo service', () => {
  it('lists every connected source on start and merges them', async () => {
    const google = fakeProvider('google')
    const canvas = fakeProvider('canvas')
    const s = start([canvas, google])
    google.lists[0]?.resolve([todo('g1'), todo('g2', { done: true, completedAt: T0 - 5 })])
    canvas.lists[0]?.resolve([todo('c1')])
    await flush()
    expect(ids(s)).toEqual(['canvas:c1', 'google:g1', 'google:g2'])
    expect(s.get().sources.map((source) => [source.id, source.syncedAt])).toEqual([
      ['canvas', T0],
      ['google', T0]
    ])
  })

  it('lists a source once it connects and forgets its items when it disconnects', async () => {
    const google = fakeProvider('google', 'disconnected')
    const s = start([google])
    expect(google.lists).toHaveLength(0)
    google.setConnection('connecting')
    expect(s.get().sources[0]?.connection).toBe('connecting')
    google.setConnection('connected')
    google.lists[0]?.resolve([todo('g1')])
    await flush()
    expect(ids(s)).toEqual(['google:g1'])
    google.setConnection('disconnected')
    expect(ids(s)).toEqual([])
    expect(s.get().sources[0]).toMatchObject({ connection: 'disconnected', syncedAt: null })
  })

  it('shows a check-off at once and keeps it until a newer list confirms it', async () => {
    const google = fakeProvider('google')
    const s = start([google])
    google.lists[0]?.resolve([todo('g1'), todo('g2')])
    await flush()

    s.setDone('google:g1', true)
    expect(s.get().items.find((item) => item.id === 'google:g1')).toMatchObject({
      done: true,
      pending: true,
      completedAt: T0
    })
    // A refresh that started before Google confirmed may still say "not done".
    s.refresh()
    await flush()
    expect(google.writes).toEqual([expect.objectContaining({ id: 'g1', done: true })])
    google.writes[0]?.reply.resolve()
    await flush()
    google.lists[1]?.resolve([todo('g1'), todo('g2')])
    await flush()
    expect(s.get().items.find((item) => item.id === 'google:g1')).toMatchObject({
      done: true,
      pending: false
    })

    s.refresh()
    google.lists[2]?.resolve([todo('g1', { done: true, completedAt: T0 + 1 }), todo('g2')])
    await flush()
    expect(s.get().items.find((item) => item.id === 'google:g1')).toMatchObject({
      done: true,
      pending: false,
      completedAt: T0 + 1
    })
    expect(ids(s)).toEqual(['google:g2', 'google:g1'])
  })

  it('takes a refused check-off back and says so for a few seconds', async () => {
    const google = fakeProvider('google')
    const s = start([google])
    google.lists[0]?.resolve([todo('g1', { title: 'Renew parking permit' })])
    await flush()

    s.setDone('google:g1', true)
    await flush()
    google.writes[0]?.reply.reject(new TodoSourceError('offline', 'Couldn’t reach Google Tasks.'))
    await flush()
    expect(s.get().items[0]).toMatchObject({ done: false, pending: false })
    expect(s.get().notice).toBe(
      'Couldn’t update “Renew parking permit”. Couldn’t reach Google Tasks.'
    )
    // It re-reads the source to show whatever is true now.
    expect(google.lists).toHaveLength(2)
    vi.advanceTimersByTime(8000)
    expect(s.get().notice).toBeNull()
  })

  it('sends writes to one item in order', async () => {
    const google = fakeProvider('google')
    const s = start([google])
    google.lists[0]?.resolve([todo('g1')])
    await flush()

    s.setDone('google:g1', true)
    s.setDone('google:g1', false)
    await flush()
    expect(google.writes.map((write) => write.done)).toEqual([true])
    google.writes[0]?.reply.resolve()
    await flush()
    expect(google.writes.map((write) => write.done)).toEqual([true, false])
    expect(s.get().items[0]).toMatchObject({ done: false, pending: true })
  })

  it('ignores check-offs for unknown items and ones already in that state', async () => {
    const google = fakeProvider('google')
    const s = start([google])
    google.lists[0]?.resolve([todo('g1')])
    await flush()
    s.setDone('google:nope', true)
    s.setDone('canvas:g1', true)
    s.setDone('google:g1', false)
    await flush()
    expect(google.writes).toHaveLength(0)
  })

  it('keeps the last list when the source can’t be reached', async () => {
    const google = fakeProvider('google')
    const s = start([google])
    google.lists[0]?.resolve([todo('g1')])
    await flush()
    s.refresh()
    google.lists[1]?.reject(new Error('net::ERR_INTERNET_DISCONNECTED'))
    await flush()
    expect(ids(s)).toEqual(['google:g1'])
    expect(s.get().sources[0]?.problem).toEqual({
      kind: 'offline',
      message: 'Couldn’t reach google name.'
    })
  })

  it('shows a sign-in that expired', async () => {
    const google = fakeProvider('google')
    const s = start([google])
    google.lists[0]?.resolve([todo('g1')])
    await flush()
    s.refresh()
    // The provider signs itself out, then the request fails.
    google.setConnection('disconnected')
    google.lists[1]?.reject(new TodoSourceError('reconnect', 'Sign in again.'))
    await flush()
    expect(ids(s)).toEqual([])
    expect(s.get().sources[0]).toMatchObject({
      connection: 'disconnected',
      problem: { kind: 'reconnect', message: 'Sign in again.' }
    })
    google.setConnection('connecting')
    expect(s.get().sources[0]?.problem).toBeNull()
  })

  it('refreshes every five minutes and on demand when the list is old', async () => {
    const google = fakeProvider('google')
    const s = start([google])
    google.lists[0]?.resolve([])
    await flush()
    vi.advanceTimersByTime(REFRESH_INTERVAL_SEC * 1000)
    expect(google.lists).toHaveLength(2)
    google.lists[1]?.resolve([])
    await flush()

    clock = T0 + 10
    s.refreshIfOlderThan(30)
    expect(google.lists).toHaveLength(2)
    clock = T0 + 40
    s.refreshIfOlderThan(30)
    expect(google.lists).toHaveLength(3)
  })

  it('reads a source again when it announces a change, while it’s connected', async () => {
    const reminders = fakeProvider('reminders')
    const s = start([reminders])
    reminders.lists[0]?.resolve([todo('r1')])
    await flush()
    reminders.itemsChanged()
    expect(reminders.lists).toHaveLength(2)
    reminders.lists[1]?.resolve([todo('r1'), todo('r2')])
    await flush()
    expect(ids(s)).toEqual(['reminders:r1', 'reminders:r2'])

    reminders.setConnection('disconnected')
    reminders.itemsChanged()
    expect(reminders.lists).toHaveLength(2)
  })

  it('runs one more refresh when asked during a refresh', async () => {
    const google = fakeProvider('google')
    const s = start([google])
    s.refresh()
    s.refresh()
    expect(google.lists).toHaveLength(1)
    google.lists[0]?.resolve([])
    await flush()
    expect(google.lists).toHaveLength(2)
  })

  it('shows the demo only while no real source is connected', async () => {
    const google = fakeProvider('google', 'disconnected')
    const demoCanvas = fakeProvider('canvas')
    const s = start([google], [demoCanvas])
    demoCanvas.lists[0]?.resolve([todo('demo1')])
    await flush()
    expect(s.get()).toMatchObject({ demo: true, items: [{ id: 'canvas:demo1' }] })
    expect(s.get().sources.map((source) => source.id)).toEqual(['canvas'])

    google.setConnection('connected')
    expect(s.get()).toMatchObject({ demo: false, items: [] })
    expect(s.get().sources.map((source) => source.id)).toEqual(['google'])

    google.setConnection('disconnected')
    expect(s.get().demo).toBe(true)
    s.setDemoEnabled(false)
    expect(s.get()).toMatchObject({ demo: false, items: [] })
  })

  it('gathers the exams, soonest first, and the class chips, once each', async () => {
    const homework: FakeProvider = {
      ...fakeProvider('homework'),
      exams: () => [
        { id: 'late', title: 'Final', course: null, due: { kind: 'time', at: T0 + 900 } },
        { id: 'soon', title: 'Quiz', course: 'CHM 113', due: { kind: 'time', at: T0 + 100 } }
      ],
      classes: () => ['BIO 181', 'CHM 113']
    }
    const other: FakeProvider = {
      ...fakeProvider('canvas'),
      classes: () => ['bio  181', 'MAT 265']
    }
    const s = start([other, homework])
    await flush()
    expect(s.get().exams.map((exam) => exam.id)).toEqual(['soon', 'late'])
    expect(s.get().classes).toEqual(['bio  181', 'MAT 265', 'CHM 113'])
  })

  it('keeps the demo while the only connected source is an empty Homework', async () => {
    let content = false
    const google = fakeProvider('google', 'disconnected')
    const homework: FakeProvider = { ...fakeProvider('homework'), hasContent: () => content }
    const demoCanvas = fakeProvider('canvas')
    const s = start([google, homework], [demoCanvas])
    demoCanvas.lists[0]?.resolve([todo('demo1')])
    await flush()
    expect(s.get().demo).toBe(true)

    content = true
    homework.itemsChanged()
    homework.lists[0]?.resolve([todo('mine')])
    await flush()
    expect(s.get()).toMatchObject({ demo: false, items: [{ id: 'homework:mine' }] })
  })
})
