// Homework rules the main process and the renderer share.
// Keep this file free of imports: the renderer compiles it too.

/** "Nearly due": today through this many days after it, by the calendar. */
export const DUE_SOON_DAYS = 3

/** A ticked homework stays on screen, done, this long; it's off the disk from the tick. */
export const DONE_KEEP_SEC = 3600

export const MAX_TITLE_CHARS = 200
export const MAX_COURSE_CHARS = 60

/**
 * The same class however it's spelled: "BIO 181", "bio  181". The chips come from calendar
 * titles, so a class saved weeks ago still has to find this week's events.
 */
export function courseKey(course: string): string {
  return course.trim().replace(/\s+/g, ' ').toLowerCase()
}
