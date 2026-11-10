// Calendar types shared with the renderer (Next class in the top bar).
// Keep this file free of imports: the renderer compiles it too.

/** macOS's answer to "may Focus Screen read your calendars?" */
export type CalendarAccess = 'granted' | 'denied' | 'restricted' | 'notDetermined'

/** One calendar on this Mac, for picking which ones hold classes. */
export interface CalendarInfo {
  id: string
  /** "Classes" */
  title: string
  /** The account it's in: "iCloud", "Google", "Exchange". Empty when macOS doesn't say. */
  source: string
  /** "#RRGGBB", or "" when the calendar has none. */
  color: string
}

/** A timed event in one of the class calendars. */
export interface ClassEvent {
  /** Unique per occurrence, so a weekly class has a different id each week. */
  id: string
  /** The id of its calendar. */
  calendar: string
  title: string
  /** "LSE 104", or "" when the event has none. */
  location: string
  /** Unix epoch seconds. */
  start: number
  end: number
}

export interface CalendarState {
  /** This computer can read calendars (macOS). When false, Next class doesn't show anywhere. */
  supported: boolean
  /** null while Next class is off, and until the helper says. */
  access: CalendarAccess | null
  /** Every calendar on this Mac; empty until access is given. */
  calendars: CalendarInfo[]
  /** Timed events in the class calendars from today through a week on, by start time. */
  events: ClassEvent[]
  /** Calendars couldn't be read (the helper is missing or not answering). */
  problem: string | null
  /** Dev builds only: made-up classes, for working on the screen without a calendar. */
  demo: boolean
  /**
   * Google Calendar, signed in on its own (read-only); its calendars join `calendars` once
   * signed in. Optional: older states don't have it.
   */
  google?: GoogleCalendarStatus
}

export interface GoogleCalendarStatus {
  connection: 'connected' | 'connecting' | 'disconnected'
  /** Why its calendars couldn't be read just now, in words; null when they could. */
  problem: string | null
}

export type CalendarCommand =
  /** The permission row's button: System Settings › Privacy & Security › Calendars. */
  | { kind: 'openPrivacySettings' }
  /** Signs in to Google Calendar (asking for the OAuth client file the first time). */
  | { kind: 'connectGoogle' }
  | { kind: 'disconnectGoogle' }

/** A class building's map, made by the helper: a JPEG, and where the building is on it. */
export interface ClassMapPicture {
  /** A data URL, ready for an <img>. */
  image: string
  /** The building's spot, as a share of the picture's width and height. */
  pinX: number
  pinY: number
}

/** A school, for Next class's map: ASU, or any in the bundled list of universities. */
export interface School {
  name: string
  /** ISO 3166 alpha-2: "US". */
  country: string
}

/** The school picked in Customize, and the state of its building map. */
export interface SchoolState {
  school: School
  /** ASU's own building list ('official'), or a map of OpenStreetMap's, downloaded when asked. */
  source: 'official' | 'openstreetmap'
  /** OpenStreetMap's map once downloaded: how many buildings, and when (Unix seconds). */
  map: { buildings: number; downloadedAt: number } | null
  downloading: boolean
  /** Why the last download didn't work, in words. */
  problem: string | null
  /** A school the calendar accounts' email addresses point to, when it isn't the picked one. */
  suggestion: School | null
}

export type SchoolCommand =
  /** Downloads the picked school's buildings from OpenStreetMap (asked first in Customize). */
  { kind: 'download' } | { kind: 'remove' }

/** Where a class meets, for the card that opens from the Next class pill. */
export type ClassPlaceInfo =
  | { kind: 'online' }
  /**
   * Looks like a room, but it isn't one in the school's map: no pin. `officialMap` when the
   * school has its own map page to offer instead (ASU's).
   */
  | { kind: 'unknown'; school: string; officialMap: boolean }
  | {
      kind: 'building'
      /** "COOR" */
      code: string
      /** "Coor Hall" */
      name: string
      /** "Tempe"; "" for a campus the card doesn't name. */
      campus: string
      /** "195"; null when the location names only the building. */
      room: string | null
      /** null when the picture couldn't be made (offline the first time). */
      map: ClassMapPicture | null
      /** What "Open in …" opens the building with: ASU's code, or OpenStreetMap's id. */
      mapKey: string
      /** "ASU Map", "Apple Maps": what that opens. */
      mapName: string
    }
