// The Project Sekai cast: the 26 characters a song's parts can be colored by.
// Keep this file free of imports: the renderer compiles it too.

// Colors are the game's own character colors (`colorCode` in the Sekai-World
// master data's gameCharacterUnits.json, the same table the game reads), checked
// against the spec's table on 2026-11-02: all 26 matched.

export type CastGroup = 'leoneed' | 'mmj' | 'vbs' | 'wxs' | 'n25' | 'vs'

export interface Singer {
  /** Lowercase name for the characters, an id of their own for extras. */
  id: string
  name: string
  /** #RRGGBB, before any fitting to a theme. */
  color: string
  /** Extras are the ones the user adds with "Add singer…". */
  group: CastGroup | 'extra'
}

/** In the game's order, which is the order the cast shows in. */
export const CAST_GROUPS: readonly { id: CastGroup; name: string }[] = [
  { id: 'leoneed', name: 'Leo/need' },
  { id: 'mmj', name: 'MORE MORE JUMP!' },
  { id: 'vbs', name: 'Vivid BAD SQUAD' },
  { id: 'wxs', name: 'Wonderlands×Showtime' },
  { id: 'n25', name: '25-ji, Nightcord de.' },
  { id: 'vs', name: 'Virtual Singers' }
]

// The Virtual Singers are one character each, whichever unit's version sings.
export const CAST: readonly Singer[] = [
  { id: 'ichika', name: 'Ichika', color: '#33AAEE', group: 'leoneed' },
  { id: 'saki', name: 'Saki', color: '#FFDD44', group: 'leoneed' },
  { id: 'honami', name: 'Honami', color: '#EE6666', group: 'leoneed' },
  { id: 'shiho', name: 'Shiho', color: '#BBDD22', group: 'leoneed' },

  { id: 'minori', name: 'Minori', color: '#FFCCAA', group: 'mmj' },
  { id: 'haruka', name: 'Haruka', color: '#99CCFF', group: 'mmj' },
  { id: 'airi', name: 'Airi', color: '#FFAACC', group: 'mmj' },
  { id: 'shizuku', name: 'Shizuku', color: '#99EEDD', group: 'mmj' },

  { id: 'kohane', name: 'Kohane', color: '#FF6699', group: 'vbs' },
  { id: 'an', name: 'An', color: '#00BBDD', group: 'vbs' },
  { id: 'akito', name: 'Akito', color: '#FF7722', group: 'vbs' },
  { id: 'toya', name: 'Toya', color: '#0077DD', group: 'vbs' },

  { id: 'tsukasa', name: 'Tsukasa', color: '#FFBB00', group: 'wxs' },
  { id: 'emu', name: 'Emu', color: '#FF66BB', group: 'wxs' },
  { id: 'nene', name: 'Nene', color: '#33DD99', group: 'wxs' },
  { id: 'rui', name: 'Rui', color: '#BB88EE', group: 'wxs' },

  { id: 'kanade', name: 'Kanade', color: '#BB6688', group: 'n25' },
  { id: 'mafuyu', name: 'Mafuyu', color: '#8888CC', group: 'n25' },
  { id: 'ena', name: 'Ena', color: '#CCAA88', group: 'n25' },
  { id: 'mizuki', name: 'Mizuki', color: '#DDAACC', group: 'n25' },

  { id: 'miku', name: 'Miku', color: '#33CCBB', group: 'vs' },
  { id: 'rin', name: 'Rin', color: '#FFCC11', group: 'vs' },
  { id: 'len', name: 'Len', color: '#FFEE11', group: 'vs' },
  { id: 'luka', name: 'Luka', color: '#FFBBCC', group: 'vs' },
  { id: 'meiko', name: 'MEIKO', color: '#DD4444', group: 'vs' },
  { id: 'kaito', name: 'KAITO', color: '#3366CC', group: 'vs' }
]

const BY_ID: ReadonlyMap<string, Singer> = new Map(CAST.map((s) => [s.id, s]))

/** A built-in character by id. A Map, so ids like "constructor" aren't characters. */
export function castSinger(id: string): Singer | undefined {
  return BY_ID.get(id)
}

/**
 * The two letters on a badge with no picture. Whole characters, not UTF-16
 * halves, since extra singers can be named in Japanese.
 */
export function initials(name: string): string {
  const [first = '', second = ''] = Array.from(name.trim())
  return first.toUpperCase() + second
}
