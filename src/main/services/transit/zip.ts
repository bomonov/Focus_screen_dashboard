// Reads files out of a zip archive held in memory (Valley Metro's schedule), with Node's own
// zlib, so the app needs no unzip tool or package. Only what GTFS zips use: no ZIP64, no
// encryption, stored or deflated entries.
import { createInflateRaw } from 'zlib'

export class ZipError extends Error {}

export interface ZipEntry {
  name: string
  /** 0 stored, 8 deflated. */
  method: number
  compressedSize: number
  size: number
  localOffset: number
}

const END_OF_DIRECTORY = 0x06054b50
const DIRECTORY_ENTRY = 0x02014b50
const LOCAL_HEADER = 0x04034b50
/** The end record is 22 bytes, plus a comment of up to 64 KB. */
const MAX_END_SEARCH = 22 + 0xffff

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function findEndOfDirectory(data: DataView): number {
  const lowest = Math.max(0, data.byteLength - MAX_END_SEARCH)
  for (let at = data.byteLength - 22; at >= lowest; at--) {
    if (data.getUint32(at, true) === END_OF_DIRECTORY) return at
  }
  throw new ZipError('Not a zip file.')
}

/** The archive's files by name, from its central directory. */
export function readZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const data = view(bytes)
  const end = findEndOfDirectory(data)
  const count = data.getUint16(end + 10, true)
  let at = data.getUint32(end + 16, true)
  const entries = new Map<string, ZipEntry>()
  const names = new TextDecoder()
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.byteLength || data.getUint32(at, true) !== DIRECTORY_ENTRY) {
      throw new ZipError('The zip’s directory is broken.')
    }
    const nameLength = data.getUint16(at + 28, true)
    const extraLength = data.getUint16(at + 30, true)
    const commentLength = data.getUint16(at + 32, true)
    if (at + 46 + nameLength > bytes.byteLength) {
      throw new ZipError('The zip’s directory is broken.')
    }
    const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    entries.set(name, {
      name,
      method: data.getUint16(at + 10, true),
      compressedSize: data.getUint32(at + 20, true),
      size: data.getUint32(at + 24, true),
      localOffset: data.getUint32(at + 42, true)
    })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** Where an entry's compressed bytes are: after its local header, whose lengths can differ. */
function entryData(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const data = view(bytes)
  const at = entry.localOffset
  if (at + 30 > bytes.byteLength || data.getUint32(at, true) !== LOCAL_HEADER) {
    throw new ZipError(`${entry.name} is broken.`)
  }
  const start = at + 30 + data.getUint16(at + 26, true) + data.getUint16(at + 28, true)
  const end = start + entry.compressedSize
  if (end > bytes.byteLength) throw new ZipError(`${entry.name} is cut short.`)
  return bytes.subarray(start, end)
}

/**
 * An entry's contents, a piece at a time, so a big file (stop_times.txt is ~80 MB) never sits
 * in memory whole and the main process keeps answering while it's read. Stops with ZipError
 * past `maxBytes`.
 */
export async function* zipEntryChunks(
  bytes: Uint8Array,
  entry: ZipEntry,
  maxBytes: number
): AsyncGenerator<Uint8Array> {
  if (entry.size > maxBytes) throw new ZipError(`${entry.name} is too big.`)
  const compressed = entryData(bytes, entry)
  if (entry.method === 0) {
    yield compressed
    return
  }
  if (entry.method !== 8) throw new ZipError(`${entry.name} is packed in a way we can’t read.`)
  const inflater = createInflateRaw({ chunkSize: 256 * 1024 })
  inflater.end(compressed)
  let total = 0
  try {
    for await (const chunk of inflater as AsyncIterable<Buffer>) {
      total += chunk.byteLength
      if (total > maxBytes) throw new ZipError(`${entry.name} is too big.`)
      yield chunk
    }
  } finally {
    inflater.destroy()
  }
}
