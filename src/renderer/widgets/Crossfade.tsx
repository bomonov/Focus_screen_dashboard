import { useCallback, useLayoutEffect, useRef, useState } from 'react'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

interface Layer<T> {
  /**
   * Its own, never reused: a picture that comes back while the old one is still below (the next
   * song from the same album, after a stand-in) fades in as a new layer, and the old one goes.
   */
  id: number
  key: string
  value: T
  /** Came after the first: fades in. The first one (a launch) just shows. */
  fresh: boolean
}

interface CrossfadeProps<T> {
  /** null: nothing to show, and any layers go at once. */
  value: T | null
  /** What makes it a new picture (a song, a cover arriving): a new key fades in over the old. */
  itemKey: string
  className: string
  keyframes: Keyframe[]
  timing: KeyframeAnimationOptions
  /** Resolves when a new layer's picture is ready to show, so it never fades in blank. */
  ready?: (element: HTMLElement) => Promise<unknown>
  children: (value: T) => React.ReactNode
}

/**
 * Crossfades a picture: each new `itemKey` adds a layer on top that fades in over the one below,
 * which goes once the new one is fully in. At most the old and the new are drawn at once.
 */
export function Crossfade<T>({
  value,
  itemKey,
  className,
  keyframes,
  timing,
  ready,
  children
}: CrossfadeProps<T>): React.JSX.Element {
  const [state, setState] = useState<{ key: string; next: number; layers: Layer<T>[] }>(() => ({
    key: itemKey,
    next: 1,
    layers: value === null ? [] : [{ id: 0, key: itemKey, value, fresh: false }]
  }))
  if (itemKey !== state.key) {
    const below = state.layers.filter((layer) => layer.key !== itemKey).slice(-1)
    setState({
      key: itemKey,
      next: state.next + 1,
      layers: value === null ? [] : [...below, { id: state.next, key: itemKey, value, fresh: true }]
    })
  }
  const shown = useCallback((id: number) => {
    setState((current) => {
      const at = current.layers.findIndex((layer) => layer.id === id)
      return at > 0 ? { ...current, layers: current.layers.slice(at) } : current
    })
  }, [])

  return (
    <>
      {state.layers.map((layer) => (
        <FadeIn
          key={layer.id}
          fresh={layer.fresh}
          className={className}
          keyframes={keyframes}
          timing={timing}
          ready={ready}
          onShown={() => shown(layer.id)}
        >
          {children(layer.value)}
        </FadeIn>
      ))}
    </>
  )
}

function FadeIn({
  fresh,
  className,
  keyframes,
  timing,
  ready,
  onShown,
  children
}: {
  fresh: boolean
  className: string
  keyframes: Keyframe[]
  timing: KeyframeAnimationOptions
  ready?: (element: HTMLElement) => Promise<unknown>
  onShown(): void
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  // A layer fades in once, as it mounts; what it was mounted with is what counts.
  const [mounted] = useState({ fresh, keyframes, timing, ready, onShown })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element || !mounted.fresh) return
    if (reducedMotion.matches) {
      mounted.onShown()
      return
    }
    let live = true
    let animation: Animation | null = null
    element.style.opacity = '0'
    void (mounted.ready?.(element) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => {
        if (!live) return
        element.style.opacity = ''
        animation = element.animate(mounted.keyframes, mounted.timing)
        animation.onfinish = () => {
          if (live) mounted.onShown()
        }
      })
    return () => {
      live = false
      animation?.cancel()
    }
  }, [mounted])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
