import { describe, expect, it } from 'vitest'
import {
  calendarPageUrl,
  cleanToken,
  displayAddress,
  parseCanvasAddress,
  parseFeedUrl,
  tokenPageUrl
} from './site'

const origin = (input: string): string | null => {
  const result = parseCanvasAddress(input)
  return result.ok ? result.origin : null
}

describe('parseCanvasAddress', () => {
  it('takes the address however it was copied', () => {
    expect(origin('canvas.school.edu')).toBe('https://canvas.school.edu')
    expect(origin('  https://canvas.school.edu/  ')).toBe('https://canvas.school.edu')
    expect(origin('https://canvas.school.edu/courses/12/assignments?x=1')).toBe(
      'https://canvas.school.edu'
    )
    expect(origin('school.instructure.com:8443')).toBe('https://school.instructure.com:8443')
  })

  it('never sends the token over plain http', () => {
    expect(origin('http://canvas.school.edu')).toBe('https://canvas.school.edu')
  })

  it('turns down what can’t be a Canvas site', () => {
    expect(origin('')).toBeNull()
    expect(origin('canvas')).toBeNull()
    expect(origin('localhost')).toBeNull()
    expect(origin('ftp://canvas.school.edu')).toBeNull()
    expect(origin('https://me:pw@canvas.school.edu')).toBeNull()
    expect(origin('not a url at all')).toBeNull()
    expect(origin(`${'a'.repeat(300)}.edu`)).toBeNull()
  })

  it('explains what to type', () => {
    expect(parseCanvasAddress('canvas')).toEqual({
      ok: false,
      message: 'Type the address you see in your browser on Canvas, like canvas.school.edu.'
    })
  })
})

describe('displayAddress', () => {
  it('shows the host the way the user typed it', () => {
    expect(displayAddress('https://canvas.school.edu')).toBe('canvas.school.edu')
    expect(displayAddress('https://canvas.school.edu:8443')).toBe('canvas.school.edu:8443')
    expect(displayAddress('nonsense')).toBe('')
  })
})

describe('cleanToken', () => {
  it('trims a pasted token', () => {
    expect(cleanToken(`  1234~${'a'.repeat(64)}\n`)).toBe(`1234~${'a'.repeat(64)}`)
  })

  it('turns down junk', () => {
    expect(cleanToken('')).toBeNull()
    expect(cleanToken('short')).toBeNull()
    expect(cleanToken('has a space in the middle of it')).toBeNull()
    expect(cleanToken('x'.repeat(513))).toBeNull()
  })
})

describe('parseFeedUrl', () => {
  const feed = 'https://canvas.school.edu/feeds/calendars/user_AbC123.ics'

  it('takes Canvas’s calendar feed link', () => {
    expect(parseFeedUrl(` ${feed} `)).toEqual({
      ok: true,
      url: feed,
      origin: 'https://canvas.school.edu'
    })
  })

  it('reads webcal:// and http:// as https', () => {
    expect(parseFeedUrl(feed.replace('https:', 'webcal:'))).toMatchObject({ ok: true, url: feed })
    expect(parseFeedUrl(feed.replace('https:', 'http:'))).toMatchObject({ ok: true, url: feed })
  })

  it('turns down other links', () => {
    expect(parseFeedUrl('https://canvas.school.edu/calendar').ok).toBe(false)
    expect(parseFeedUrl('https://canvas.school.edu/feeds/calendars/user_1.txt').ok).toBe(false)
    expect(parseFeedUrl('canvas.school.edu/feeds/calendars/user_1.ics').ok).toBe(false)
    expect(parseFeedUrl('').ok).toBe(false)
  })
})

describe('help pages', () => {
  it('point at the user’s own Canvas', () => {
    expect(tokenPageUrl('https://canvas.school.edu')).toBe(
      'https://canvas.school.edu/profile/settings'
    )
    expect(calendarPageUrl('https://canvas.school.edu')).toBe('https://canvas.school.edu/calendar')
  })
})
