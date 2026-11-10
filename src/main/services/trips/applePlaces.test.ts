import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeHelper } from '../todos/apple-reminders/fakeHelper'
import { createApplePlaces } from './applePlaces'
import { PHOENIX_AREA } from './types'

afterEach(() => {
  vi.useRealTimers()
})

function started(): {
  helper: ReturnType<typeof fakeHelper>
  apple: ReturnType<typeof createApplePlaces>
} {
  const helper = fakeHelper()
  return { helper, apple: createApplePlaces(helper.start) }
}

const MARKETPLACE = {
  name: 'Tempe Marketplace',
  detail: 'E Rio Salado Pkwy, Tempe',
  lat: 33.4329,
  lon: -111.9042
}

describe('createApplePlaces', () => {
  it('sends only the words typed and the Phoenix-area box', () => {
    const { helper, apple } = started()
    void apple.search('  Tempe Marketplace  ')
    const sent = helper.sent.at(-1) ?? {}
    expect(Object.keys(sent).sort()).toEqual(['box', 'id', 'op', 'text'])
    expect(sent).toEqual({
      id: sent.id,
      op: 'search',
      text: 'Tempe Marketplace',
      box: { south: 33.1, west: -112.7, north: 33.9, east: -111.5 }
    })
    expect(sent.box).toEqual(PHOENIX_AREA)
  })

  it('sends at most 100 characters', () => {
    const { helper, apple } = started()
    void apple.search('a'.repeat(150))
    expect(helper.sent.at(-1)?.text).toBe('a'.repeat(100))
  })

  it('asks nothing for under two characters', async () => {
    const { helper, apple } = started()
    expect(await apple.search(' t ')).toEqual([])
    expect(helper.sent).toEqual([])
  })

  it('turns the reply into places', async () => {
    const { helper, apple } = started()
    const found = apple.search('Tempe Marketplace')
    helper.reply('search', { ok: true, results: [MARKETPLACE] })
    const [place, ...rest] = await found
    expect(rest).toEqual([])
    expect(place).toMatchObject({ kind: 'apple', ...MARKETPLACE })
    expect(place?.id).toMatch(/^apple:/)
  })

  it('keeps the good results of a reply with junk in it', async () => {
    const { helper, apple } = started()
    const found = apple.search('target')
    helper.reply('search', {
      ok: true,
      results: [
        null,
        'Target',
        { name: '', lat: 33.4, lon: -111.9 },
        { name: 'No position', lat: '33.4', lon: -111.9 },
        { name: 'Not a number', lat: Number.NaN, lon: -111.9 },
        // Denver: outside the box, so not one of ours.
        { name: 'Target Denver', detail: 'Colfax Ave', lat: 39.74, lon: -104.99 },
        { name: '  Target  ', detail: 42, lat: 33.38, lon: -111.94 },
        MARKETPLACE
      ]
    })
    expect((await found).map(({ name, detail }) => ({ name, detail }))).toEqual([
      { name: 'Target', detail: '' },
      { name: 'Tempe Marketplace', detail: 'E Rio Salado Pkwy, Tempe' }
    ])
  })

  it('keeps at most eight, each once', async () => {
    const { helper, apple } = started()
    const found = apple.search('coffee')
    const results = Array.from({ length: 12 }, (_, i) => ({
      name: `Coffee ${i}`,
      detail: '',
      lat: 33.4 + i * 0.001,
      lon: -111.9
    }))
    helper.reply('search', { ok: true, results: [results[0], ...results] })
    const places = await found
    expect(places.map((p) => p.name)).toEqual(results.slice(0, 8).map((r) => r.name))
    expect(new Set(places.map((p) => p.id)).size).toBe(8)
  })

  it('puts places named like the words typed first, else keeps Apple’s order', async () => {
    const { helper, apple } = started()
    const found = apple.search('tempe market')
    // Apple's own answer on 2026-11-03: nearest the box's middle (west Phoenix) first.
    const other = (name: string, i: number): Record<string, unknown> => ({
      name,
      detail: 'W Thomas Rd, Phoenix',
      lat: 33.47 + i * 0.001,
      lon: -112.2
    })
    helper.reply('search', {
      ok: true,
      results: [
        other('Phoenix Marketplace', 0),
        other('Uptown Farmers Market', 1),
        ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((letter, i) =>
          other(`Shop ${letter}`, i + 2)
        ),
        MARKETPLACE,
        other('Harkins Theatres', 11)
      ]
    })
    expect((await found).map((p) => p.name)).toEqual([
      'Tempe Marketplace',
      'Phoenix Marketplace',
      'Uptown Farmers Market',
      'Shop A',
      'Shop B',
      'Shop C',
      'Shop D',
      'Shop E'
    ])
  })

  it('ranks by a street word part typed as well as whole', async () => {
    const { helper, apple } = started()
    const found = apple.search('mill aven')
    const result = (name: string, i: number): Record<string, unknown> => ({
      name,
      detail: 'Tempe',
      lat: 33.42 + i * 0.001,
      lon: -111.94
    })
    helper.reply('search', {
      ok: true,
      results: [result('Millennium Stadium', 0), result('Mill Ave Shops', 1)]
    })
    expect((await found).map((p) => p.name)).toEqual(['Mill Ave Shops', 'Millennium Stadium'])
  })

  it('finds nothing when the search failed or the reply makes no sense', async () => {
    const { helper, apple } = started()
    const failed = apple.search('chipotle')
    helper.reply('search', { ok: false, error: 'failed' })
    expect(await failed).toEqual([])
    const odd = apple.search('chipotle')
    helper.reply('search', { ok: true, results: 'Chipotle' })
    expect(await odd).toEqual([])
  })

  it('finds nothing when the helper sends a line that isn’t JSON', async () => {
    vi.useFakeTimers()
    const { helper, apple } = started()
    const found = apple.search('chipotle')
    // What the runner hands on for a broken line, at worst: something that isn't a message.
    helper.say('{"type":"reply","id":')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await found).toEqual([])
  })

  it('finds nothing when the helper stops', async () => {
    const { helper, apple } = started()
    const found = apple.search('chipotle')
    helper.crash()
    expect(await found).toEqual([])
  })

  it('finds nothing after 10 s of silence', async () => {
    vi.useFakeTimers()
    const { apple } = started()
    const found = apple.search('chipotle')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await found).toEqual([])
  })

  it('stops the helper, and asks nothing after', async () => {
    const { helper, apple } = started()
    apple.stop()
    expect(helper.stops).toBe(1)
    expect(await apple.search('chipotle')).toEqual([])
    expect(helper.sent).toEqual([])
  })
})
