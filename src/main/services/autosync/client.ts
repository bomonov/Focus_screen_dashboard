import type { HelperProcess } from '../helperProcess'
import { parseAudioHelperMessage, type CaptureAccess } from './protocol'

/** Starts the helper (the runner brings it back if it exits). */
export type StartAudioHelper = (handlers: {
  onMessage(message: unknown): void
  onExit(): void
}) => HelperProcess

const REPLY_TIMEOUT_MS = 5000
/** The macOS prompt waits for the user. */
const ACCESS_TIMEOUT_MS = 120_000

export interface StartResult {
  ok: boolean
  /** "noProcess" when the player isn't making sound yet, else what went wrong. */
  error: string | null
}

/** Request/reply with the audio helper, plus its stream of audio. */
export interface AudioHelperClient {
  /** null until the helper says, and again while it restarts. */
  access(): CaptureAccess | null
  /** Listens to the apps whose bundle IDs start with one of `bundles`, replacing any tap. */
  start(bundles: string[]): Promise<StartResult>
  stop(): void
  /**
   * Keeps the apps whose bundle IDs start with one of `bundles` off the speakers while `start`
   * still hears them, until called with `on` false. Asked again if the helper restarts.
   */
  mute(on: boolean, bundles?: string[]): Promise<StartResult>
  /** Shows macOS's prompt if it hasn't been answered yet. */
  requestAccess(): Promise<CaptureAccess | null>
  onAudio(listener: (at: number, samples: Int16Array) => void): () => void
  onAccess(listener: (status: CaptureAccess) => void): () => void
  dispose(): void
}

export function createAudioHelperClient(startHelper: StartAudioHelper): AudioHelperClient {
  let access: CaptureAccess | null = null
  /** The apps kept muted; a restarted helper has forgotten, so it's told again. */
  let muted: string[] | null = null
  let nextId = 1
  const pending = new Map<number, (reply: StartResult) => void>()
  const audioListeners = new Set<(at: number, samples: Int16Array) => void>()
  const accessListeners = new Set<(status: CaptureAccess) => void>()

  function settleAll(error: string): void {
    for (const resolve of pending.values()) resolve({ ok: false, error })
    pending.clear()
  }

  const helper = startHelper({
    onMessage(raw) {
      const message = parseAudioHelperMessage(raw)
      if (!message) return
      switch (message.type) {
        case 'access':
          if (message.status === access) return
          // The first word from a (re)started helper.
          if (access === null && muted)
            void request({ op: 'mute', on: true, bundles: muted }, REPLY_TIMEOUT_MS)
          access = message.status
          for (const listener of accessListeners) listener(message.status)
          break
        case 'audio':
          for (const listener of audioListeners) listener(message.at, message.samples)
          break
        case 'reply':
          pending.get(message.id)?.({ ok: message.ok, error: message.error })
          pending.delete(message.id)
          break
      }
    },
    onExit() {
      access = null
      settleAll('The audio helper stopped.')
    }
  })

  function request(body: Record<string, unknown>, timeoutMs: number): Promise<StartResult> {
    const id = nextId++
    return new Promise((resolve) => {
      if (!helper.send({ ...body, id })) {
        resolve({ ok: false, error: 'The audio helper isn’t running.' })
        return
      }
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve({ ok: false, error: 'The audio helper didn’t answer.' })
      }, timeoutMs)
      pending.set(id, (reply) => {
        clearTimeout(timer)
        resolve(reply)
      })
    })
  }

  return {
    access: () => access,
    start: (bundles) => request({ op: 'start', bundles }, REPLY_TIMEOUT_MS),
    stop() {
      void request({ op: 'stop' }, REPLY_TIMEOUT_MS)
    },
    mute(on, bundles = []) {
      muted = on ? [...bundles] : null
      return request(on ? { op: 'mute', on, bundles } : { op: 'mute', on }, REPLY_TIMEOUT_MS)
    },
    async requestAccess() {
      await request({ op: 'requestAccess' }, ACCESS_TIMEOUT_MS)
      return access
    },
    onAudio(listener) {
      audioListeners.add(listener)
      return () => {
        audioListeners.delete(listener)
      }
    },
    onAccess(listener) {
      accessListeners.add(listener)
      return () => {
        accessListeners.delete(listener)
      }
    },
    dispose() {
      settleAll('Stopped.')
      audioListeners.clear()
      accessListeners.clear()
      helper.stop()
    }
  }
}
