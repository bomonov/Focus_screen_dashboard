import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Lyrics } from '../lyrics/types'
import type { CapturedSong } from './capture'
import { SAMPLE_RATE } from './recording'
import { encodeWav } from './wav'

/** ASCII only, so any tool can open the file; a Japanese title just becomes "song". */
export function sampleBaseName(title: string, at: Date): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
    .slice(0, 40)
  const stamp = at.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  return `${stamp}-${slug || 'song'}`
}

/**
 * Dev builds only: keeps a recorded song (WAV) with its details and the lyrics on screen, so
 * aligners can be measured against LRCLIB's own timings. Delete the folder after measuring.
 */
export function saveSample(dir: string, song: CapturedSong, lyrics: Lyrics | null): string {
  mkdirSync(dir, { recursive: true })
  const base = join(dir, sampleBaseName(song.track.title, new Date()))
  writeFileSync(`${base}.wav`, encodeWav(song.recording.samples(), SAMPLE_RATE))
  const details = {
    version: 1,
    player: song.player,
    title: song.track.title,
    artist: song.track.artist,
    album: song.track.album,
    durationSec: song.track.durationSec,
    coverage: Math.round(song.recording.coverage() * 1000) / 1000,
    lyrics
  }
  writeFileSync(`${base}.json`, JSON.stringify(details, null, 2))
  return base
}
