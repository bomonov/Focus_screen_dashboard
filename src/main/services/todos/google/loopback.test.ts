import { request } from 'http'
import { describe, expect, it } from 'vitest'
import { listenForRedirect } from './loopback'

/** A raw GET, so the test controls the Host header (fetch won't let it). */
function get(
  redirectUri: string,
  path: string,
  host?: string
): Promise<{ status: number; body: string }> {
  const target = new URL(path, redirectUri)
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        headers: host ? { Host: host } : {}
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      }
    )
    req.on('error', reject)
    req.end()
  })
}

describe('listenForRedirect', () => {
  it('hands over the code from Google’s redirect and stops listening', async () => {
    const redirect = await listenForRedirect({ state: 'abc', timeoutMs: 5000 })
    expect(redirect.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

    const answer = await get(redirect.redirectUri, '/?state=abc&code=4%2F0x&scope=s')
    expect(answer.status).toBe(200)
    expect(answer.body).toContain('Signed in')
    await expect(redirect.result).resolves.toEqual({ kind: 'code', code: '4/0x' })
    await expect(get(redirect.redirectUri, '/?state=abc&code=again')).rejects.toThrow()
  })

  it('passes on a declined consent screen', async () => {
    const redirect = await listenForRedirect({ state: 'abc', timeoutMs: 5000 })
    const answer = await get(redirect.redirectUri, '/?state=abc&error=access_denied')
    expect(answer.body).toContain('Not connected')
    await expect(redirect.result).resolves.toEqual({ kind: 'error', error: 'access_denied' })
  })

  it('ignores other paths, wrong states and foreign Host headers', async () => {
    const redirect = await listenForRedirect({ state: 'abc', timeoutMs: 5000 })
    expect((await get(redirect.redirectUri, '/favicon.ico')).status).toBe(404)
    expect((await get(redirect.redirectUri, '/?state=nope&code=x')).status).toBe(404)
    const port = new URL(redirect.redirectUri).port
    expect(
      (await get(redirect.redirectUri, '/?state=abc&code=x', `evil.test:${port}`)).status
    ).toBe(400)
    // Still waiting for the real redirect.
    expect((await get(redirect.redirectUri, '/?state=abc&code=real')).status).toBe(200)
    await expect(redirect.result).resolves.toEqual({ kind: 'code', code: 'real' })
  })

  it('gives up after the time limit', async () => {
    const redirect = await listenForRedirect({ state: 'abc', timeoutMs: 20 })
    await expect(redirect.result).resolves.toEqual({ kind: 'timeout' })
  })

  it('can be cancelled', async () => {
    const redirect = await listenForRedirect({ state: 'abc', timeoutMs: 5000 })
    redirect.close()
    await expect(redirect.result).resolves.toEqual({ kind: 'cancelled' })
  })
})
