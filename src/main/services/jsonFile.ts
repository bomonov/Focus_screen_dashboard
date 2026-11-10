import { mkdirSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'

/** Replaces a file in one step. Throws on failure; callers decide how loud. */
export function writeFileAtomic(filePath: string, data: string | Uint8Array): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, data)
  // rename is atomic on one volume, so a crash mid-write never leaves half a file.
  renameSync(tempPath, filePath)
}

/** Writes pretty JSON so the file is safe to hand-edit. Throws on failure; callers decide how loud. */
export function writeJsonFile(filePath: string, value: unknown): void {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`)
}
