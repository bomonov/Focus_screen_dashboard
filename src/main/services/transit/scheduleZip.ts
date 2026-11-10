// Valley Metro's schedule zip, read a file at a time. Next bus's stop list and the trip
// planner's timetable are both made from the one download, so they share its limits.
import { eachCsvRow, type CsvValues } from './csv'
import { readZipDirectory, zipEntryChunks, ZipError, type ZipEntry } from './zip'

/** stop_times.txt is ~40 MB unzipped; anything far past that isn't a bus schedule. */
export const MAX_ENTRY_BYTES = 400 * 1024 * 1024
export const MAX_ID_CHARS = 100
export const MAX_TEXT_CHARS = 200
/** Valley Metro's longest trips make ~150 stops. */
export const MAX_TRIP_STOPS = 2000

export interface ScheduleZip {
  has(name: string): boolean
  /** Each row's values for `columns`, as eachCsvRow gives them; ZipError when there's no such file. */
  rows<const C extends readonly string[]>(
    name: string,
    columns: C,
    onRow: (values: CsvValues<C>) => void
  ): Promise<void>
}

/** Throws ZipError when it isn't a zip. */
export function openSchedule(zip: Uint8Array): ScheduleZip {
  const entries = readZipDirectory(zip)
  const entryNamed = (name: string): ZipEntry | null => {
    // Some feeds put their files in a folder inside the zip.
    for (const entry of entries.values()) {
      if (entry.name === name || entry.name.endsWith(`/${name}`)) return entry
    }
    return null
  }
  const rows = async <const C extends readonly string[]>(
    name: string,
    columns: C,
    onRow: (values: CsvValues<C>) => void
  ): Promise<void> => {
    const entry = entryNamed(name)
    if (!entry) throw new ZipError(`The schedule has no ${name}.`)
    await eachCsvRow(zipEntryChunks(zip, entry, MAX_ENTRY_BYTES), columns, onRow)
  }
  return { has: (name) => entryNamed(name) !== null, rows }
}

/** The schedule's feed_version, "" when it has none. */
export async function feedVersion(schedule: ScheduleZip): Promise<string> {
  let version = ''
  if (schedule.has('feed_info.txt')) {
    await schedule.rows('feed_info.txt', ['feed_version'], ([v]) => {
      version ||= v.slice(0, MAX_TEXT_CHARS)
    })
  }
  return version
}
