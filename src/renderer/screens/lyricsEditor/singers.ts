// The singers the editor can offer: the built-in cast and the song's own extras, by id. Pure.
import type { SongColors } from '../../../main/ipc'
import { castSinger, type Singer } from '../../../main/services/lyrics/singers/cast'

/** A built-in character, or one of the song's added singers; undefined for an id that's neither. */
export function singerById(id: string, extra: SongColors['extra']): Singer | undefined {
  // The cast first, as the colors do: an extra can't take over a character's id.
  const built = castSinger(id)
  if (built) return built
  const added = extra.find((singer) => singer.id === id)
  return added ? { ...added, group: 'extra' } : undefined
}

/** The song's cast as singers, in its order; ids that aren't anyone are left out. */
export function songCast(colors: SongColors): Singer[] {
  return colors.cast.flatMap((id) => {
    const singer = singerById(id, colors.extra)
    return singer ? [singer] : []
  })
}

/** The number keys reach the first nine of the song's cast. */
export const KEY_SLOTS = 9

/** Whether `name` is already someone's (a character's or an added singer's), as `addSinger` checks. */
export function nameTaken(
  name: string,
  extra: SongColors['extra'],
  cast: readonly Singer[]
): boolean {
  const lower = name.trim().toLowerCase()
  return (
    lower !== '' &&
    (extra.some((singer) => singer.name.toLowerCase() === lower) ||
      cast.some((singer) => singer.name.toLowerCase() === lower))
  )
}
