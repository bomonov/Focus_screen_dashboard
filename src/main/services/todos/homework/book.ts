import { randomUUID } from 'crypto'
import { readFileSync, rmSync } from 'fs'
import { writeJsonFile } from '../../jsonFile'
import { dueSortKey } from '../merge'
import type { HomeworkEntry, HomeworkInput } from '../types'
import {
  MAX_ENTRIES,
  examOver,
  homeworkFile,
  parseHomeworkFile,
  withoutEndedExams
} from './entries'
import { DONE_KEEP_SEC } from './shared'

export interface TickedHomework {
  entry: HomeworkEntry
  /** Epoch seconds. */
  doneAt: number
}

/**
 * The user's own homework and exams. The file holds only what's still to do: a tick takes a
 * homework off the disk at once (the user's condition for keeping class names there), and it
 * stays on screen, done, for an hour from memory, so an untick can save it back.
 */
export interface HomeworkBook {
  /** Open homework (from the file), then the ones ticked in the last hour (memory only). */
  homework(): { open: HomeworkEntry[]; ticked: TickedHomework[] }
  /** Exams not over yet, soonest first. */
  exams(): HomeworkEntry[]
  /** The courses saved entries use, for the class chips. */
  courses(): string[]
  /** Open homework, exams, and the ticked ones of the last hour. */
  find(id: string): { entry: HomeworkEntry; ticked: boolean } | null
  /** null when the list is full. */
  add(input: HomeworkInput): HomeworkEntry | null
  /** Open homework and exams only. */
  edit(id: string, input: HomeworkInput): boolean
  remove(id: string): boolean
  setDone(id: string, done: boolean): boolean
  /** Drops ended exams and ticked homework past the hour; true when anything went. */
  prune(): boolean
  subscribe(listener: () => void): () => void
}

export interface HomeworkBookOptions {
  filePath: string
  /** Epoch seconds; injectable for tests. */
  now?: () => number
  makeId?: () => string
}

function load(filePath: string): HomeworkEntry[] {
  try {
    return parseHomeworkFile(JSON.parse(readFileSync(filePath, 'utf8')))
  } catch {
    // Missing until the first homework; a broken file only loses what was in it.
    return []
  }
}

export function openHomeworkBook({
  filePath,
  now = () => Date.now() / 1000,
  makeId = randomUUID
}: HomeworkBookOptions): HomeworkBook {
  const loaded = load(filePath)
  let entries = withoutEndedExams(loaded, now())
  const ticked = new Map<string, TickedHomework>()
  const listeners = new Set<() => void>()

  function save(): void {
    try {
      if (entries.length === 0) rmSync(filePath, { force: true })
      else writeJsonFile(filePath, homeworkFile(entries))
    } catch (error) {
      // The error names the file, never the homework: titles and classes stay out of logs.
      console.warn('[todos] Could not save your homework.', error)
    }
  }

  function changed(): void {
    save()
    for (const listener of listeners) listener()
  }

  if (entries.length !== loaded.length) save()

  return {
    homework() {
      return {
        open: entries.filter((entry) => entry.kind === 'homework'),
        ticked: [...ticked.values()]
      }
    },
    exams() {
      const at = now()
      return entries
        .filter((entry) => entry.kind === 'exam' && !examOver(entry.due, at))
        .sort((a, b) => dueSortKey(a.due) - dueSortKey(b.due))
    },
    courses() {
      const courses = new Set<string>()
      for (const entry of [...entries, ...[...ticked.values()].map((done) => done.entry)]) {
        if (entry.course) courses.add(entry.course)
      }
      return [...courses]
    },
    find(id) {
      const entry = entries.find((candidate) => candidate.id === id)
      if (entry) return { entry, ticked: false }
      const done = ticked.get(id)
      return done ? { entry: done.entry, ticked: true } : null
    },
    add(input) {
      if (entries.length >= MAX_ENTRIES) return null
      const entry: HomeworkEntry = { id: makeId(), ...input }
      entries = [...entries, entry]
      changed()
      return entry
    },
    edit(id, input) {
      const index = entries.findIndex((entry) => entry.id === id)
      if (index < 0) return false
      entries = entries.map((entry, i) => (i === index ? { id, ...input } : entry))
      changed()
      return true
    },
    remove(id) {
      const wasTicked = ticked.delete(id)
      const before = entries.length
      entries = entries.filter((entry) => entry.id !== id)
      if (!wasTicked && entries.length === before) return false
      changed()
      return true
    },
    setDone(id, done) {
      if (done) {
        if (ticked.has(id)) return true
        const entry = entries.find(
          (candidate) => candidate.id === id && candidate.kind === 'homework'
        )
        if (!entry) return false
        entries = entries.filter((candidate) => candidate !== entry)
        ticked.set(id, { entry, doneAt: now() })
        changed()
        return true
      }
      if (entries.some((entry) => entry.id === id)) return true
      const back = ticked.get(id)
      if (!back || entries.length >= MAX_ENTRIES) return false
      ticked.delete(id)
      entries = [...entries, back.entry]
      changed()
      return true
    },
    prune() {
      const at = now()
      let gone = false
      for (const [id, done] of ticked) {
        if (at - done.doneAt >= DONE_KEEP_SEC) {
          ticked.delete(id)
          gone = true
        }
      }
      const kept = withoutEndedExams(entries, at)
      if (kept.length !== entries.length) {
        entries = kept
        gone = true
      }
      if (gone) changed()
      return gone
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
