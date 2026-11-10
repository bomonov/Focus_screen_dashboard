import type { HelperProcess } from '../helperProcess'
import { parseWords, type AlignLanguage, type TimedLine } from './lines'

/** Starts the Python worker (native/aligner/aligner.py). */
export type StartAligner = (handlers: {
  onMessage(message: unknown): void
  onExit(): void
}) => HelperProcess

export type AlignResult = { ok: true; lines: TimedLine[] } | { ok: false; error: string }

/** The model holds a couple of GB; let it go once nothing has needed it for a while. */
export const IDLE_STOP_MS = 180_000
/** Loading takes ~30 s and a long song well under a minute on Apple silicon; past this, give up. */
export const ALIGN_TIMEOUT_MS = 300_000
const MAX_LINES = 400

export interface AlignerClient {
  /** Starts the worker and loads the model now, so a song finishing soon isn't kept waiting. */
  prepare(): void
  align(wavPath: string, lines: string[], language: AlignLanguage | null): Promise<AlignResult>
  dispose(): void
}

type Reply =
  { id: number; ok: true; lines: TimedLine[] | null } | { id: number; ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSpan(raw: unknown): TimedLine | undefined {
  if (raw === null) return null
  if (!isRecord(raw)) return undefined
  const { start, end } = raw
  if (typeof start !== 'number' || typeof end !== 'number') return undefined
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined
  // Words that don't check out are dropped; the line keeps its span.
  const words = parseWords(raw.words)
  return words ? { start, end, words } : { start, end }
}

/** The worker's output is untrusted like any helper's: anything off-shape is no data. */
export function parseAlignerReply(raw: unknown): Reply | null {
  if (!isRecord(raw) || raw.type !== 'reply' || typeof raw.id !== 'number') return null
  if (raw.ok !== true) {
    return {
      id: raw.id,
      ok: false,
      error: typeof raw.error === 'string' ? raw.error.slice(0, 200) : 'failed'
    }
  }
  if (raw.lines === undefined) return { id: raw.id, ok: true, lines: null }
  if (!Array.isArray(raw.lines) || raw.lines.length > MAX_LINES) return null
  const lines = (raw.lines as unknown[]).map(parseSpan)
  if (lines.some((line) => line === undefined)) return null
  return { id: raw.id, ok: true, lines: lines as TimedLine[] }
}

interface Pending {
  resolve(reply: Reply): void
  timer: ReturnType<typeof setTimeout>
}

export function createAlignerClient(
  startAligner: StartAligner,
  { idleStopMs = IDLE_STOP_MS, timeoutMs = ALIGN_TIMEOUT_MS } = {}
): AlignerClient {
  let worker: HelperProcess | null = null
  let nextId = 1
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const pending = new Map<number, Pending>()

  function settle(id: number, reply: Reply): void {
    const request = pending.get(id)
    if (!request) return
    pending.delete(id)
    clearTimeout(request.timer)
    request.resolve(reply)
    scheduleIdleStop()
  }

  function scheduleIdleStop(): void {
    clearTimeout(idleTimer)
    if (pending.size > 0 || !worker) return
    idleTimer = setTimeout(() => {
      worker?.stop()
      worker = null
    }, idleStopMs)
  }

  function ensureWorker(): HelperProcess {
    clearTimeout(idleTimer)
    if (worker) return worker
    worker = startAligner({
      onMessage(raw) {
        const reply = parseAlignerReply(raw)
        if (reply) settle(reply.id, reply)
      },
      onExit() {
        for (const id of [...pending.keys()]) {
          settle(id, { id, ok: false, error: 'The aligner stopped.' })
        }
      }
    })
    return worker
  }

  function request(body: Record<string, unknown>): Promise<Reply> {
    const id = nextId++
    const target = ensureWorker()
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => settle(id, { id, ok: false, error: 'The aligner took too long.' }),
        timeoutMs
      )
      pending.set(id, { resolve, timer })
      if (!target.send({ ...body, id })) {
        settle(id, { id, ok: false, error: 'The aligner isn’t running.' })
      }
    })
  }

  return {
    prepare() {
      void request({ op: 'load' })
    },
    async align(wavPath, lines, language) {
      const reply = await request({ op: 'align', wav: wavPath, lines, language })
      if (!reply.ok) return { ok: false, error: reply.error }
      if (!reply.lines || reply.lines.length !== lines.length) {
        return { ok: false, error: 'The aligner answered for the wrong lines.' }
      }
      return { ok: true, lines: reply.lines }
    },
    dispose() {
      clearTimeout(idleTimer)
      for (const id of [...pending.keys()]) settle(id, { id, ok: false, error: 'Stopped.' })
      worker?.stop()
      worker = null
    }
  }
}
