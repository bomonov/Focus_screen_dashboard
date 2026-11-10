import type { Place } from '../../../main/ipc'
import type { RowIconKind } from './placeRowsView'

const STROKE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
} as const

/** The trip search's magnifying glass. */
export function SearchIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} {...STROKE}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  )
}

/** Where a trip goes: a house for Home, a book for the next class, a pin for anywhere else. */
export function PlaceIcon({
  kind,
  className
}: {
  kind: Place['kind']
  className?: string
}): React.JSX.Element {
  if (kind === 'home') {
    return (
      <svg className={className} {...STROKE}>
        <path d="M4 11l8-6 8 6v8H4z" />
        <path d="M10 19v-5h4v5" />
      </svg>
    )
  }
  if (kind === 'class') {
    return (
      <svg className={className} {...STROKE}>
        <path d="M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2Z" />
        <path d="M12 6.5v13" />
      </svg>
    )
  }
  return (
    <svg className={className} {...STROKE}>
      <path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  )
}

/** A row's icon: Home, the class, a saved or found place, a recent one, a building, a stop, here. */
export function RowIcon({
  kind,
  className
}: {
  kind: RowIconKind
  className?: string
}): React.JSX.Element {
  switch (kind) {
    case 'home':
    case 'class':
    case 'saved':
    case 'apple':
      return <PlaceIcon kind={kind} className={className} />
    case 'recent':
      return (
        <svg className={className} {...STROKE}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      )
    case 'building':
      return (
        <svg className={className} {...STROKE}>
          <path d="M5 20V6l7-2v16M12 8l7 2v10M3 20h18" />
          <path d="M8 9v.01M8 12.5v.01M8 16v.01M15.5 13v.01M15.5 16.5v.01" />
        </svg>
      )
    case 'stop':
      return (
        <svg className={className} {...STROKE}>
          <rect x="5" y="4" width="14" height="13" rx="2.5" />
          <path d="M5 11h14M8.5 17v2.5M15.5 17v2.5" />
          <path d="M8.5 14.2v.01M15.5 14.2v.01" />
        </svg>
      )
    case 'here':
      return (
        <svg className={className} {...STROKE}>
          <path d="M20 4 4 10.5l7 2.5 2.5 7z" />
        </svg>
      )
  }
}

/** A walk: a figure mid-stride. */
export function WalkIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} {...STROKE}>
      <circle cx="13" cy="4.5" r="1.8" />
      <path d="M10 21l2-6 3 3v3M12 15l-1-5 4 1.5 2.5 3M11 10l-3 2v3" />
    </svg>
  )
}

/** A live time: a dot sending out waves, so "live" isn't told by its green alone. */
export function LiveIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} {...STROKE}>
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <path d="M8 8a5.5 5.5 0 0 0 0 8M16 8a5.5 5.5 0 0 1 0 8" />
    </svg>
  )
}
