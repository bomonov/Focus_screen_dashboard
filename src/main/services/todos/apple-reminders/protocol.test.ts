import { describe, expect, it } from 'vitest'
import { parseHelperMessage, parseListReply, parseWriteReply } from './protocol'

describe('parseHelperMessage', () => {
  it('reads the three kinds of line', () => {
    expect(parseHelperMessage({ type: 'access', status: 'granted' })).toEqual({
      type: 'access',
      status: 'granted'
    })
    expect(parseHelperMessage({ type: 'changed' })).toEqual({ type: 'changed' })
    expect(parseHelperMessage({ type: 'reply', id: 4, ok: true })).toEqual({
      type: 'reply',
      id: 4,
      body: { type: 'reply', id: 4, ok: true }
    })
  })

  it('drops anything off-shape', () => {
    expect(parseHelperMessage(null)).toBeNull()
    expect(parseHelperMessage([])).toBeNull()
    expect(parseHelperMessage({ type: 'access', status: 'yes' })).toBeNull()
    expect(parseHelperMessage({ type: 'reply', id: '4' })).toBeNull()
    expect(parseHelperMessage({ type: 'reply', id: 1.5 })).toBeNull()
    expect(parseHelperMessage({ type: 'hello' })).toBeNull()
  })
})

describe('parseListReply', () => {
  const reminder = {
    id: 'r1',
    list: 'L1',
    title: '  Pick up groceries ',
    due: { day: '2026-10-14' },
    done: false,
    completedAt: null,
    createdAt: 1_700_000_000
  }

  it('reads lists and reminders', () => {
    expect(
      parseListReply({
        ok: true,
        lists: [{ id: 'L1', title: 'Home' }],
        items: [
          reminder,
          { ...reminder, id: 'r2', due: { at: 1_800_000_000 }, done: true, completedAt: 1_799 }
        ]
      })
    ).toEqual({
      ok: true,
      lists: [{ id: 'L1', title: 'Home' }],
      reminders: [
        {
          id: 'r1',
          list: 'L1',
          title: 'Pick up groceries',
          due: { kind: 'day', day: '2026-10-14' },
          done: false,
          completedAt: null,
          createdAt: 1_700_000_000
        },
        {
          id: 'r2',
          list: 'L1',
          title: 'Pick up groceries',
          due: { kind: 'time', at: 1_800_000_000 },
          done: true,
          completedAt: 1_799,
          createdAt: 1_700_000_000
        }
      ]
    })
  })

  it('skips malformed entries and odd dates one by one', () => {
    const reply = parseListReply({
      ok: true,
      lists: [{ id: '', title: 'x' }, { id: 'L1' }, 'L2'],
      items: [
        { ...reminder, id: 7 },
        { ...reminder, done: 'no' },
        { ...reminder, id: 'r3', due: { day: '14/10/2026' } },
        { ...reminder, id: 'r4', due: { at: Number.NaN }, createdAt: -1 },
        { ...reminder, id: 'x'.repeat(501) }
      ]
    })
    expect(reply).toMatchObject({ ok: true, lists: [] })
    expect(reply?.ok && reply.reminders.map((r) => [r.id, r.due, r.createdAt])).toEqual([
      ['r3', null, 1_700_000_000],
      ['r4', null, null]
    ])
  })

  it('caps very long titles and lists', () => {
    const reply = parseListReply({
      ok: true,
      lists: [],
      items: Array.from({ length: 3000 }, (_, i) => ({
        ...reminder,
        id: `r${i}`,
        title: 'x'.repeat(400)
      }))
    })
    expect(reply?.ok && reply.reminders).toHaveLength(2500)
    expect(reply?.ok && reply.reminders[0]?.title).toHaveLength(300)
  })

  it('passes failures on, and rejects replies it can’t read', () => {
    expect(parseListReply({ ok: false, error: 'access', status: 'denied' })).toEqual({
      ok: false,
      error: 'access',
      status: 'denied'
    })
    expect(parseListReply({ ok: false, error: 'mystery' })).toEqual({
      ok: false,
      error: 'failed',
      status: null
    })
    expect(parseListReply({ ok: true, lists: [] })).toBeNull()
    expect(parseListReply({})).toBeNull()
  })
})

describe('parseWriteReply', () => {
  it('reads success and failure', () => {
    expect(parseWriteReply({ ok: true })).toEqual({ ok: true })
    expect(parseWriteReply({ ok: false, error: 'notFound' })).toEqual({
      ok: false,
      error: 'notFound',
      status: null
    })
    expect(parseWriteReply({ ok: 'yes' })).toBeNull()
  })
})
