// One location helper for everything that wants to know where the Mac is. The weather pill and
// the trip planner each take a handle; the helper (and its Location Services use) runs while
// either holds one, and stops with the last. Nothing here sees a position beyond passing a
// locate's answer on, so nothing is logged or kept.
import type { LocateResult, LocationSource } from './location'

/** What a handle that's already let go answers, so a late caller gets a plain "no" and no more. */
const failed = (): LocateResult => ({ ok: false, reason: 'failed' })

/**
 * `start` makes the underlying source (it's called for the first handle after none is held, so
 * a handle taken later starts a fresh one). Each call of the returned function is one handle:
 * its `stop()` lets go of the source, once however often it's called, and the source itself
 * stops when the last handle has. Access listeners belong to the handle that added them and go
 * when it does.
 */
export function sharedLocation(start: () => LocationSource): () => LocationSource {
  let source: LocationSource | null = null
  let holders = 0
  /**
   * The fix under way, if any: two handles asking meanwhile share it rather than each asking the
   * helper (a fix takes seconds and uses the radios) and it's cleared as it lands.
   */
  let locating: Promise<LocateResult> | null = null

  function release(): void {
    holders -= 1
    if (holders > 0) return
    const ending = source
    source = null
    // A fix under way belongs to the source that's going; the next one's start over.
    locating = null
    ending?.stop()
  }

  return () => {
    // Counted only once it has started, so a source that fails to start holds nothing.
    source ??= start()
    holders += 1
    // The source can't change while this handle holds it, so it's kept here.
    const held = source
    let stopped = false
    const listening = new Set<() => void>()

    return {
      access: () => (stopped ? null : held.access()),
      onAccess(listener) {
        if (stopped) return () => undefined
        const unlisten = held.onAccess(listener)
        listening.add(unlisten)
        return () => {
          listening.delete(unlisten)
          unlisten()
        }
      },
      requestAccess() {
        if (!stopped) held.requestAccess()
      },
      locate() {
        if (stopped) return Promise.resolve(failed())
        if (!locating) {
          const request = held.locate()
          locating = request
          const done = (): void => {
            if (locating === request) locating = null
          }
          // Registered before any caller's own wait, so a caller that asks again straight away
          // starts a new fix instead of getting the old one back.
          request.then(done, done)
        }
        return locating
      },
      placeName(position) {
        if (stopped) return Promise.reject(new Error('The place couldn’t be looked up.'))
        return held.placeName(position)
      },
      stop() {
        if (stopped) return
        stopped = true
        for (const unlisten of listening) unlisten()
        listening.clear()
        release()
      }
    }
  }
}
