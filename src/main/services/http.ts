import { app, net } from 'electron'
import { nextLink } from './linkHeader'

/** Every request names the app, so the services we talk to can tell who's calling. */
export const USER_AGENT = `Focus Screen/${app.getVersion()} (desktop app)`

export interface FetchOptions {
  maxBytes: number
  timeoutMs: number
  /** Never kept in the disk cache: the weather's address holds where the Mac is. */
  noStore?: boolean
}

export interface JsonResponse {
  status: number
  /** null when the body isn't JSON (or is too big). */
  body: unknown
  /** From a Retry-After header in seconds, when there is one. */
  retryAfterSec: number | null
  /** The `rel="next"` page from a Link header (Canvas pages this way), exactly as sent. */
  next?: string
}

/** A request to an API that takes a token, e.g. Google Tasks or Canvas. */
export interface JsonRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT'
  headers?: Record<string, string>
  body?: string
}

/** The response and its body, or a null body when it's larger than `maxBytes`. */
async function fetchLimited(
  url: string,
  { maxBytes, timeoutMs, noStore }: FetchOptions,
  accept?: string,
  request?: JsonRequest
): Promise<{ response: Response; bytes: Uint8Array | null }> {
  const response = await net.fetch(url, {
    method: request?.method ?? 'GET',
    headers: {
      ...request?.headers,
      'User-Agent': USER_AGENT,
      ...(accept ? { Accept: accept } : {})
    },
    body: request?.body,
    signal: AbortSignal.timeout(timeoutMs),
    // No cookies or other stored credentials go along.
    credentials: 'omit',
    ...(noStore ? { cache: 'no-store' as const } : {}),
    // An Authorization header must never follow a redirect somewhere else.
    redirect: request ? 'error' : 'follow'
  })
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel()
    return { response, bytes: null }
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  return { response, bytes: bytes.byteLength <= maxBytes ? bytes : null }
}

/**
 * GETs a URL from the main process (the renderer never touches the network). Null on any
 * failure or when the response is larger than `maxBytes`; callers treat that as "no data".
 */
export async function fetchBytes(url: string, options: FetchOptions): Promise<Uint8Array | null> {
  const { response, bytes } = await fetchLimited(url, options)
  return response.ok ? bytes : null
}

/** GETs bytes with the status, e.g. a feed whose 403 means "look its address up again". */
export async function fetchBinary(
  url: string,
  options: FetchOptions
): Promise<{ status: number; bytes: Uint8Array | null }> {
  const { response, bytes } = await fetchLimited(url, options)
  return { status: response.status, bytes }
}

/** GETs JSON. Rejects only when the network fails; the caller decides what each status means. */
export async function fetchJson(url: string, options: FetchOptions): Promise<JsonResponse> {
  return toJsonResponse(await fetchLimited(url, options, 'application/json'))
}

/** GETs text (a calendar feed). Like fetchJson, rejects only when the network fails. */
export async function fetchText(
  url: string,
  options: FetchOptions
): Promise<{ status: number; text: string | null }> {
  const { response, bytes } = await fetchLimited(url, options)
  return { status: response.status, text: bytes ? new TextDecoder().decode(bytes) : null }
}

/** Sends a request and reads a JSON answer. Like fetchJson, rejects only on network failure. */
export async function requestJson(
  url: string,
  request: JsonRequest,
  options: FetchOptions
): Promise<JsonResponse> {
  return toJsonResponse(await fetchLimited(url, options, 'application/json', request))
}

function toJsonResponse({
  response,
  bytes
}: {
  response: Response
  bytes: Uint8Array | null
}): JsonResponse {
  let body: unknown = null
  if (bytes) {
    try {
      // Canvas guards some JSON against old browser hijacking tricks with this prefix.
      body = JSON.parse(new TextDecoder().decode(bytes).replace(/^while\(1\);/, ''))
    } catch {
      body = null
    }
  }
  // Only the seconds form; an HTTP date falls back to the caller's default wait.
  const retryAfter = response.headers.get('retry-after')
  const seconds = retryAfter && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) : null
  const next = nextLink(response.headers.get('link'))
  return { status: response.status, body, retryAfterSec: seconds, ...(next ? { next } : {}) }
}
