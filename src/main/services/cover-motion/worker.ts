import type { HelperProcess } from '../helperProcess'
import { ANALYSIS_PX, CUT_SIZES, MAX_PARTS, MAX_STROKES, type MotionKind } from './recipe'

/** Starts the Python worker (native/cover-motion/worker.py). */
export type StartCoverWorker = (handlers: {
  onMessage(message: unknown): void
  onExit(): void
}) => HelperProcess

/** Covers the first request too, which loads SAM (a few seconds, longer on a cold disk). */
export const SEGMENT_TIMEOUT_MS = 60_000
export const BUILD_TIMEOUT_MS = 60_000
/** SAM holds a few hundred MB; let it go once nothing has needed it for a while. */
export const IDLE_STOP_MS = 180_000
const MAX_EMITTERS = 200
const MAX_ERROR = 200

/** What the worker worked out for one part, all in the 768 px analysis space. */
export interface BuiltPart {
  move: [number, number]
  center: [number, number]
  emitters: [number, number][]
  color: [number, number, number]
}

export interface BuildRequest {
  cover: string
  parts: { mask: string; kind: MotionKind; turn: number; out: string }[]
  protected: string[]
  plate: string
}

/** One of a part's clicks for the worker: `size` null starts on its default cut. */
export interface CutStroke {
  point: [number, number]
  add: boolean
  size: number | null
}

export interface CutRequest {
  cover: string
  /** The mask the clicks go on top of (a part from before it kept its clicks), or none. */
  base: string | null
  strokes: CutStroke[]
  out: string
}

type Failed = { ok: false; error: string }
/** `sizes`: which of SAM's cuts each click used, after the worker picked or wrapped it. */
export type CutResult = { ok: true; area: number; sizes: number[] } | Failed
/** `index`: the last of the masks under the point (the part drawn on top), or -1. */
export type HitResult = { ok: true; index: number } | Failed
export type BuildResult =
  { ok: true; plate: boolean; parts: BuiltPart[] } | { ok: false; error: string }

export interface CoverWorker {
  /** Loads SAM and reads the cover, so the first click is as quick as the rest. */
  prepare(cover: string): Promise<{ ok: true } | Failed>
  cut(request: CutRequest): Promise<CutResult>
  hit(point: [number, number], masks: string[]): Promise<HitResult>
  build(request: BuildRequest): Promise<BuildResult>
  dispose(): void
}

type Reply =
  | { id: number; ok: false; error: string }
  | {
      id: number
      ok: true
      area?: number
      sizes?: number[]
      index?: number
      plate?: boolean
      parts?: BuiltPart[]
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finitePair(raw: unknown, max: number): [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null
  const [a, b] = raw as unknown[]
  if (typeof a !== 'number' || typeof b !== 'number') return null
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > max || Math.abs(b) > max)
    return null
  return [a, b]
}

function parsePart(raw: unknown): BuiltPart | null {
  if (!isRecord(raw)) return null
  const move = finitePair(raw.move, 1.0001)
  const center = finitePair(raw.center, ANALYSIS_PX)
  if (!move || !center) return null
  if (!Array.isArray(raw.emitters) || raw.emitters.length > MAX_EMITTERS) return null
  const emitters = (raw.emitters as unknown[]).map((point) => finitePair(point, ANALYSIS_PX))
  if (emitters.some((point) => point === null)) return null
  const color = raw.color
  if (
    !Array.isArray(color) ||
    color.length !== 3 ||
    !color.every((c) => typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 255)
  ) {
    return null
  }
  return {
    move,
    center,
    emitters: emitters as [number, number][],
    color: color as [number, number, number]
  }
}

/** The worker's output is untrusted like any helper's: anything off-shape is no data. */
export function parseCoverReply(raw: unknown): Reply | null {
  if (!isRecord(raw) || raw.type !== 'reply' || typeof raw.id !== 'number') return null
  if (raw.ok !== true) {
    const error = typeof raw.error === 'string' ? raw.error.slice(0, MAX_ERROR) : 'failed'
    return { id: raw.id, ok: false, error }
  }
  const reply: Reply = { id: raw.id, ok: true }
  if (raw.area !== undefined) {
    if (typeof raw.area !== 'number' || !Number.isFinite(raw.area)) return null
    if (raw.area < 0 || raw.area > 1) return null
    reply.area = raw.area
  }
  if (raw.sizes !== undefined) {
    const sizes = raw.sizes
    if (!Array.isArray(sizes) || sizes.length > MAX_STROKES) return null
    if (
      !sizes.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < CUT_SIZES)
    )
      return null
    reply.sizes = sizes as number[]
  }
  if (raw.index !== undefined) {
    const index = raw.index
    if (typeof index !== 'number' || !Number.isInteger(index) || index < -1 || index >= MAX_PARTS)
      return null
    reply.index = index
  }
  if (raw.parts !== undefined) {
    if (typeof raw.plate !== 'boolean') return null
    if (!Array.isArray(raw.parts) || raw.parts.length > MAX_PARTS) return null
    const parts = (raw.parts as unknown[]).map(parsePart)
    if (parts.some((part) => part === null)) return null
    reply.plate = raw.plate
    reply.parts = parts as BuiltPart[]
  }
  return reply
}

interface Pending {
  resolve(reply: Reply): void
  timer: ReturnType<typeof setTimeout>
}

export function createCoverWorker(
  start: StartCoverWorker,
  { idleStopMs = IDLE_STOP_MS } = {}
): CoverWorker {
  let worker: HelperProcess | null = null
  let nextId = 1
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const pending = new Map<number, Pending>()

  function settle(id: number, reply: Reply): void {
    const waiting = pending.get(id)
    if (!waiting) return
    pending.delete(id)
    clearTimeout(waiting.timer)
    waiting.resolve(reply)
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
    worker = start({
      onMessage(raw) {
        const reply = parseCoverReply(raw)
        if (reply) settle(reply.id, reply)
      },
      onExit() {
        for (const id of [...pending.keys()]) settle(id, { id, ok: false, error: 'stopped' })
      }
    })
    return worker
  }

  function request(body: Record<string, unknown>, timeoutMs: number): Promise<Reply> {
    const id = nextId++
    const target = ensureWorker()
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(id, { id, ok: false, error: 'timed out' }), timeoutMs)
      pending.set(id, { resolve, timer })
      if (!target.send({ ...body, id })) settle(id, { id, ok: false, error: 'not running' })
    })
  }

  return {
    async prepare(cover) {
      const reply = await request({ op: 'prepare', cover }, SEGMENT_TIMEOUT_MS)
      return reply.ok ? { ok: true } : { ok: false, error: reply.error }
    },
    async cut(body) {
      const reply = await request({ op: 'cut', ...body }, SEGMENT_TIMEOUT_MS)
      if (!reply.ok) return { ok: false, error: reply.error }
      if (reply.area === undefined || reply.sizes?.length !== body.strokes.length)
        return { ok: false, error: 'no answer' }
      return { ok: true, area: reply.area, sizes: reply.sizes }
    },
    async hit(point, masks) {
      const reply = await request({ op: 'hit', point, masks }, SEGMENT_TIMEOUT_MS)
      if (!reply.ok) return { ok: false, error: reply.error }
      if (reply.index === undefined || reply.index >= masks.length)
        return { ok: false, error: 'no answer' }
      return { ok: true, index: reply.index }
    },
    async build(body) {
      const reply = await request({ op: 'build', ...body }, BUILD_TIMEOUT_MS)
      if (!reply.ok) return { ok: false, error: reply.error }
      if (!reply.parts || reply.plate === undefined) return { ok: false, error: 'no answer' }
      return { ok: true, plate: reply.plate, parts: reply.parts }
    },
    dispose() {
      clearTimeout(idleTimer)
      for (const id of [...pending.keys()]) settle(id, { id, ok: false, error: 'stopped' })
      worker?.stop()
      worker = null
    }
  }
}
