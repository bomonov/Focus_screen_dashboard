import { useEffect, useId, useRef, useState } from 'react'
import type { Settings, SettingsPatch } from '../../main/ipc'
import { useCalendar } from '../hooks/useCalendar'
import { useTodos } from '../hooks/useTodos'
import { useWeather } from '../hooks/useWeather'
import { DisplaySection } from './customize/DisplaySection'
import { MusicSection } from './customize/MusicSection'
import { NextBusSection } from './customize/NextBusSection'
import { NextClassSection } from './customize/NextClassSection'
import { ShortcutsSection } from './customize/ShortcutsSection'
import { SourcesSection } from './customize/SourcesSection'
import { ThemeSection } from './customize/ThemeSection'
import { TimerSection } from './customize/TimerSection'
import { TripsSection } from './customize/TripsSection'
import { WeatherSection } from './customize/WeatherSection'
import { WidgetsSection } from './customize/WidgetsSection'
import './Customize.css'

/** Every change goes straight to main, which saves it and updates both windows. */
function update(patch: SettingsPatch): void {
  window.focusScreen.updateSettings(patch)
}

/** The sections, in the sidebar's order; one shows at a time, as in the Mac's own Settings. */
const SECTIONS = [
  { id: 'theme', label: 'Theme' },
  { id: 'widgets', label: 'Widgets' },
  { id: 'class', label: 'Next class' },
  { id: 'bus', label: 'Next bus' },
  { id: 'weather', label: 'Weather' },
  { id: 'trips', label: 'Trips' },
  { id: 'timer', label: 'Timer' },
  { id: 'music', label: 'Music' },
  { id: 'sources', label: 'To-do sources' },
  { id: 'display', label: 'Display' },
  { id: 'shortcuts', label: 'Shortcuts' }
] as const
type SectionId = (typeof SECTIONS)[number]['id']

/** The last section open, so Customize comes back where it was left (this Mac only). */
const REMEMBER = 'customize.section'

function remembered(): SectionId {
  try {
    const saved = window.localStorage.getItem(REMEMBER)
    return SECTIONS.find((section) => section.id === saved)?.id ?? 'theme'
  } catch {
    return 'theme'
  }
}

export function Customize({ settings }: { settings: Settings | null }): React.JSX.Element {
  const todos = useTodos()
  const calendar = useCalendar()
  const weather = useWeather()
  // Weather only where there's a location to read (macOS with its helper); shown until main says.
  const sections = SECTIONS.filter(
    (section) => section.id !== 'weather' || weather === null || weather.supported
  )
  const [chosen, setOpen] = useState<SectionId>(remembered)
  const open = sections.some((section) => section.id === chosen) ? chosen : 'theme'
  const openIndex = sections.findIndex((section) => section.id === open)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const paneRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  // Which ends of the narrow strip have sections past them, so only those ends fade.
  const [more, setMore] = useState({ before: false, after: false })
  const id = useId()

  // In the narrow strip, the open section's tab is kept in view (it can be past the edge), also
  // when the window is made narrow after picking it.
  useEffect(() => {
    const reveal = (): void =>
      tabs.current[openIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    reveal()
    window.addEventListener('resize', reveal)
    return () => window.removeEventListener('resize', reveal)
  }, [openIndex])

  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const measure = (): void => {
      // By the first and last tabs' edges, not the scroll position: the strip's padding (room
      // for focus rings) is scroll room no tab is in. A pixel of slack for fractions.
      const box = strip.getBoundingClientRect()
      const first = tabs.current[0]?.getBoundingClientRect()
      // The last tab there is: Weather's comes and goes, leaving its slot empty.
      const last = tabs.current
        .filter((tab) => tab !== null)
        .at(-1)
        ?.getBoundingClientRect()
      const before = first !== undefined && first.left < box.left - 1
      const after = last !== undefined && last.right > box.right + 1
      setMore((was) => (was.before === before && was.after === after ? was : { before, after }))
    }
    measure()
    strip.addEventListener('scroll', measure, { passive: true })
    const resized = new ResizeObserver(measure)
    resized.observe(strip)
    return () => {
      strip.removeEventListener('scroll', measure)
      resized.disconnect()
    }
  }, [])

  function show(next: SectionId): void {
    // Each section starts at its top, not wherever the last one was scrolled to.
    if (next !== open) paneRef.current?.scrollTo({ top: 0 })
    setOpen(next)
    try {
      window.localStorage.setItem(REMEMBER, next)
    } catch {
      // Not kept; it opens on Theme next time.
    }
  }

  /** Up and down (or left and right, when the list runs across the top) move between sections. */
  function onKey(event: React.KeyboardEvent, index: number): void {
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0
    const jump = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : null
    if (step === 0 && jump === null) return
    event.preventDefault()
    const next = jump ?? (index + step + sections.length) % sections.length
    const section = sections[next]
    if (!section) return
    show(section.id)
    tabs.current[next]?.focus()
  }

  function pane(section: SectionId, s: Settings): React.JSX.Element {
    switch (section) {
      case 'theme':
        return <ThemeSection theme={s.theme} update={update} />
      case 'widgets':
        return <WidgetsSection widgets={s.widgets} todos={todos} update={update} />
      case 'class':
        return <NextClassSection settings={s} calendar={calendar} update={update} />
      case 'bus':
        return <NextBusSection settings={s} update={update} />
      case 'weather':
        return <WeatherSection settings={s} update={update} />
      case 'trips':
        return <TripsSection settings={s} update={update} />
      case 'timer':
        return <TimerSection timer={s.timer} update={update} />
      case 'music':
        return <MusicSection music={s.music} theme={s.theme} update={update} />
      case 'sources':
        return <SourcesSection todos={todos} />
      case 'display':
        return <DisplaySection display={s.display} update={update} />
      case 'shortcuts':
        return <ShortcutsSection hotkeys={s.hotkeys} update={update} />
    }
  }

  return (
    <div className="customize">
      <nav className="customize__nav" aria-label="Customize">
        <div className="customize__header">
          <h1 className="customize__title">Customize</h1>
          <button
            type="button"
            className="customize__done"
            onClick={() => window.focusScreen.closeCustomize()}
          >
            Done
          </button>
        </div>
        <div
          ref={stripRef}
          className="customize__tabs"
          role="tablist"
          aria-orientation="vertical"
          data-more-before={more.before || undefined}
          data-more-after={more.after || undefined}
        >
          {sections.map((section, index) => (
            <button
              key={section.id}
              ref={(element) => {
                tabs.current[index] = element
              }}
              type="button"
              role="tab"
              id={`${id}-${section.id}`}
              className="customize__tab"
              aria-selected={open === section.id}
              aria-controls={`${id}-pane`}
              tabIndex={open === section.id ? 0 : -1}
              onClick={() => show(section.id)}
              onKeyDown={(event) => onKey(event, index)}
            >
              {section.label}
            </button>
          ))}
        </div>
      </nav>
      <div
        ref={paneRef}
        className="customize__pane"
        role="tabpanel"
        id={`${id}-pane`}
        aria-labelledby={`${id}-${open}`}
      >
        {settings && pane(open, settings)}
      </div>
    </div>
  )
}
