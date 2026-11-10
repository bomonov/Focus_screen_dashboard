import { useEffect } from 'react'

/** What the Space check needs to know about a key press. */
export interface KeyPress {
  key: string
  repeat: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  target: { tagName?: string; isContentEditable?: boolean } | null
}

/** Places that take typed text, where a space is a space. */
const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** The keys are going into a field (the Canvas form's, the trip search's): its own to handle. */
export function isTyping(target: KeyPress['target']): boolean {
  return target?.isContentEditable === true || TYPING.has(target?.tagName ?? '')
}

/**
 * Space plays and pauses, as in music apps: but not held down (it'd stutter), not with a
 * modifier (those are other shortcuts), and not while typing (the Canvas form's fields).
 */
export function isPlayPauseKey(press: KeyPress): boolean {
  if (press.key !== ' ' || press.repeat) return false
  if (press.metaKey || press.ctrlKey || press.altKey) return false
  return !isTyping(press.target)
}

/** A browser key event as the check sees it (its fields are getters, so spreading loses them). */
function pressOf(event: KeyboardEvent): KeyPress {
  return {
    key: event.key,
    repeat: event.repeat,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    target: event.target instanceof HTMLElement ? event.target : null
  }
}

/** Space plays and pauses the song on the Focus Screen. */
export function useSpacePlayPause(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const press = pressOf(event)
      // Held down: one press is enough, and a focused button mustn't be pressed over and over.
      if (isPlayPauseKey({ ...press, repeat: false }) && press.repeat) {
        event.preventDefault()
        return
      }
      if (!isPlayPauseKey(press)) return
      // A button clicked last keeps the focus, and Space would press it again (Next, say).
      event.preventDefault()
      window.focusScreen.sendMusicCommand({ kind: 'playPause' })
    }
    // Space presses a focused button when it's let go, so that's held back too.
    const onKeyUp = (event: KeyboardEvent): void => {
      if (isPlayPauseKey({ ...pressOf(event), repeat: false })) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])
}
