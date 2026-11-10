import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeHelper } from '../todos/apple-reminders/fakeHelper'
import { helperLocation } from './location'
import { DEMO_ACCURACY_M, DEMO_POSITION, demoLocation, demoWeather } from './mock'

afterEach(() => {
  vi.useRealTimers()
})

function started(): {
  helper: ReturnType<typeof fakeHelper>
  source: ReturnType<typeof helperLocation>
} {
  const helper = fakeHelper()
  const source = helperLocation(helper.start)
  helper.say({ type: 'access', status: 'granted' })
  return { helper, source }
}

describe('helperLocation', () => {
  it('locate maps a reply to a position', async () => {
    const { helper, source } = started()
    const result = source.locate()
    helper.reply('locate', { ok: true, lat: 33.42456, lon: -111.93349, accuracyM: 51 })
    expect(await result).toEqual({
      ok: true,
      position: { lat: 33.42456, lon: -111.93349 },
      accuracyM: 51
    })
  })

  it('locate takes the fix’s accuracy, 100 m when the helper gives none that makes sense', async () => {
    const { helper, source } = started()
    const zero = source.locate()
    helper.reply('locate', { ok: true, lat: 33.4, lon: -111.9, accuracyM: 0 })
    expect(await zero).toMatchObject({ ok: true, accuracyM: 0 })
    // CoreLocation reports -1 for a fix whose accuracy it can't vouch for.
    for (const accuracyM of [undefined, -1, Number.NaN, 'good', null]) {
      const result = source.locate()
      helper.reply('locate', { ok: true, lat: 33.4, lon: -111.9, accuracyM })
      expect(await result).toMatchObject({ ok: true, accuracyM: 100 })
    }
  })

  it('locate maps servicesOff and access errors', async () => {
    const { helper, source } = started()
    const off = source.locate()
    helper.reply('locate', { ok: false, error: 'servicesOff' })
    expect(await off).toEqual({ ok: false, reason: 'servicesOff' })
    const denied = source.locate()
    helper.reply('locate', { ok: false, error: 'access', status: 'denied' })
    expect(await denied).toEqual({ ok: false, reason: 'access' })
  })

  it('locate fails on a position that makes no sense', async () => {
    const { helper, source } = started()
    const result = source.locate()
    helper.reply('locate', { ok: true, lat: 'here', lon: -111.9 })
    expect(await result).toEqual({ ok: false, reason: 'failed' })
  })

  it('locate fails when the helper doesn’t answer', async () => {
    vi.useFakeTimers()
    const { source } = started()
    const result = source.locate()
    await vi.advanceTimersByTimeAsync(45_000)
    expect(await result).toEqual({ ok: false, reason: 'failed' })
  })

  it('placeName sends the rounded position and returns null for a missing place', async () => {
    const { helper, source } = started()
    const named = source.placeName({ lat: 33.42, lon: -111.93 })
    helper.reply('place', { ok: true, place: 'Tempe' })
    expect(await named).toBe('Tempe')
    expect(helper.sent.at(-1)).toMatchObject({ op: 'place', lat: 33.42, lon: -111.93 })
    const nowhere = source.placeName({ lat: 33.42, lon: -111.93 })
    helper.reply('place', { ok: true, place: null })
    expect(await nowhere).toBeNull()
  })

  it('placeName rejects when the lookup fails, so it’s tried again', async () => {
    const { helper, source } = started()
    const named = source.placeName({ lat: 33.42, lon: -111.93 })
    helper.reply('place', { ok: false, error: 'failed' })
    await expect(named).rejects.toThrow()
  })

  it('onAccess fires on a new status', () => {
    const helper = fakeHelper()
    const source = helperLocation(helper.start)
    const heard: string[] = []
    source.onAccess((access) => heard.push(access))
    helper.say({ type: 'access', status: 'notDetermined' })
    helper.say({ type: 'access', status: 'notDetermined' })
    helper.say({ type: 'access', status: 'granted' })
    expect(heard).toEqual(['notDetermined', 'granted'])
    expect(source.access()).toBe('granted')
  })

  it('requestAccess and stop reach the helper', () => {
    const { helper, source } = started()
    source.requestAccess()
    expect(helper.sent.at(-1)).toMatchObject({ op: 'requestAccess' })
    source.stop()
    expect(helper.stops).toBe(1)
  })
})

describe('demo', () => {
  it('is in Tempe with access', async () => {
    const source = demoLocation()
    expect(source.access()).toBe('granted')
    expect(await source.locate()).toEqual({
      ok: true,
      position: DEMO_POSITION,
      accuracyM: DEMO_ACCURACY_M
    })
    expect(await source.placeName(DEMO_POSITION)).toBe('Tempe')
  })

  it('demoWeather gives 24 hours and 101 °F as the high', async () => {
    const forecast = await demoWeather(() => Date.UTC(2026, 9, 27, 21, 45)).read(DEMO_POSITION)
    expect(forecast?.hours).toHaveLength(24)
    expect(Math.round(((forecast?.highC ?? 0) * 9) / 5 + 32)).toBe(101)
    expect(Math.round(((forecast?.lowC ?? 0) * 9) / 5 + 32)).toBe(74)
  })
})
