import { describe, expect, it } from 'vitest'
import {
  apiError,
  courseLabel,
  isShown,
  itemLabel,
  localDayStart,
  newOverrideBody,
  overrideBody,
  parseCoursesPage,
  parsePlannerItem,
  parsePlannerPage,
  plannerItemsUrl,
  toProviderTodo,
  trackCompletions,
  type PlannerItem
} from './api'

const ORIGIN = 'https://canvas.school.edu'
// Wednesday, October 14, 2026, 3:00 PM local time.
const NOW = new Date(2026, 9, 14, 15, 0).getTime() / 1000
const MIDNIGHT = new Date(2026, 9, 14).getTime() / 1000
const TOMORROW = new Date(2026, 9, 15).getTime() / 1000

/** A planner item as Canvas sends it (trimmed to the fields we read). */
function apiItem(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    context_type: 'Course',
    course_id: 101,
    plannable_id: 5001,
    planner_override: null,
    plannable_type: 'assignment',
    new_activity: false,
    submissions: {
      submitted: false,
      excused: false,
      graded: false,
      late: false,
      missing: false,
      needs_grading: false,
      has_feedback: false,
      redo_request: false
    },
    plannable_date: '2026-10-15T06:59:59Z',
    plannable: {
      id: 5001,
      title: 'Lab report draft',
      course_id: 101,
      due_at: '2026-10-15T06:59:59Z',
      points_possible: 20
    },
    html_url: '/courses/101/assignments/5001',
    context_name: 'BIO 181: General Biology I (2026 Fall)',
    ...changes
  }
}

function item(changes: Partial<PlannerItem> = {}): PlannerItem {
  return {
    key: 'assignment:1',
    title: 'Essay',
    courseId: '101',
    contextName: null,
    dueAt: NOW + 3600,
    done: false,
    override: null,
    target: { type: 'assignment', id: '1' },
    ...changes
  }
}

describe('plannerItemsUrl', () => {
  it('asks for a window of dates, 100 at a time', () => {
    const url = new URL(plannerItemsUrl(ORIGIN, MIDNIGHT, TOMORROW))
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/api/v1/planner/items`)
    expect(url.searchParams.get('start_date')).toBe(new Date(MIDNIGHT * 1000).toISOString())
    expect(url.searchParams.get('end_date')).toBe(new Date(TOMORROW * 1000).toISOString())
    expect(url.searchParams.get('per_page')).toBe('100')
  })
})

describe('parsePlannerItem', () => {
  it('reads an assignment', () => {
    expect(parsePlannerItem(apiItem())).toEqual({
      key: 'assignment:5001',
      title: 'Lab report draft',
      courseId: '101',
      contextName: 'BIO 181: General Biology I (2026 Fall)',
      dueAt: Date.parse('2026-10-15T06:59:59Z') / 1000,
      done: false,
      override: null,
      target: { type: 'assignment', id: '5001' }
    })
  })

  it('follows the planner’s rule for done', () => {
    const submitted = { submitted: true, redo_request: false }
    expect(parsePlannerItem(apiItem({ submissions: submitted }))?.done).toBe(true)
    // The teacher asked for it again.
    expect(
      parsePlannerItem(apiItem({ submissions: { submitted: true, redo_request: true } }))?.done
    ).toBe(false)
    // A check-off in the planner wins over the submission, both ways.
    const override = (markedComplete: boolean): Record<string, unknown> => ({
      id: 77,
      plannable_type: 'Assignment',
      plannable_id: 5001,
      marked_complete: markedComplete,
      dismissed: false,
      updated_at: '2026-10-14T20:00:00Z'
    })
    expect(parsePlannerItem(apiItem({ planner_override: override(true) }))?.done).toBe(true)
    expect(
      parsePlannerItem(apiItem({ submissions: submitted, planner_override: override(false) }))?.done
    ).toBe(false)
    expect(parsePlannerItem(apiItem({ planner_override: override(true) }))?.override).toEqual({
      id: '77',
      markedComplete: true,
      updatedAt: Date.parse('2026-10-14T20:00:00Z') / 1000
    })
  })

  it('reads peer reviews and planner notes', () => {
    const review = parsePlannerItem(
      apiItem({
        plannable_type: 'assessment_request',
        submissions: false,
        plannable: { id: 9, title: 'Peer review: Essay 1', workflow_state: 'completed' }
      })
    )
    expect(review).toMatchObject({ key: 'assessment_request:9', done: true })
    const note = parsePlannerItem(
      apiItem({
        plannable_type: 'planner_note',
        context_type: 'User',
        course_id: undefined,
        context_name: undefined,
        submissions: false,
        plannable: { id: 3, title: 'Study group', todo_date: '2026-10-15T01:00:00Z' }
      })
    )
    expect(note).toMatchObject({ key: 'planner_note:3', courseId: null, done: false })
  })

  it('checks off graded quizzes and discussions through their assignment', () => {
    const quiz = parsePlannerItem(
      apiItem({
        plannable_type: 'quiz',
        plannable_id: 44,
        plannable: { id: 44, title: 'Quiz 3', assignment_id: 5050, course_id: 101 }
      })
    )
    expect(quiz).toMatchObject({ key: 'quiz:44', target: { type: 'assignment', id: '5050' } })
    const page = parsePlannerItem(
      apiItem({
        plannable_type: 'wiki_page',
        submissions: false,
        plannable: { page_id: 12, title: 'Read before class', todo_date: '2026-10-15T01:00:00Z' }
      })
    )
    expect(page).toMatchObject({ key: 'wiki_page:12', target: { type: 'wiki_page', id: '12' } })
  })

  it('skips class meetings, announcements and off-shape entries', () => {
    expect(parsePlannerItem(apiItem({ plannable_type: 'calendar_event' }))).toBeNull()
    expect(parsePlannerItem(apiItem({ plannable_type: 'announcement' }))).toBeNull()
    expect(parsePlannerItem(apiItem({ plannable: { id: 1, title: '   ' } }))).toBeNull()
    expect(parsePlannerItem(apiItem({ plannable: { id: -1, title: 'x' } }))?.key).toBe(
      'assignment:5001'
    )
    expect(parsePlannerItem(apiItem({ plannable_type: 'Weird Type' }))).toBeNull()
    expect(parsePlannerItem('nope')).toBeNull()
  })

  it('reads a page, dropping what it can’t use', () => {
    expect(parsePlannerPage([apiItem(), { junk: true }])).toHaveLength(1)
    expect(parsePlannerPage({ errors: [] })).toBeNull()
  })
})

describe('courseLabel', () => {
  it('finds the subject and number', () => {
    expect(courseLabel('BIO 181')).toBe('BIO 181')
    expect(courseLabel('CSE110')).toBe('CSE 110')
    expect(courseLabel('2026Fall-T-MAT265-70345')).toBe('MAT 265')
    expect(courseLabel('CHM 113L')).toBe('CHM 113L')
    expect(courseLabel('Fall 2026', 'ENG 102: First-Year Composition')).toBe('ENG 102')
  })

  it('doesn’t take a term for a course', () => {
    expect(courseLabel('FALL 2026 Orientation')).toBe('FALL 2026 Orientation')
  })

  it('shows other codes as they are, kept short', () => {
    expect(courseLabel('Advising')).toBe('Advising')
    expect(courseLabel('A very long course code that goes on')).toBe('A very long course code…')
    expect(courseLabel('', '')).toBeNull()
  })
})

describe('parseCoursesPage', () => {
  it('maps course ids to short codes', () => {
    expect(
      parseCoursesPage([
        { id: 101, name: 'General Biology I', course_code: 'BIO 181' },
        { id: '102', name: 'CHM 113: General Chemistry', course_code: '' },
        { id: 'x', course_code: 'MAT 265' }
      ])
    ).toEqual([
      { id: '101', label: 'BIO 181' },
      { id: '102', label: 'CHM 113' }
    ])
  })
})

describe('itemLabel', () => {
  it('prefers the course list, then the course’s name', () => {
    const labels = new Map([['101', 'BIO 181']])
    expect(itemLabel(item(), labels)).toBe('BIO 181')
    expect(itemLabel(item({ courseId: '9', contextName: 'MAT 265 (Fall)' }), labels)).toBe(
      'MAT 265'
    )
    expect(itemLabel(item({ courseId: null }), labels)).toBeNull()
  })
})

describe('trackCompletions', () => {
  it('dates planner check-offs, and submissions it saw happen', () => {
    const open = item()
    const checked = item({
      key: 'assignment:2',
      done: true,
      override: { id: '7', markedComplete: true, updatedAt: NOW - 60 }
    })
    const first = trackCompletions([open, checked], new Map(), NOW)
    expect(first.get('assignment:1')).toEqual({ done: false, at: null })
    expect(first.get('assignment:2')).toEqual({ done: true, at: NOW - 60 })

    // Submitted in Canvas between two lists.
    const second = trackCompletions([{ ...open, done: true }], first, NOW + 300)
    expect(second.get('assignment:1')).toEqual({ done: true, at: NOW + 300 })
    // Stays dated, and items that left the list are forgotten.
    const third = trackCompletions([{ ...open, done: true }], second, NOW + 600)
    expect(third.get('assignment:1')).toEqual({ done: true, at: NOW + 300 })
    expect(third.has('assignment:2')).toBe(false)
  })

  it('leaves work that was already done undated', () => {
    expect(trackCompletions([item({ done: true })], new Map(), NOW).get('assignment:1')).toEqual({
      done: true,
      at: null
    })
  })
})

describe('isShown', () => {
  const today = { start: MIDNIGHT, end: TOMORROW }

  it('shows open work, and done work from today', () => {
    expect(isShown({ done: false, dueAt: NOW - 86_400 * 3 }, null, today)).toBe(true)
    expect(isShown({ done: true, dueAt: NOW + 86_400 * 3 }, NOW - 60, today)).toBe(true)
    expect(isShown({ done: true, dueAt: TOMORROW - 60 }, null, today)).toBe(true)
  })

  it('hides done work from before today', () => {
    expect(isShown({ done: true, dueAt: NOW + 86_400 * 3 }, MIDNIGHT - 60, today)).toBe(false)
    expect(isShown({ done: true, dueAt: NOW + 86_400 * 3 }, null, today)).toBe(false)
    expect(isShown({ done: true, dueAt: null }, null, today)).toBe(false)
  })
})

describe('toProviderTodo', () => {
  it('reads like the mockup', () => {
    expect(toProviderTodo(item(), 'BIO 181', null)).toEqual({
      id: 'assignment:1',
      title: 'Essay',
      context: 'Canvas · BIO 181',
      due: { kind: 'time', at: NOW + 3600 },
      done: false,
      completedAt: null
    })
    expect(toProviderTodo(item({ dueAt: null }), null, null)).toMatchObject({
      context: 'Canvas',
      due: null
    })
  })
})

describe('override bodies', () => {
  it('create and update planner overrides', () => {
    expect(JSON.parse(newOverrideBody({ type: 'quiz', id: '44' }, true))).toEqual({
      plannable_type: 'quiz',
      plannable_id: '44',
      marked_complete: true
    })
    expect(JSON.parse(overrideBody(false))).toEqual({ marked_complete: false })
  })
})

describe('apiError', () => {
  it('asks for a new token when Canvas stops accepting it', () => {
    expect(apiError(401, { errors: [{ message: 'Invalid access token.' }] }, 'read').kind).toBe(
      'reconnect'
    )
  })

  it('tells throttling from a real refusal', () => {
    expect(apiError(403, null, 'read')).toMatchObject({
      kind: 'offline',
      message: 'Canvas asked Focus Screen to slow down. Trying again soon.'
    })
    expect(apiError(403, { errors: [{ message: 'unauthorized' }] }, 'read').kind).toBe('setup')
    // One refused check-off isn't a problem with the whole connection.
    expect(apiError(403, { errors: [] }, 'write').kind).toBe('offline')
    expect(apiError(429, null, 'read').kind).toBe('offline')
  })

  it('words the rest', () => {
    expect(apiError(404, null, 'write').message).toBe('It’s no longer in Canvas.')
    expect(apiError(503, null, 'read').message).toBe('Canvas is having trouble. Trying again soon.')
    expect(apiError(400, null, 'write').message).toBe('Canvas said no (error 400).')
  })
})

describe('localDayStart', () => {
  it('counts calendar days, not 24-hour blocks', () => {
    expect(localDayStart(NOW, 0)).toBe(MIDNIGHT)
    expect(localDayStart(NOW, 1)).toBe(TOMORROW)
    expect(localDayStart(NOW, -14)).toBe(new Date(2026, 8, 30).getTime() / 1000)
  })
})
