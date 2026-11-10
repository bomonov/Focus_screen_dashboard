import { describe, expect, it } from 'vitest'
import { feedTodos, parseIcs, splitSummary } from './ics'

/** Shaped like Canvas's own feed (app/models/calendar_event.rb), with CRLF line ends. */
const FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:icalendar-ruby',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'X-WR-CALNAME:Student Calendar (School)',
  'BEGIN:VEVENT',
  'DTSTAMP:20261001T120000Z',
  'UID:event-assignment-5001',
  'DTSTART;VALUE=DATE-TIME:20261015T065900Z',
  'DTEND;VALUE=DATE-TIME:20261015T065900Z',
  'CLASS:PUBLIC',
  'DESCRIPTION:Write the draft\\, then submit it.',
  'SEQUENCE:0',
  'SUMMARY:Lab report draft\\, part 1 [CHM 113]',
  'URL;VALUE=URI:https://canvas.school.edu/calendar?include_contexts=course_1',
  ' 02&month=10&year=2026#assignment_5001',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'SUMMARY:Not the event’s summary',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-calendar-event-900',
  'DTSTART:20261015T170000Z',
  'SUMMARY:Lecture [CHM 113]',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-assignment-override-77',
  'DTSTART;VALUE=DATE:20261016',
  'SUMMARY:Problem set 6 (Section 2) [2026Fall-T-MAT265-70345]',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-assignment-6000',
  'DTSTART;TZID=UTC:20261201T065900',
  'SUMMARY:Final project [ENG 102]',
  'END:VEVENT',
  'END:VCALENDAR',
  ''
].join('\r\n')

describe('parseIcs', () => {
  it('reads events, unfolding long lines and skipping alarms', () => {
    const events = parseIcs(FEED)
    expect(events).toEqual([
      {
        uid: 'event-assignment-5001',
        summary: 'Lab report draft, part 1 [CHM 113]',
        start: { kind: 'time', at: Date.UTC(2026, 9, 15, 6, 59) / 1000 }
      },
      {
        uid: 'event-calendar-event-900',
        summary: 'Lecture [CHM 113]',
        start: { kind: 'time', at: Date.UTC(2026, 9, 15, 17, 0) / 1000 }
      },
      {
        uid: 'event-assignment-override-77',
        summary: 'Problem set 6 (Section 2) [2026Fall-T-MAT265-70345]',
        start: { kind: 'day', day: '2026-10-16' }
      },
      {
        uid: 'event-assignment-6000',
        summary: 'Final project [ENG 102]',
        start: { kind: 'time', at: Date.UTC(2026, 11, 1, 6, 59) / 1000 }
      }
    ])
  })

  it('reads plain \\n line ends and a floating time as local', () => {
    const text =
      'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nSUMMARY:A\nDTSTART:20261015T090000\nEND:VEVENT\nEND:VCALENDAR'
    expect(parseIcs(text)?.[0]?.start).toEqual({
      kind: 'time',
      at: new Date(2026, 9, 15, 9).getTime() / 1000
    })
  })

  it('is null for something that isn’t a calendar', () => {
    expect(parseIcs('<html>Log in to Canvas</html>')).toBeNull()
    expect(parseIcs('')).toBeNull()
  })

  it('drops events without a UID or a summary', () => {
    const text = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:No id\nEND:VEVENT\nEND:VCALENDAR'
    expect(parseIcs(text)).toEqual([])
  })
})

describe('splitSummary', () => {
  it('takes the course code off the end', () => {
    expect(splitSummary('Essay 2 [ENG 102]')).toEqual({ title: 'Essay 2', course: 'ENG 102' })
    expect(splitSummary('Reading [week 3] notes')).toEqual({
      title: 'Reading [week 3] notes',
      course: null
    })
    expect(splitSummary('[ENG 102]')).toEqual({ title: '[ENG 102]', course: null })
  })
})

describe('feedTodos', () => {
  const events = parseIcs(FEED) ?? []
  const window = {
    start: new Date(2026, 9, 1).getTime() / 1000,
    end: new Date(2026, 10, 12).getTime() / 1000
  }

  it('lists the assignments due in the window, soonest first', () => {
    const todos = feedTodos(events, window, () => undefined)
    expect(todos).toEqual([
      {
        id: 'event-assignment-5001',
        title: 'Lab report draft, part 1',
        context: 'Canvas · CHM 113',
        due: { kind: 'time', at: Date.UTC(2026, 9, 15, 6, 59) / 1000 },
        done: false,
        completedAt: null
      },
      {
        id: 'event-assignment-override-77',
        title: 'Problem set 6 (Section 2)',
        context: 'Canvas · MAT 265',
        due: { kind: 'day', day: '2026-10-16' },
        done: false,
        completedAt: null
      }
    ])
  })

  it('marks what was checked off on this computer', () => {
    const todos = feedTodos(events, window, (uid) =>
      uid === 'event-assignment-5001' ? 1234 : undefined
    )
    expect(todos[0]).toMatchObject({ done: true, completedAt: 1234 })
  })
})
