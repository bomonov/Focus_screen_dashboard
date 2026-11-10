// What the user types into the Canvas form, checked before anything goes over the network.

const MAX_ADDRESS_CHARS = 300
const MAX_FEED_CHARS = 2000
/** Canvas tokens are "<number>~<64 letters and digits>"; this only rules out obvious junk. */
const TOKEN = /^[\x21-\x7e]{16,512}$/
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

export type AddressResult = { ok: true; origin: string } | { ok: false; message: string }
export type FeedResult = { ok: true; url: string; origin: string } | { ok: false; message: string }

const NOT_AN_ADDRESS = 'Type the address you see in your browser on Canvas, like canvas.school.edu.'

/**
 * "canvas.school.edu", "https://canvas.school.edu/courses/12" → "https://canvas.school.edu".
 * Plain http is upgraded: the token must never cross the network unencrypted.
 */
export function parseCanvasAddress(input: string): AddressResult {
  const text = input.trim()
  if (!text || text.length > MAX_ADDRESS_CHARS) return { ok: false, message: NOT_AN_ADDRESS }
  let url: URL
  try {
    url = new URL(SCHEME.test(text) ? text : `https://${text}`)
  } catch {
    return { ok: false, message: NOT_AN_ADDRESS }
  }
  if (url.protocol === 'http:') url.protocol = 'https:'
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) {
    return { ok: false, message: NOT_AN_ADDRESS }
  }
  return { ok: true, origin: url.origin }
}

/** "https://canvas.school.edu" → "canvas.school.edu", what the form shows. */
export function displayAddress(origin: string): string {
  try {
    const url = new URL(origin)
    return url.port ? url.host : url.hostname
  } catch {
    return ''
  }
}

/** A pasted token, trimmed; null when it can't be one. */
export function cleanToken(input: string): string | null {
  const token = input.trim()
  return TOKEN.test(token) ? token : null
}

const NOT_A_FEED =
  'That isn’t a Canvas calendar feed link. In Canvas, open Calendar and click Calendar Feed.'

/** The link from Canvas → Calendar → Calendar Feed: https://…/feeds/calendars/user_….ics */
export function parseFeedUrl(input: string): FeedResult {
  const text = input.trim()
  if (!text || text.length > MAX_FEED_CHARS) return { ok: false, message: NOT_A_FEED }
  let url: URL
  try {
    // Calendar apps hand these around as webcal://; it's the same https link.
    url = new URL(text.replace(/^webcals?:\/\//i, 'https://'))
  } catch {
    return { ok: false, message: NOT_A_FEED }
  }
  if (url.protocol === 'http:') url.protocol = 'https:'
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !url.hostname.includes('.') ||
    !/\/feeds\/calendars\/[^/]+\.ics$/i.test(url.pathname)
  ) {
    return { ok: false, message: NOT_A_FEED }
  }
  return { ok: true, url: url.toString(), origin: url.origin }
}

/** Account → Settings, where "+ New Access Token" is. */
export function tokenPageUrl(origin: string): string {
  return new URL('/profile/settings', origin).toString()
}

/** The calendar, whose sidebar has the Calendar Feed link. */
export function calendarPageUrl(origin: string): string {
  return new URL('/calendar', origin).toString()
}
