import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { SecretKey, SecretStore } from '../../secrets/store'
import { createPairingCodes } from './pairing'
import type { BrowserKind } from './parse'
import { CHROME_EXTENSION_ID, type AppMessage, type PageState } from './protocol'
import { startExtensionServer, type ExtensionServer } from './server'

const CHROME = `chrome-extension://${CHROME_EXTENSION_ID}`
const SAFARI = 'safari-web-extension://3F2504E0-4F89-11D3-9A0C-0305E82C3301'

const page: PageState = {
  videoId: 'abcdefghijk',
  playlistId: 'PLx7Gk2mQ9vR4tYb_Lw-8sNc3dHfJ0aZpE',
  title: 'Quiet Library',
  artist: 'Lofi Desk Club',
  album: 'Study Hall',
  durationSec: 187,
  positionSec: 30,
  playing: true,
  shuffle: false,
  repeat: 'off',
  artworkUrl: null,
  ad: false,
  next: null
}

function memorySecrets(): SecretStore & { values: Map<SecretKey, string> } {
  const values = new Map<SecretKey, string>()
  return {
    values,
    get: (key) => values.get(key) ?? null,
    set: (key, value) => void values.set(key, value),
    delete: (key) => void values.delete(key)
  }
}

interface Harness {
  server: ExtensionServer
  port: number
  secrets: ReturnType<typeof memorySecrets>
  code: string
  states: { browser: BrowserKind; state: PageState | null }[]
  disconnects: BrowserKind[]
}

let open: { server: ExtensionServer; sockets: WebSocket[] } | null = null

afterEach(() => {
  for (const socket of open?.sockets ?? []) socket.terminate()
  open?.server.close()
  open = null
})

async function harness(): Promise<Harness> {
  const secrets = memorySecrets()
  const pairing = createPairingCodes()
  const states: Harness['states'] = []
  const disconnects: BrowserKind[] = []
  const server = startExtensionServer({
    port: 0,
    secrets,
    pairing,
    now: () => Date.now() / 1000,
    onState: (browser, state) => states.push({ browser, state }),
    onDisconnect: (browser) => disconnects.push(browser)
  })
  open = { server, sockets: [] }
  const port = await server.ready
  return { server, port, secrets, code: pairing.create(Date.now() / 1000), states, disconnects }
}

/** Connects and collects what the app sends; resolves once the socket is open (or refused). */
function connect(
  port: number,
  origin: string,
  headers: Record<string, string> = {}
): Promise<{ socket: WebSocket; received: AppMessage[]; opened: boolean; closed: () => boolean }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin, headers })
  open?.sockets.push(socket)
  const received: AppMessage[] = []
  let closed = false
  socket.on('message', (data) => received.push(JSON.parse(data.toString()) as AppMessage))
  socket.on('close', () => (closed = true))
  return new Promise((resolve) => {
    socket.once('open', () => resolve({ socket, received, opened: true, closed: () => closed }))
    socket.once('error', () => resolve({ socket, received, opened: false, closed: () => true }))
  })
}

const send = (socket: WebSocket, message: unknown): void => socket.send(JSON.stringify(message))

describe('extension server', () => {
  it('refuses websites and other hosts before they can say anything', async () => {
    const { port } = await harness()
    expect((await connect(port, 'https://music.youtube.com')).opened).toBe(false)
    expect((await connect(port, 'https://evil.example')).opened).toBe(false)
    expect((await connect(port, CHROME, { Host: `evil.example:${port}` })).opened).toBe(false)
  })

  it('pairs with the code, saves a token, and then takes page states', async () => {
    const h = await harness()
    const client = await connect(h.port, CHROME)
    send(client.socket, { type: 'pair', version: 1, code: h.code })
    await expect.poll(() => client.received[0]?.type).toBe('paired')
    const reply = client.received[0]
    expect(reply?.type === 'paired' && reply.token).toBe(h.secrets.values.get('extension.chrome'))

    send(client.socket, { type: 'state', state: page })
    await expect.poll(() => h.states).toEqual([{ browser: 'chrome', state: page }])
  })

  it('ignores page states until the connection is paired', async () => {
    const h = await harness()
    const client = await connect(h.port, SAFARI)
    send(client.socket, { type: 'state', state: page })
    send(client.socket, {
      type: 'pair',
      version: 1,
      code: '000000' === h.code ? '111111' : '000000'
    })
    await expect.poll(() => client.closed()).toBe(true)
    expect(client.received).toEqual([{ type: 'rejected', reason: 'badCode' }])
    expect(h.states).toEqual([])
    expect(h.secrets.values.size).toBe(0)
  })

  it('welcomes a known token and refuses a wrong one', async () => {
    const h = await harness()
    h.secrets.values.set('extension.safari', 'right-token')
    const good = await connect(h.port, SAFARI)
    send(good.socket, { type: 'hello', version: 1, token: 'right-token' })
    await expect.poll(() => good.received).toEqual([{ type: 'welcome' }])

    const bad = await connect(h.port, SAFARI)
    send(bad.socket, { type: 'hello', version: 1, token: 'wrong-token' })
    await expect.poll(() => bad.closed()).toBe(true)
    expect(bad.received).toEqual([{ type: 'rejected', reason: 'badToken' }])
    // A Chrome token doesn't open Safari's door either.
    h.secrets.values.set('extension.chrome', 'chrome-token')
    const crossed = await connect(h.port, SAFARI)
    send(crossed.socket, { type: 'hello', version: 1, token: 'chrome-token' })
    await expect.poll(() => crossed.closed()).toBe(true)
  })

  it('sends commands to the paired browser and round-trips covers', async () => {
    const h = await harness()
    h.secrets.values.set('extension.chrome', 'tok')
    const client = await connect(h.port, CHROME)
    send(client.socket, { type: 'hello', version: 1, token: 'tok' })
    await expect.poll(() => client.received.length).toBe(1)

    expect(h.server.send('chrome', { kind: 'next' })).toBe(true)
    expect(h.server.send('safari', { kind: 'next' })).toBe(false)
    await expect
      .poll(() => client.received[1])
      .toEqual({ type: 'command', command: { kind: 'next' } })

    client.socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as AppMessage
      if (message.type === 'artworkRequest') {
        send(client.socket, { type: 'artwork', requestId: message.requestId, base64: 'AQID' })
      }
    })
    const bytes = await h.server.requestArtwork('chrome', 'https://i.ytimg.com/vi/x/hq.jpg')
    expect(Array.from(bytes ?? [])).toEqual([1, 2, 3])
  })

  it('reports a disconnect only for the live connection', async () => {
    const h = await harness()
    h.secrets.values.set('extension.chrome', 'tok')
    const first = await connect(h.port, CHROME)
    send(first.socket, { type: 'hello', version: 1, token: 'tok' })
    await expect.poll(() => first.received.length).toBe(1)
    // A second connection from the same browser replaces the first without a disconnect.
    const second = await connect(h.port, CHROME)
    send(second.socket, { type: 'hello', version: 1, token: 'tok' })
    await expect.poll(() => first.closed()).toBe(true)
    expect(h.disconnects).toEqual([])
    second.socket.close()
    await expect.poll(() => h.disconnects).toEqual(['chrome'])
  })
})
