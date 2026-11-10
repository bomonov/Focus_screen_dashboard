// The trip card's commands come from the renderer: only the exact shapes pass, and a place in
// one is checked again (its text, its position) however it was made.
import { describe, expect, it } from 'vitest'
import { parseTripCommand } from './parse'
import type { Place } from './types'

const PLACE: Place = {
  id: 'apple:33.41400,-111.91000:Trader Joe’s',
  kind: 'apple',
  name: 'Trader Joe’s',
  detail: 'Tempe',
  lat: 33.414,
  lon: -111.91
}

describe('parseTripCommand', () => {
  it('passes the commands that carry nothing', () => {
    for (const kind of [
      'open',
      'close',
      'unkeep',
      'setHomeHere',
      'clearHome',
      'clearRecents',
      'downloadSchedule',
      'requestAccess',
      'openLocationSettings'
    ]) {
      expect(parseTripCommand({ kind, extra: 1 })).toEqual({ kind })
    }
  })

  it('passes a plan, with only a place’s own fields', () => {
    const fromClass = { ...PLACE, kind: 'class', title: 'CSE 240', start: 1_793_640_000 }
    expect(
      parseTripCommand({
        kind: 'plan',
        to: fromClass,
        from: { kind: 'here' },
        when: { kind: 'now' }
      })
    ).toEqual({
      kind: 'plan',
      to: { ...PLACE, kind: 'class' },
      from: { kind: 'here' },
      when: { kind: 'now' }
    })
    expect(
      parseTripCommand({
        kind: 'plan',
        to: PLACE,
        from: { kind: 'place', place: { ...PLACE, id: 'home', kind: 'home', name: 'Home' } },
        when: { kind: 'arrive', time: 1_793_640_000 }
      })
    ).toEqual({
      kind: 'plan',
      to: PLACE,
      from: { kind: 'place', place: { ...PLACE, id: 'home', kind: 'home', name: 'Home' } },
      when: { kind: 'arrive', time: 1_793_640_000 }
    })
  })

  it('passes keep, save, rename and remove', () => {
    const keep = { kind: 'keep', index: 2, leave: 1_793_640_000, tripId: 'venus-1' }
    expect(parseTripCommand(keep)).toEqual(keep)
    const walk = { kind: 'keep', index: 0, leave: 1_793_640_000, tripId: null }
    expect(parseTripCommand(walk)).toEqual(walk)
    expect(parseTripCommand({ kind: 'save', place: PLACE, name: 'Groceries' })).toEqual({
      kind: 'save',
      place: PLACE,
      name: 'Groceries'
    })
    expect(parseTripCommand({ kind: 'rename', id: 'saved:1', name: 'Alex’s' })).toEqual({
      kind: 'rename',
      id: 'saved:1',
      name: 'Alex’s'
    })
    expect(parseTripCommand({ kind: 'remove', id: 'saved:1' })).toEqual({
      kind: 'remove',
      id: 'saved:1'
    })
  })

  it('drops shapes it doesn’t know', () => {
    for (const raw of [
      null,
      'open',
      [{ kind: 'open' }],
      { kind: 'other' },
      { kind: 'keep' },
      { kind: 'keep', index: -1, leave: 1, tripId: null },
      { kind: 'keep', index: 1.5, leave: 1, tripId: null },
      { kind: 'keep', index: 3, leave: 1, tripId: null },
      { kind: 'keep', index: '0', leave: 1, tripId: null },
      // Which plan it is goes with it, or it isn't kept.
      { kind: 'keep', index: 0 },
      { kind: 'keep', index: 0, leave: 1 },
      { kind: 'keep', index: 0, tripId: 'venus-1' },
      { kind: 'keep', index: 0, leave: Number.NaN, tripId: null },
      { kind: 'keep', index: 0, leave: '1', tripId: null },
      { kind: 'keep', index: 0, leave: 1, tripId: 7 },
      { kind: 'keep', index: 0, leave: 1, tripId: 'x'.repeat(201) },
      { kind: 'remove' },
      { kind: 'remove', id: '' },
      { kind: 'remove', id: 'x'.repeat(201) },
      { kind: 'rename', id: 'saved:1' },
      { kind: 'rename', id: 'saved:1', name: 'x'.repeat(201) },
      { kind: 'save', place: PLACE },
      { kind: 'save', name: 'Groceries' }
    ]) {
      expect(parseTripCommand(raw)).toBeNull()
    }
  })

  it('drops a plan whose start, time or destination isn’t right', () => {
    const plan = (change: Record<string, unknown>): unknown => ({
      kind: 'plan',
      to: PLACE,
      from: { kind: 'here' },
      when: { kind: 'now' },
      ...change
    })
    for (const raw of [
      plan({ to: null }),
      plan({ from: { kind: 'there' } }),
      plan({ from: { kind: 'place' } }),
      plan({ from: { kind: 'place', place: { ...PLACE, lat: 'north' } } }),
      plan({ when: null }),
      plan({ when: { kind: 'later' } }),
      plan({ when: { kind: 'depart' } }),
      plan({ when: { kind: 'depart', time: Number.NaN } }),
      plan({ when: { kind: 'arrive', time: Infinity } }),
      plan({ when: { kind: 'arrive', time: '9:00' } })
    ]) {
      expect(parseTripCommand(raw)).toBeNull()
    }
  })

  it('re-checks a place’s text and position', () => {
    const plan = (to: unknown): unknown => ({
      kind: 'plan',
      to,
      from: { kind: 'here' },
      when: { kind: 'now' }
    })
    for (const to of [
      { ...PLACE, id: '' },
      { ...PLACE, id: 'x'.repeat(201) },
      { ...PLACE, kind: 'somewhere' },
      { ...PLACE, name: 3 },
      { ...PLACE, name: 'x'.repeat(201) },
      { ...PLACE, detail: 'x'.repeat(201) },
      { ...PLACE, detail: undefined },
      { ...PLACE, lat: Number.NaN },
      { ...PLACE, lat: 91 },
      { ...PLACE, lon: -181 },
      { ...PLACE, lon: Infinity },
      { ...PLACE, lat: '33.4' }
    ]) {
      expect(parseTripCommand(plan(to))).toBeNull()
    }
    expect(parseTripCommand(plan({ ...PLACE, name: 'x'.repeat(200), detail: '' }))).not.toBeNull()
  })
})
