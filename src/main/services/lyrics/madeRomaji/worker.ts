// The romaji maker's own process, started by client.ts (utilityProcess.fork): loads kuromoji's
// dictionary, learns from the VocaDB romaji saved so far, then makes each song's romaji. Nothing
// here touches the network or the disk beyond reading the dictionary.
import { createMaker, type Maker } from './maker'
import type { MakerReply, MakerRequest } from './messages'
import { loadTokenizer } from './tokenizer'

const ready: Promise<Maker | null> = loadTokenizer().then(createMaker, (error: unknown) => {
  console.warn('[romaji] Could not load the dictionary.', error)
  return null
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const pairs = (value: unknown): value is [string, string][] =>
  Array.isArray(value) &&
  value.every((entry) => Array.isArray(entry) && entry.length === 2 && strings(entry))

function parseRequest(raw: unknown): MakerRequest | null {
  if (!isRecord(raw)) return null
  if (raw.kind === 'readings' && pairs(raw.readings)) {
    return { kind: 'readings', readings: raw.readings }
  }
  if (raw.kind === 'make' && typeof raw.id === 'number' && strings(raw.lines)) {
    return { kind: 'make', id: raw.id, lines: raw.lines }
  }
  if (raw.kind !== 'learn' || !Array.isArray(raw.songs)) return null
  const songs = (raw.songs as unknown[]).filter(
    (song): song is { original: string; romanized: string } =>
      isRecord(song) && typeof song.original === 'string' && typeof song.romanized === 'string'
  )
  return { kind: 'learn', songs }
}

async function handle(request: MakerRequest): Promise<void> {
  const maker = await ready
  if (request.kind === 'readings') {
    maker?.use(request.readings)
    return
  }
  if (request.kind === 'learn') {
    try {
      const readings = maker?.learn(request.songs)
      if (readings)
        process.parentPort.postMessage({ kind: 'learned', readings } satisfies MakerReply)
    } catch (error) {
      console.warn('[romaji] Could not learn from the saved romaji.', error)
    }
    return
  }
  let reply: MakerReply = { kind: 'failed', id: request.id }
  try {
    if (maker) reply = { kind: 'made', id: request.id, romaji: maker.make(request.lines) }
  } catch (error) {
    console.warn('[romaji] Could not make romaji.', error)
  }
  process.parentPort.postMessage(reply)
}

// One at a time, in order: learning finishes before the first song is made.
let queue: Promise<void> = Promise.resolve()
process.parentPort.on('message', (event) => {
  const request = parseRequest(event.data)
  if (request) queue = queue.then(() => handle(request))
})
