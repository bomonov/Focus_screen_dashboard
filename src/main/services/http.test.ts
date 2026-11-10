import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
vi.mock('electron', () => ({ app: { getVersion: () => '1.0.0' }, net: { fetch } }))

const { fetchJson } = await import('./http')

beforeEach(() => {
  fetch.mockReset()
  fetch.mockResolvedValue(new Response('{"ok":true}', { status: 200 }))
})

describe('fetchJson', () => {
  it('keeps a request out of the disk cache when asked', async () => {
    await fetchJson('https://example.test/a', { maxBytes: 1000, timeoutMs: 1000, noStore: true })
    expect(fetch.mock.calls[0]?.[1].cache).toBe('no-store')
  })

  it('leaves the cache as it is otherwise', async () => {
    const answer = await fetchJson('https://example.test/b', { maxBytes: 1000, timeoutMs: 1000 })
    expect(fetch.mock.calls[0]?.[1].cache).toBeUndefined()
    expect(answer.body).toEqual({ ok: true })
  })
})
