import { MAX_COURSE_CHARS, courseKey } from './shared'

const tidy = (course: string): string => course.trim().replace(/\s+/g, ' ')

/**
 * The form's class chips: the class calendars' event titles (just course codes, "BIO 181", for
 * the user), then the classes saved homework uses, so the chips stay over a week off. One per
 * class, the calendar's spelling first, in course order ("MAT 99" before "MAT 265").
 */
export function classChoices(
  calendarTitles: readonly string[],
  saved: readonly string[]
): string[] {
  const chips = new Map<string, string>()
  for (const raw of [...calendarTitles, ...saved]) {
    const course = tidy(raw)
    if (!course || course.length > MAX_COURSE_CHARS) continue
    const key = courseKey(course)
    if (!chips.has(key)) chips.set(key, course)
  }
  return [...chips.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}
