import { randomBytes, timingSafeEqual } from 'crypto'
import type { IncomingMessage } from 'http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { SecretKey, SecretStore } from '../../secrets/store'
import type { PairingCodes } from './pairing'
import { browserForOrigin, isLoopbackHost, parseExtensionMessage, type BrowserKind } from './parse'
import {
  MAX_ARTWORK_BYTES,
  PROTOCOL_VERSION,
  type AppMessage,
  type PageCommand,
  type PageLyrics,
  type PageState
} from './protocol'

/** A connection must say hello (or pair) this quickly, or it's dropped. */
const AUTH_TIMEOUT_MS = 10_000
/** Under Chrome's 30 s idle limit for extension service workers. */
const KEEPALIVE_MS = 20_000
const ARTWORK_TIMEOUT_MS = 8000
/** The biggest cover as base64, plus the JSON around it. */
const MAX_MESSAGE_BYTES = Math.ceil((MAX_ARTWORK_BYTES * 4) / 3) + 4096
const POLICY_VIOLATION = 1008
/** Refused connections are logged at most this often, so a page probing the port can't flood the log. */
const REFUSAL_LOG_INTERVAL_MS = 10_000

export const SECRET_FOR: Record<BrowserKind, SecretKey> = {
  chrome: 'extension.chrome',
  safari: 'extension.safari'
}

export interface ExtensionServerOptions {
  /** 0 picks a free port (tests). */
  port: number
  secrets: SecretStore
  pairing: PairingCodes
  onState(browser: BrowserKind, state: PageState | null): void
  /** YouTube Music showed lyrics for a song. */
  onLyrics?(browser: BrowserKind, lyrics: PageLyrics): void
  onDisconnect(browser: BrowserKind): void
  /** Unix epoch seconds. */
  now: () => number
}

export interface ExtensionServer {
  /** Resolves with the port once listening; rejects if it can't (port taken). */
  ready: Promise<number>
  /** False when that browser isn't connected. */
  send(browser: BrowserKind, command: PageCommand): boolean
  requestArtwork(browser: BrowserKind, url: string): Promise<Uint8Array | null>
  close(): void
}

function tokenMatches(expected: string | null, given: string): boolean {
  if (!expected) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The extension's way in: a WebSocket on 127.0.0.1 only. A connection must come from our
 * extension (Origin) to our loopback address (Host), and then prove it was paired.
 */
export function startExtensionServer(options: ExtensionServerOptions): ExtensionServer {
  const { secrets, pairing, onState, onLyrics, onDisconnect, now } = options
  const active = new Map<BrowserKind, WebSocket>()
  const pending = new Map<number, (bytes: Uint8Array | null) => void>()
  let nextRequestId = 1
  let lastRefusalLog = 0

  // Origins and hosts aren't secret, and they're what tells us why a browser can't get in.
  function logRefusal(origin: string | undefined, host: string | undefined): void {
    const at = Date.now()
    if (at - lastRefusalLog < REFUSAL_LOG_INTERVAL_MS) return
    lastRefusalLog = at
    console.warn(
      `[extension] Refused a connection (origin: ${origin ?? 'none'}, host: ${host ?? 'none'}).`
    )
  }

  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port: options.port,
    maxPayload: MAX_MESSAGE_BYTES,
    verifyClient: ({ origin, req }: { origin: string | undefined; req: IncomingMessage }) => {
      const allowed =
        browserForOrigin(origin) !== null && isLoopbackHost(req.headers.host, boundPort())
      if (!allowed) logRefusal(origin, req.headers.host)
      return allowed
    }
  })

  function boundPort(): number {
    const address = wss.address()
    return typeof address === 'object' && address !== null ? address.port : -1
  }

  const ready = new Promise<number>((resolve, reject) => {
    wss.once('listening', () => resolve(boundPort()))
    wss.once('error', reject)
  })
  // Keep a failed listen (e.g. port taken) from becoming an unhandled rejection.
  ready.catch((error: unknown) => {
    console.warn('[extension] Could not listen for the browser extension.', error)
  })

  function sendTo(socket: WebSocket, message: AppMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
  }

  function settle(requestId: number, bytes: Uint8Array | null): void {
    const resolve = pending.get(requestId)
    if (!resolve) return
    pending.delete(requestId)
    resolve(bytes)
  }

  wss.on('connection', (socket, req) => {
    const browser = browserForOrigin(req.headers.origin)
    if (!browser) {
      socket.close(POLICY_VIOLATION)
      return
    }
    let paired = false
    const authTimer = setTimeout(() => {
      if (!paired) socket.close(POLICY_VIOLATION)
    }, AUTH_TIMEOUT_MS)

    const accept = (): void => {
      paired = true
      clearTimeout(authTimer)
      // One connection per browser: a reconnect replaces the old one.
      const previous = active.get(browser)
      active.set(browser, socket)
      if (previous && previous !== socket) previous.close()
    }

    const refuse = (reason: 'badToken' | 'badCode' | 'version'): void => {
      console.warn(`[extension] Refused ${browser}: ${reason}.`)
      sendTo(socket, { type: 'rejected', reason })
      socket.close(POLICY_VIOLATION)
    }

    socket.on('message', (data, isBinary) => {
      if (isBinary) return
      let raw: unknown
      try {
        raw = JSON.parse(data.toString())
      } catch {
        return
      }
      const message = parseExtensionMessage(raw)
      if (!message) return

      if (!paired) {
        if (message.type !== 'hello' && message.type !== 'pair') return
        if (message.version !== PROTOCOL_VERSION) return refuse('version')
        if (message.type === 'hello') {
          if (!tokenMatches(secrets.get(SECRET_FOR[browser]), message.token))
            return refuse('badToken')
          accept()
          console.info(`[extension] ${browser} connected.`)
          sendTo(socket, { type: 'welcome' })
        } else {
          if (!pairing.redeem(message.code, now())) return refuse('badCode')
          const token = randomBytes(32).toString('base64url')
          secrets.set(SECRET_FOR[browser], token)
          accept()
          console.info(`[extension] ${browser} paired.`)
          sendTo(socket, { type: 'paired', token })
        }
        return
      }

      switch (message.type) {
        case 'state':
          onState(browser, message.state)
          break
        case 'artwork': {
          const bytes = Buffer.from(message.base64, 'base64')
          settle(
            message.requestId,
            bytes.length <= MAX_ARTWORK_BYTES ? Uint8Array.from(bytes) : null
          )
          break
        }
        case 'artworkFailed':
          settle(message.requestId, null)
          break
        case 'lyrics':
          onLyrics?.(browser, message.lyrics)
          break
      }
    })

    socket.on('close', () => {
      clearTimeout(authTimer)
      if (active.get(browser) !== socket) return
      active.delete(browser)
      onDisconnect(browser)
    })
    // 'close' always follows; errors here are just broken connections.
    socket.on('error', () => undefined)
  })

  const keepalive = setInterval(() => {
    for (const socket of active.values()) sendTo(socket, { type: 'keepalive' })
  }, KEEPALIVE_MS)

  return {
    ready,
    send(browser, command) {
      const socket = active.get(browser)
      if (!socket) return false
      sendTo(socket, { type: 'command', command })
      return true
    },
    requestArtwork(browser, url) {
      const socket = active.get(browser)
      if (!socket) return Promise.resolve(null)
      const requestId = nextRequestId++
      return new Promise((resolve) => {
        const timer = setTimeout(() => settle(requestId, null), ARTWORK_TIMEOUT_MS)
        pending.set(requestId, (bytes) => {
          clearTimeout(timer)
          resolve(bytes)
        })
        sendTo(socket, { type: 'artworkRequest', requestId, url })
      })
    },
    close() {
      clearInterval(keepalive)
      for (const requestId of [...pending.keys()]) settle(requestId, null)
      for (const socket of wss.clients) socket.terminate()
      wss.close()
    }
  }
}
