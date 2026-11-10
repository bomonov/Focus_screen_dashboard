import type { BackgroundMode, Track } from '../../main/ipc'
import { placeholderCover } from '../widgets/music/cover'

/** What's behind the cards; null for a solid background. */
export type BackdropView =
  /** A data URL from the main process, blurred (a cover) or as it is (a photo). */
  | { kind: 'art' | 'photo'; image: string }
  /**
   * The song's colors drifting slowly: from its cover, or (with no cover) from the stand-in
   * label the record shows, so every song has some.
   */
  | { kind: 'living'; artwork: string | null; fallback: string[] }

/** A cover needs a song with one, living colors a song, a photo one chosen; otherwise solid. */
export function backdropFor(
  mode: BackgroundMode | undefined,
  track: Pick<Track, 'artwork' | 'artist' | 'album' | 'title'> | null,
  photo: string | null
): BackdropView | null {
  if (mode === 'art' && track?.artwork) return { kind: 'art', image: track.artwork }
  if (mode === 'photo' && photo) return { kind: 'photo', image: photo }
  if (mode === 'living' && track) {
    const cover = placeholderCover(track.artist, track.album, track.title)
    return { kind: 'living', artwork: track.artwork, fallback: [cover.base, cover.band, cover.dot] }
  }
  return null
}
