// What the audio helper prints (native/mac-audio). Its output is parsed as untrusted: anything
// off-shape counts as no data.

/** May the helper record other apps' audio? "unknown" until macOS has asked. */
export type CaptureAccess = 'granted' | 'denied' | 'unknown'

export type AudioHelperMessage =
  | { type: 'access'; status: CaptureAccess }
  /** 16 kHz mono; `at` is the first sample's time in epoch seconds. */
  | { type: 'audio'; at: number; samples: Int16Array }
  | { type: 'reply'; id: number; ok: boolean; error: string | null }

/** The helper sends ~100 ms at a time; a second's worth is already far more than it sends. */
const MAX_CHUNK_SAMPLES = 16_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodePcm(base64: string): Int16Array | null {
  if (base64.length > ((MAX_CHUNK_SAMPLES * 2 + 2) / 3) * 4 + 4) return null
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length === 0 || bytes.length % 2 !== 0) return null
  // A copy on its own aligned buffer; the helper sends little-endian, like every Mac.
  return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length))
}

export function parseAudioHelperMessage(raw: unknown): AudioHelperMessage | null {
  if (!isRecord(raw)) return null
  switch (raw.type) {
    case 'access':
      return raw.status === 'granted' || raw.status === 'denied' || raw.status === 'unknown'
        ? { type: 'access', status: raw.status }
        : null
    case 'audio': {
      if (typeof raw.at !== 'number' || !Number.isFinite(raw.at) || typeof raw.pcm !== 'string') {
        return null
      }
      const samples = decodePcm(raw.pcm)
      return samples ? { type: 'audio', at: raw.at, samples } : null
    }
    case 'reply':
      if (typeof raw.id !== 'number' || typeof raw.ok !== 'boolean') return null
      return {
        type: 'reply',
        id: raw.id,
        ok: raw.ok,
        error: typeof raw.error === 'string' ? raw.error.slice(0, 200) : null
      }
    default:
      return null
  }
}
