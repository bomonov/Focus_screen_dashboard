// What the trip card's field searches as it's typed in: the Mac's own places at once (nothing is
// sent anywhere for those), and Apple's a moment later, once typing pauses (the only words that
// leave the Mac, so they wait until they're likely what's meant). An answer for words no longer
// in the field is dropped, so a slow one can't land over a newer one. Pure apart from its timer,
// so its timing can be tested.
import type { Place } from '../../../main/ipc'

/** Apple's search waits this long after the last key. */
export const APPLE_DELAY_MS = 400
/** Apple's search needs this many characters (main checks the same). */
export const APPLE_MIN_CHARS = 2

export interface PlaceResults {
  /** The field's words. */
  text: string
  /** The Mac's own matches: for these words, or the last words' while `localWaiting`. */
  local: Place[]
  /** Apple's, under "From Apple Maps": as `local`, until the Mac's answer for these words lands. */
  apple: Place[]
  /** The Mac's answer for these words is on its way: the rows shown are the last words'. */
  localWaiting: boolean
  /** Apple will be asked for these words, or has been and hasn't answered. */
  appleWaiting: boolean
}

export interface PlaceSearchOptions {
  local(text: string): Promise<Place[]>
  apple(text: string): Promise<Place[]>
  /** Apple's search is there to ask (a Mac with the helper). */
  appleOn(): boolean
  onResults(results: PlaceResults): void
}

export interface PlaceSearch {
  /** The field's words changed. */
  type(text: string): void
  /** The Mac's own places again for the same words (a place was just saved). */
  refresh(): void
  dispose(): void
}

/** An answer kept with the words it's for. */
interface Answer {
  text: string
  places: Place[]
}

/** Whatever comes back is a list, or nothing found (the places' own fields are main's to check). */
const listOf = (value: unknown): Place[] => (Array.isArray(value) ? (value as Place[]) : [])

export function createPlaceSearch(options: PlaceSearchOptions): PlaceSearch {
  let current = ''
  let local: Answer | null = null
  let apple: Answer | null = null
  /** What's shown: kept while the next words' answer is on its way, so the list never blanks. */
  let shown: { local: Place[]; apple: Place[] } = { local: [], apple: [] }
  let appleWaiting = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const forNow = (answer: Answer | null): Place[] =>
    answer && answer.text === current ? answer.places : []

  function show(): void {
    if (disposed) return
    const localWaiting = local?.text !== current
    if (!localWaiting) shown = { local: forNow(local), apple: forNow(apple) }
    options.onResults({ text: current, ...shown, localWaiting, appleWaiting })
  }

  function askLocal(text: string): void {
    const take = (places: Place[]): void => {
      if (disposed || text !== current) return
      local = { text, places }
      show()
    }
    options.local(text).then(
      (places) => take(listOf(places)),
      () => take([])
    )
  }

  function askApple(text: string): void {
    const take = (places: Place[]): void => {
      if (disposed || text !== current) return
      apple = { text, places }
      appleWaiting = false
      show()
    }
    // A helper that's missing or failed is no results: the Mac's own matches stand.
    options.apple(text).then(
      (places) => take(listOf(places)),
      () => take([])
    )
  }

  return {
    type(text) {
      if (disposed) return
      clearTimeout(timer)
      timer = undefined
      current = text
      const words = text.trim()
      if (words === '') {
        local = { text, places: [] }
        apple = null
        appleWaiting = false
        show()
        return
      }
      appleWaiting = [...words].length >= APPLE_MIN_CHARS && options.appleOn()
      show()
      askLocal(text)
      if (!appleWaiting) return
      timer = setTimeout(() => {
        timer = undefined
        askApple(text)
      }, APPLE_DELAY_MS)
    },
    refresh() {
      if (!disposed && current.trim() !== '') askLocal(current)
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
      timer = undefined
    }
  }
}
