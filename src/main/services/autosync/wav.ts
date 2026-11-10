import { readdirSync, rmSync } from 'fs'
import { join } from 'path'

/** A mono 16-bit PCM WAV file, which every aligner reads. */
export function encodeWav(samples: Int16Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 2
  const out = Buffer.alloc(44 + dataBytes)
  out.write('RIFF', 0, 'ascii')
  out.writeUInt32LE(36 + dataBytes, 4)
  out.write('WAVE', 8, 'ascii')
  out.write('fmt ', 12, 'ascii')
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20) // PCM
  out.writeUInt16LE(1, 22) // mono
  out.writeUInt32LE(sampleRate, 24)
  out.writeUInt32LE(sampleRate * 2, 28)
  out.writeUInt16LE(2, 32)
  out.writeUInt16LE(16, 34)
  out.write('data', 36, 'ascii')
  out.writeUInt32LE(dataBytes, 40)
  for (let index = 0; index < samples.length; index++) {
    out.writeInt16LE(samples[index] ?? 0, 44 + index * 2)
  }
  return out
}

/** Deletes the WAVs in `dir`, which a crash mid-run leaves behind; nothing else in it is ours. */
export function clearWavs(dir: string): void {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return // Not there yet.
  }
  for (const name of names) {
    if (!name.endsWith('.wav')) continue
    try {
      rmSync(join(dir, name), { force: true })
    } catch {
      // A folder by that name, or a file still in use: the rest still go.
    }
  }
}
