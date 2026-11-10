import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { parseCallback, type CallbackResult } from './oauth'

export type RedirectResult = CallbackResult | { kind: 'timeout' } | { kind: 'cancelled' }

export interface LoopbackRedirect {
  /** `http://127.0.0.1:<port>`, the redirect_uri for this one sign-in. */
  redirectUri: string
  /** Settles once: Google's redirect, the time limit, or `close()`. */
  result: Promise<RedirectResult>
  close(): void
}

export type ListenForRedirect = (options: {
  state: string
  timeoutMs: number
}) => Promise<LoopbackRedirect>

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  'Referrer-Policy': 'no-referrer',
  Connection: 'close'
}

/** A static page; nothing from the request is echoed into it. */
function page(heading: string, text: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Focus Screen</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#000;color:#fff;font:20px/1.4 Arial,Helvetica,sans-serif;text-align:center;padding:0 24px}
h1{font-size:32px;margin:0 0 12px}p{color:#bfbfbf;margin:0}
</style>
</head>
<body><main><h1>${heading}</h1><p>${text}</p></main></body>
</html>
`
}

const SIGNED_IN = page('Signed in', 'You can close this tab and go back to Focus Screen.')
const NOT_CONNECTED = page('Not connected', 'You can close this tab and go back to Focus Screen.')
const NOT_FOR_US = page('Nothing to see here', 'This address only answers Google’s sign-in.')

/**
 * A one-shot web server on 127.0.0.1 (never other machines) on a random port, for Google's
 * redirect back from the browser. It closes after the first real answer, the time limit,
 * or `close()`.
 */
export const listenForRedirect: ListenForRedirect = ({ state, timeoutMs }) =>
  new Promise((resolve, reject) => {
    let finish: (result: RedirectResult) => void = () => {}
    const result = new Promise<RedirectResult>((settle) => {
      finish = settle
    })
    let done = false
    let port = 0

    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      // The exact Host the browser sends for our redirect; anything else (e.g. a DNS-rebinding
      // page) gets nothing.
      if (request.method !== 'GET' || request.headers.host !== `127.0.0.1:${port}`) {
        response.writeHead(400, PAGE_HEADERS).end(NOT_FOR_US)
        return
      }
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
      const callback = url.pathname === '/' ? parseCallback(url.searchParams, state) : null
      if (!callback || done) {
        response.writeHead(404, PAGE_HEADERS).end(NOT_FOR_US)
        return
      }
      response
        .writeHead(200, PAGE_HEADERS)
        .end(callback.kind === 'code' ? SIGNED_IN : NOT_CONNECTED)
      end(callback)
    })

    function end(outcome: RedirectResult): void {
      if (done) return
      done = true
      clearTimeout(timer)
      finish(outcome)
      server.close()
      // The answer page is already on its way; only idle sockets go now.
      server.closeIdleConnections()
    }

    const timer = setTimeout(() => {
      end({ kind: 'timeout' })
      server.closeAllConnections()
    }, timeoutMs)

    server.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port
      resolve({
        redirectUri: `http://127.0.0.1:${port}`,
        result,
        close: () => {
          end({ kind: 'cancelled' })
          server.closeAllConnections()
        }
      })
    })
  })
