// The trip search in its own process (client.ts), with a fake process: when it's started and
// stopped, and that whatever it sends back is checked before it's believed.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedTrip } from '../transit/gtfsRealtime'
import { createTripPlanner, type PlannerProcess } from './client'
import type { PlanReply, PlanRequest } from './messages'
import type { PlanQuery, TripPlan, TripRide } from './types'

const QUERY: PlanQuery = {
  from: [33.4206, -111.9312],
  to: [33.4146, -111.8901],
  time: 1_793_628_000,
  mode: 'depart'
}
const FEED: FeedTrip[] = [
  { tripId: 't1', routeId: 'VENU', directionId: 0, canceled: false, vehicleId: '', stops: [] }
]

const RIDE: TripRide = {
  kind: 'ride',
  routeName: 'Orbit Venus',
  short: 'VENU',
  color: '591769',
  textColor: 'FFFFFF',
  rail: false,
  headsign: 'Tempe TC',
  tripId: '1234567',
  fromName: 'Rural Rd & Terrace Rd',
  fromStopId: '10241',
  toName: 'Apache Blvd & McClintock Dr',
  toStopId: '10892',
  depart: 1_793_628_240,
  arrive: 1_793_629_200,
  stops: 9,
  live: true,
  delayMin: 1
}

const PLAN: TripPlan = {
  leave: 1_793_628_000,
  arrive: 1_793_629_380,
  steps: [
    { kind: 'walk', start: 1_793_628_000, end: 1_793_628_240, minutes: 4, toName: RIDE.fromName },
    RIDE,
    { kind: 'walk', start: 1_793_629_200, end: 1_793_629_380, minutes: 3, toName: null }
  ],
  rides: 1,
  walkM: 420
}

const planned = (id: number, plans: unknown[] = [PLAN], noTrip: unknown = null): unknown => ({
  kind: 'planned',
  id,
  plans,
  noTrip
})

interface FakeProcess {
  process: PlannerProcess & { killed: boolean }
  sent: PlanRequest[]
  reply(message: unknown): void
  exit(): void
}

function fakeProcess(): FakeProcess {
  const sent: PlanRequest[] = []
  let onMessage: (message: unknown) => void = () => {}
  let onExit: () => void = () => {}
  const process: PlannerProcess & { killed: boolean } = {
    killed: false,
    postMessage: (message) => sent.push(message),
    onMessage: (listener) => {
      onMessage = listener
    },
    onExit: (listener) => {
      onExit = listener
    },
    kill() {
      process.killed = true
      onExit()
    }
  }
  return {
    process,
    sent,
    reply: (message: unknown) => onMessage(message),
    exit: () => onExit()
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the trip search in its own process', () => {
  it('starts the process on the first plan and sends it the question, the feed and the time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_793_627_940_500)
    const fake = fakeProcess()
    const start = vi.fn(() => fake.process)
    const planner = createTripPlanner({ start })
    expect(start).not.toHaveBeenCalled()
    const plan = planner.plan(QUERY, FEED)
    expect(start).toHaveBeenCalledTimes(1)
    expect(fake.sent).toEqual([
      { kind: 'plan', id: 1, query: QUERY, feed: FEED, now: 1_793_627_940 }
    ])
    fake.reply(planned(1))
    await expect(plan).resolves.toEqual({ kind: 'planned', id: 1, plans: [PLAN], noTrip: null })
    planner.dispose()
  })

  it('sends the caller’s clock when it gives one', async () => {
    const fake = fakeProcess()
    const planner = createTripPlanner({ start: () => fake.process })
    const plan = planner.plan(QUERY, FEED, 1_793_600_000)
    expect(fake.sent[0]?.now).toBe(1_793_600_000)
    fake.reply(planned(1))
    await plan
    planner.dispose()
  })

  it('gives what no trip says when nothing gets there', async () => {
    const fake = fakeProcess()
    const planner = createTripPlanner({ start: () => fake.process })
    const plan = planner.plan(QUERY, [])
    fake.reply(planned(1, [], { walkSec: null, serviceStarts: 1_793_621_520 }))
    await expect(plan).resolves.toEqual({
      kind: 'planned',
      id: 1,
      plans: [],
      noTrip: { walkSec: null, serviceStarts: 1_793_621_520 }
    })
    planner.dispose()
  })

  it('keeps one process for plans close together, and stops it after two idle minutes', async () => {
    vi.useFakeTimers()
    const fake = fakeProcess()
    const start = vi.fn(() => fake.process)
    const planner = createTripPlanner({ start })
    const first = planner.plan(QUERY, FEED)
    fake.reply(planned(1))
    await first
    vi.advanceTimersByTime(60_000)
    const second = planner.plan(QUERY, FEED)
    fake.reply(planned(2))
    await second
    expect(start).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(119_000)
    expect(fake.process.killed).toBe(false)
    vi.advanceTimersByTime(1_000)
    expect(fake.process.killed).toBe(true)
    planner.dispose()
  })

  it('doesn’t stop a process that is still planning', async () => {
    vi.useFakeTimers()
    const fake = fakeProcess()
    const planner = createTripPlanner({
      start: () => fake.process,
      idleMs: 1_000,
      timeoutMs: 5_000
    })
    const slow = planner.plan(QUERY, FEED)
    vi.advanceTimersByTime(4_000)
    expect(fake.process.killed).toBe(false)
    fake.reply(planned(1))
    await expect(slow).resolves.not.toBeNull()
    planner.dispose()
  })

  it('gives no plan when the process stops, and starts a new one next time', async () => {
    const first = fakeProcess()
    const second = fakeProcess()
    const start = vi.fn().mockReturnValueOnce(first.process).mockReturnValueOnce(second.process)
    const planner = createTripPlanner({ start })
    const lost = planner.plan(QUERY, FEED)
    first.exit()
    await expect(lost).resolves.toBeNull()
    const again = planner.plan(QUERY, FEED)
    expect(start).toHaveBeenCalledTimes(2)
    second.reply(planned(2))
    await expect(again).resolves.not.toBeNull()
    planner.dispose()
  })

  it('ignores what a stopped process still sends', async () => {
    const first = fakeProcess()
    const second = fakeProcess()
    const start = vi.fn().mockReturnValueOnce(first.process).mockReturnValueOnce(second.process)
    const planner = createTripPlanner({ start })
    void planner.plan(QUERY, FEED)
    first.exit()
    const again = planner.plan(QUERY, FEED)
    first.reply(planned(2, []))
    second.reply(planned(2))
    await expect(again).resolves.toMatchObject({ plans: [PLAN] })
    planner.dispose()
  })

  it('gives up on an answer that takes more than 10 s, and stops the process', async () => {
    vi.useFakeTimers()
    const fake = fakeProcess()
    const planner = createTripPlanner({ start: () => fake.process })
    const slow = planner.plan(QUERY, FEED)
    vi.advanceTimersByTime(9_999)
    expect(fake.process.killed).toBe(false)
    vi.advanceTimersByTime(1)
    await expect(slow).resolves.toBeNull()
    expect(fake.process.killed).toBe(true)
    planner.dispose()
  })

  it('drops a reply to an old id, and waits for its own', async () => {
    const fake = fakeProcess()
    const planner = createTripPlanner({ start: () => fake.process })
    const first = planner.plan(QUERY, FEED)
    fake.reply(planned(1))
    await first
    const second = planner.plan(QUERY, FEED)
    let settled = false
    void second.then(() => (settled = true))
    // The first answered again, and one nobody asked.
    fake.reply(planned(1, []))
    fake.reply(planned(99, []))
    await Promise.resolve()
    expect(settled).toBe(false)
    fake.reply(planned(2))
    await expect(second).resolves.toMatchObject({ id: 2, plans: [PLAN] })
    planner.dispose()
  })

  it('gives no plan for a failed reply or a malformed one that names its request', async () => {
    const fake = fakeProcess()
    const planner = createTripPlanner({ start: () => fake.process })
    /** The answer to a plan the process replies to with `reply(its id)`. */
    const check = (reply: (id: number) => unknown): Promise<PlanReply | null> => {
      const plan = planner.plan(QUERY, FEED)
      fake.reply(reply(fake.sent.at(-1)?.id ?? 0))
      return plan
    }
    const bad: ((id: number) => unknown)[] = [
      (id) => ({ kind: 'failed', id }),
      (id) => ({ kind: 'planned', id }),
      (id) => ({ kind: 'planned', id, plans: 'no', noTrip: null }),
      (id) => planned(id, [{ ...PLAN, leave: 'soon' }]),
      (id) => planned(id, [{ ...PLAN, arrive: Number.NaN }]),
      (id) => planned(id, [{ ...PLAN, rides: 1.5 }]),
      (id) => planned(id, [{ ...PLAN, steps: [{ kind: 'fly' }] }]),
      (id) => planned(id, [{ ...PLAN, steps: [{ ...RIDE, color: 'red;background:url(x)' }] }]),
      (id) => planned(id, [{ ...PLAN, steps: [{ ...RIDE, textColor: '#FFFFFF' }] }]),
      (id) => planned(id, [{ ...PLAN, steps: [{ ...RIDE, routeName: 'x'.repeat(1000) }] }]),
      (id) => planned(id, [{ ...PLAN, steps: [{ ...RIDE, live: 'yes' }] }]),
      (id) => planned(id, [{ ...PLAN, steps: [{ ...RIDE, delayMin: Infinity }] }]),
      (id) => planned(id, [{ ...PLAN, steps: [{ ...RIDE, stops: -1 }] }]),
      (id) => planned(id, [{ ...PLAN, steps: [{ ...RIDE, tripId: 1234567 }] }]),
      (id) => planned(id, [{ ...PLAN, steps: [{ ...RIDE, tripId: 'x'.repeat(201) }] }]),
      (id) => planned(id, [{ ...PLAN, steps: [{ ...RIDE, fromStopId: undefined }] }]),
      (id) => planned(id, [{ ...PLAN, steps: [{ ...RIDE, toStopId: 'x'.repeat(201) }] }]),
      (id) =>
        planned(id, [
          { ...PLAN, steps: [{ kind: 'walk', start: 1, end: 2, minutes: 1, toName: 3 }] }
        ]),
      (id) =>
        planned(
          id,
          Array.from({ length: 50 }, () => PLAN)
        ),
      (id) => planned(id, [{ ...PLAN, steps: Array.from({ length: 50 }, () => RIDE) }]),
      (id) => planned(id, [], { walkSec: 'far', serviceStarts: null }),
      (id) => planned(id, [], 'none')
    ]
    for (const reply of bad) await expect(check(reply)).resolves.toBeNull()
    await expect(check((id) => planned(id))).resolves.toMatchObject({ plans: [PLAN] })
    // An id of 200 characters is still one.
    const longId = { ...PLAN, steps: [{ ...RIDE, tripId: 'x'.repeat(200) }] }
    await expect(check((id) => planned(id, [longId]))).resolves.toMatchObject({ plans: [longId] })
    planner.dispose()
  })

  it('leaves a reply that names no request unanswered until its time is up', async () => {
    vi.useFakeTimers()
    const fake = fakeProcess()
    const planner = createTripPlanner({ start: () => fake.process, timeoutMs: 10_000 })
    const plan = planner.plan(QUERY, FEED)
    let settled = false
    void plan.then(() => (settled = true))
    fake.reply('not a message')
    fake.reply({ kind: 'planned', plans: [] })
    await Promise.resolve()
    expect(settled).toBe(false)
    vi.advanceTimersByTime(10_000)
    await expect(plan).resolves.toBeNull()
    planner.dispose()
  })

  it('gives no plan when the process cannot be started, or once it is disposed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = createTripPlanner({
      start: () => {
        throw new Error('no')
      }
    })
    await expect(broken.plan(QUERY, FEED)).resolves.toBeNull()
    warn.mockRestore()
    const fake = fakeProcess()
    const start = vi.fn(() => fake.process)
    const planner = createTripPlanner({ start })
    const pending = planner.plan(QUERY, FEED)
    planner.dispose()
    await expect(pending).resolves.toBeNull()
    expect(fake.process.killed).toBe(true)
    await expect(planner.plan(QUERY, FEED)).resolves.toBeNull()
    expect(start).toHaveBeenCalledTimes(1)
    broken.dispose()
  })
})
