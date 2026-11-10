import { describe, expect, it } from 'vitest'
import type { CanvasFormResult } from '../types'
import { handleCanvasForm } from './form'
import type { CanvasProvider } from './provider'

function fakeCanvas(): CanvasProvider & { calls: string[] } {
  const calls: string[] = []
  const ok: CanvasFormResult = { ok: true }
  return {
    calls,
    source: 'canvas',
    name: 'Canvas',
    start: () => {},
    connection: () => 'disconnected',
    list: async () => [],
    setDone: async () => {},
    dispose: () => {},
    address: () => '',
    connectToken: async (address, token) => {
      calls.push(`token ${address} ${token}`)
      return ok
    },
    connectFeed: async (url) => {
      calls.push(`feed ${url}`)
      return ok
    },
    disconnect: () => {}
  }
}

describe('handleCanvasForm', () => {
  it('passes connect requests to the provider', async () => {
    const canvas = fakeCanvas()
    const open = async (): Promise<void> => {}
    await handleCanvasForm(canvas, { kind: 'connectToken', address: 'a.edu', token: 't' }, open)
    await handleCanvasForm(canvas, { kind: 'connectFeed', url: 'u' }, open)
    expect(canvas.calls).toEqual(['token a.edu t', 'feed u'])
  })

  it('opens the help page on the user’s own Canvas', async () => {
    const opened: string[] = []
    const open = async (url: string): Promise<void> => void opened.push(url)
    const request = { kind: 'openPage', address: 'canvas.school.edu' } as const
    expect(await handleCanvasForm(fakeCanvas(), { ...request, page: 'token' }, open)).toEqual({
      ok: true
    })
    await handleCanvasForm(fakeCanvas(), { ...request, page: 'feed' }, open)
    expect(opened).toEqual([
      'https://canvas.school.edu/profile/settings',
      'https://canvas.school.edu/calendar'
    ])
  })

  it('asks for the address before opening anything', async () => {
    const opened: string[] = []
    const result = await handleCanvasForm(
      fakeCanvas(),
      { kind: 'openPage', page: 'token', address: '' },
      async (url) => void opened.push(url)
    )
    expect(result).toMatchObject({ ok: false, field: 'address' })
    expect(opened).toEqual([])
  })
})
