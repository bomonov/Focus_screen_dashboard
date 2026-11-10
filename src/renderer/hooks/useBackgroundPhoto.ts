import { useEffect, useState } from 'react'

/**
 * The saved background photo as a data URL. Only read while `enabled`: it can be a few MB,
 * and there's no point holding it while the background is something else.
 */
export function useBackgroundPhoto(enabled: boolean): string | null {
  const [photo, setPhoto] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let active = true
    let pushed = false
    const unsubscribe = window.focusScreen.onBackgroundPhotoChanged((next) => {
      pushed = true
      setPhoto(next)
    })
    window.focusScreen
      .getBackgroundPhoto()
      .then((initial) => {
        if (active && !pushed) setPhoto(initial)
      })
      .catch((error: unknown) => console.error(error))
    return () => {
      active = false
      unsubscribe()
    }
  }, [enabled])

  return enabled ? photo : null
}
