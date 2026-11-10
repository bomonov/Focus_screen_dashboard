// The romaji maker runs in a process of its own (worker.ts): kuromoji's dictionary holds about
// 400 MB once loaded, which the app would otherwise keep for good. It's started when a song needs
// romaji VocaDB hasn't got, and stopped once it sits idle, which gives all of it back.
import type { MakerReply, MakerRequest, ReadingEntries } from './messages'
import type { Romanization } from './maker'

/** The maker's process, as `utilityProcess.fork` gives it (wrapped, so tests can fake it). */
export interface MakerProcess {
  postMessage(message: MakerRequest): void
  onMessage(listener: (message: unknown) => void): void
  onExit(listener: () => void): void
  kill(): void
}

export interface RomajiMaker {
  /** Romaji for each line ('' for one with no Japanese, null for one it can't read), or null. */
  make(lines: readonly string[]): Promise<(string | null)[] | null>
  dispose(): void
}

/** The readings learned last time, and the `stamp` of the VocaDB romaji they were learned from. */
export interface LearnedStore {
  read(): { stamp: string; readings: ReadingEntries } | null
  write(stamp: string, readings: ReadingEntries): void
}

export interface RomajiMakerOptions {
  start(): MakerProcess
  /**
   * What it learns readings from: the VocaDB romaji saved so far. Pairing every song's lines with
   * their romaji takes seconds (6 s for 221 songs), so what's learned is kept, and learned again
   * only once more is saved, after the song at hand.
   */
  learning: {
    /** Changes whenever VocaDB romaji is saved. */
    stamp(): string
    songs(): Romanization[]
    saved: LearnedStore
  }
  /** Songs a few minutes apart start it again; reading the dictionary takes about 0.2 s. */
  idleMs?: number
  timeoutMs?: number
  /** Learning from a large library takes a while (6 s for 221 songs here, more on a slower Mac). */
  learnTimeoutMs?: number
}

const IDLE_MS = 60_000
const TIMEOUT_MS = 30_000
const LEARN_TIMEOUT_MS = 180_000
const MAX_LINE_CHARS = 2000
const MAX_READINGS = 10_000
const MAX_READING_CHARS = 300

interface Pending {
  lines: number
  resolve(romaji: (string | null)[] | null): void
  timer: ReturnType<typeof setTimeout>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The process's answer, checked like anything from outside: one entry per line asked about. One
 * that names its request but isn't right counts as that request failing.
 */
function parseReply(raw: unknown): MakerReply | null {
  if (isRecord(raw) && raw.kind === 'learned') {
    const readings = parseReadings(raw.readings)
    return readings && { kind: 'learned', readings }
  }
  if (isRecord(raw) && raw.kind === 'learnFailed') return { kind: 'learnFailed' }
  if (!isRecord(raw) || typeof raw.id !== 'number') return null
  const failed: MakerReply = { kind: 'failed', id: raw.id }
  const { romaji } = raw
  if (raw.kind !== 'made' || !Array.isArray(romaji)) return failed
  const lines: (string | null)[] = []
  for (const line of romaji as unknown[]) {
    if (line !== null && typeof line !== 'string') return failed
    // Lyrics with no line breaks: that line goes without, not the whole song.
    lines.push(line !== null && line.length > MAX_LINE_CHARS ? null : line)
  }
  return { kind: 'made', id: raw.id, romaji: lines }
}

/** Learned readings as sent back or saved, checked: [key, reading] pairs of short strings. */
export function parseReadings(raw: unknown): ReadingEntries | null {
  if (!Array.isArray(raw) || raw.length > MAX_READINGS) return null
  const out: ReadingEntries = []
  for (const entry of raw as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 2) return null
    const [key, reading] = entry as unknown[]
    if (typeof key !== 'string' || typeof reading !== 'string') return null
    if (key.length > MAX_READING_CHARS || reading.length > MAX_READING_CHARS) return null
    out.push([key, reading])
  }
  return out
}

export function createRomajiMaker({
  start,
  learning,
  idleMs = IDLE_MS,
  timeoutMs = TIMEOUT_MS,
  learnTimeoutMs = LEARN_TIMEOUT_MS
}: RomajiMakerOptions): RomajiMaker {
  let current: MakerProcess | null = null
  let nextId = 1
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const pending = new Map<number, Pending>()
  /** The stamp to learn again for, after the song at hand; null when what was learned is current. */
  let relearn: string | null = null
  /** The stamp of what the process is learning from, for keeping what it sends back. */
  let learningFor: string | null = null
  let learnTimer: ReturnType<typeof setTimeout> | undefined

  /** Stopped once nothing's asked of it, nor being learned: that gives the dictionary's memory back. */
  function idleLater(): void {
    clearTimeout(idleTimer)
    if (current && pending.size === 0 && learningFor === null) idleTimer = setTimeout(stop, idleMs)
  }

  function doneLearning(): void {
    learningFor = null
    clearTimeout(learnTimer)
    idleLater()
  }

  function settle(id: number, romaji: (string | null)[] | null): void {
    const waiting = pending.get(id)
    if (!waiting) return
    pending.delete(id)
    clearTimeout(waiting.timer)
    waiting.resolve(romaji && romaji.length === waiting.lines ? romaji : null)
    idleLater()
  }

  function stop(): void {
    const running = current
    current = null
    clearTimeout(idleTimer)
    learningFor = null
    clearTimeout(learnTimer)
    for (const id of [...pending.keys()]) settle(id, null)
    running?.kill()
  }

  function processFor(): MakerProcess | null {
    if (current) return current
    let started: MakerProcess
    try {
      started = start()
    } catch (error) {
      console.warn('[lyrics] Could not start the romaji maker.', error)
      return null
    }
    current = started
    started.onMessage((raw) => {
      // A process that was stopped may still be finishing something: none of it counts.
      if (current !== started) return
      const reply = parseReply(raw)
      if (reply?.kind === 'learned') {
        if (learningFor !== null) learning.saved.write(learningFor, reply.readings)
        doneLearning()
      } else if (reply?.kind === 'learnFailed') {
        doneLearning()
      } else if (reply) settle(reply.id, reply.kind === 'made' ? reply.romaji : null)
    })
    started.onExit(() => {
      if (current !== started) return
      current = null
      clearTimeout(idleTimer)
      learningFor = null
      clearTimeout(learnTimer)
      for (const id of [...pending.keys()]) settle(id, null)
    })
    const stamp = learning.stamp()
    const before = learning.saved.read()
    relearn = null
    if (before) {
      started.postMessage({ kind: 'readings', readings: before.readings })
      if (before.stamp !== stamp) relearn = stamp
    } else {
      // Nothing learned yet: once, the first song waits for it.
      learn(started, stamp)
    }
    return started
  }

  function learn(target: MakerProcess, stamp: string): void {
    learningFor = stamp
    clearTimeout(learnTimer)
    learnTimer = setTimeout(stop, learnTimeoutMs)
    target.postMessage({ kind: 'learn', songs: learning.songs() })
  }

  return {
    make(lines) {
      if (disposed) return Promise.resolve(null)
      clearTimeout(idleTimer)
      const target = processFor()
      if (!target) return Promise.resolve(null)
      const id = nextId++
      // Asked while it's learning: it gets to this song once that's done.
      const wait = timeoutMs + (learningFor === null ? 0 : learnTimeoutMs)
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          settle(id, null)
          // Stuck: a fresh one is started next time.
          stop()
        }, wait)
        pending.set(id, { lines: lines.length, resolve, timer })
        target.postMessage({ kind: 'make', id, lines: [...lines] })
        if (relearn !== null) {
          learn(target, relearn)
          relearn = null
        }
      })
    },
    dispose() {
      disposed = true
      stop()
    }
  }
}
