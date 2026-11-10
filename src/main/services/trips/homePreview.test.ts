import { describe, expect, it } from 'vitest'
import { homePreviewOf } from './homePreview'
import type { TripPlan, TripRide } from './types'

const NOW = 1_793_000_000

function ride(routeName: string, short: string): TripRide {
  return {
    kind: 'ride',
    routeName,
    short,
    color: '',
    textColor: '',
    rail: false,
    headsign: '',
    tripId: `${short}-1`,
    fromName: 'A',
    fromStopId: 'a',
    toName: 'B',
    toStopId: 'b',
    depart: NOW + 300,
    arrive: NOW + 900,
    stops: 3,
    live: false,
    delayMin: null
  }
}

const plan = (steps: TripPlan['steps'], leave = NOW + 120, arrive = NOW + 1400): TripPlan => ({
  leave,
  arrive,
  steps,
  rides: steps.filter((step) => step.kind === 'ride').length,
  walkM: 500
})

const walk = { kind: 'walk', start: NOW, end: NOW + 300, minutes: 5, toName: 'A' } as const

describe('homePreviewOf', () => {
  it('takes the best trip: when to leave, when it gets there, and its first ride', () => {
    const best = plan([walk, ride('Orbit Venus', 'VENU'), ride('Route 72', '72')])
    expect(homePreviewOf([best, plan([walk])])).toEqual({
      leave: NOW + 120,
      arrive: NOW + 1400,
      first: 'Orbit Venus'
    })
  })

  it('names a numbered route by its number, as the chips do', () => {
    expect(homePreviewOf([plan([walk, ride('Route 72', '72')])])?.first).toBe('72')
  })

  it('says "walk" for a trip that’s only a walk', () => {
    expect(homePreviewOf([plan([{ ...walk, toName: null }], NOW, NOW + 720)])).toEqual({
      leave: NOW,
      arrive: NOW + 720,
      first: 'walk'
    })
  })

  it('has nothing when nothing gets there, or there was no answer', () => {
    expect(homePreviewOf([])).toBeNull()
    expect(homePreviewOf(null)).toBeNull()
  })
})
