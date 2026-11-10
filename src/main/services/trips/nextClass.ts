// The next class as the trip card offers it: the first class still to start whose location names
// a building the class map knows for sure. Titles and places stay in memory: never logged.
import type { ClassPosition } from '../calendar/classMap'
import type { ClassEvent } from '../calendar/types'
import type { ClassPlace } from './types'

export async function nextClassPlace(
  events: readonly ClassEvent[],
  nowSec: number,
  position: (location: string) => Promise<ClassPosition | null>
): Promise<ClassPlace | null> {
  const upcoming = events.filter((event) => event.start > nowSec).sort((a, b) => a.start - b.start)
  for (const event of upcoming) {
    if (!event.location) continue
    const found = await position(event.location)
    if (!found) continue
    return {
      id: `class:${event.id}`,
      kind: 'class',
      name: found.name,
      detail: found.room ?? '',
      lat: found.lat,
      lon: found.lon,
      title: event.title,
      start: event.start
    }
  }
  return null
}
