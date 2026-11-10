// Just enough of protobuf's wire format to walk a GTFS-realtime feed field by field, so the
// app needs no protobuf package. Anything malformed throws ProtobufError: callers treat that
// as "no data", never as a crash.

export class ProtobufError extends Error {}

export const WIRE_VARINT = 0
export const WIRE_FIXED64 = 1
export const WIRE_BYTES = 2
export const WIRE_FIXED32 = 5

const text = new TextDecoder()

/** Reads one message: its fields in order, skipping whatever the caller doesn't ask for. */
export class ProtoReader {
  private pos: number

  constructor(
    private readonly buffer: Uint8Array,
    start = 0,
    private readonly end = buffer.length
  ) {
    this.pos = start
  }

  done(): boolean {
    return this.pos >= this.end
  }

  /** The next field's number and wire type. */
  tag(): { field: number; wire: number } {
    const key = this.uint()
    const field = Math.floor(key / 8)
    if (field === 0) throw new ProtobufError('Field 0 doesn’t exist.')
    return { field, wire: key % 8 }
  }

  /** An unsigned varint (uint32, uint64, enum, bool), as long as it fits a JS number exactly. */
  uint(): number {
    let value = 0
    let scale = 1
    for (let i = 0; i < 10; i++) {
      const byte = this.byte()
      value += (byte & 0x7f) * scale
      if (byte < 0x80) {
        if (!Number.isSafeInteger(value)) throw new ProtobufError('Varint too large.')
        return value
      }
      scale *= 128
    }
    throw new ProtobufError('Varint too long.')
  }

  /** A signed varint (int32, int64): negative ones are ten bytes of two's complement. */
  int(): number {
    let value = 0n
    let shift = 0n
    for (let i = 0; i < 10; i++) {
      const byte = this.byte()
      value |= BigInt(byte & 0x7f) << shift
      if (byte < 0x80) {
        const signed = Number(BigInt.asIntN(64, value))
        if (!Number.isSafeInteger(signed)) throw new ProtobufError('Varint too large.')
        return signed
      }
      shift += 7n
    }
    throw new ProtobufError('Varint too long.')
  }

  /** A float (fixed32, little-endian), as GTFS-realtime gives positions. */
  float(): number {
    const start = this.pos
    this.advance(4)
    return new DataView(this.buffer.buffer, this.buffer.byteOffset + start, 4).getFloat32(0, true)
  }

  string(): string {
    const [start, end] = this.span()
    return text.decode(this.buffer.subarray(start, end))
  }

  /** A length-delimited field read as a message of its own. */
  message(): ProtoReader {
    const [start, end] = this.span()
    return new ProtoReader(this.buffer, start, end)
  }

  /** Moves past a field this reader doesn't need. */
  skip(wire: number): void {
    switch (wire) {
      case WIRE_VARINT:
        for (let i = 0; this.byte() >= 0x80; i++) {
          if (i >= 9) throw new ProtobufError('Varint too long.')
        }
        return
      case WIRE_FIXED64:
        this.advance(8)
        return
      case WIRE_BYTES:
        this.span()
        return
      case WIRE_FIXED32:
        this.advance(4)
        return
      default:
        // Groups (3, 4) are long gone from protobuf, and GTFS-realtime never had them.
        throw new ProtobufError(`Unknown wire type ${wire}.`)
    }
  }

  private byte(): number {
    const byte = this.pos < this.end ? this.buffer[this.pos] : undefined
    if (byte === undefined) throw new ProtobufError('Message ends early.')
    this.pos += 1
    return byte
  }

  private advance(count: number): void {
    if (this.pos + count > this.end) throw new ProtobufError('Message ends early.')
    this.pos += count
  }

  /** A length prefix and the bytes it covers; the reader moves past them. */
  private span(): [number, number] {
    const length = this.uint()
    const start = this.pos
    this.advance(length)
    return [start, this.pos]
  }
}
