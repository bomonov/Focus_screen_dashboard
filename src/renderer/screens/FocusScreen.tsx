import type { ScreenCare, Settings, WidgetSettings } from '../../main/ipc'
import { useGlassMenus } from '../hooks/useGlassMenus'
import { usePlacement } from '../hooks/usePlacement'
import { useSpacePlayPause } from '../hooks/useSpacePlayPause'
import { CardMenu } from '../widgets/cardMenu/CardMenu'
import { IdleView } from '../widgets/IdleView'
import { NextBus } from '../widgets/nextBus/NextBus'
import { NextShuttle } from '../widgets/nextBus/NextShuttle'
import { NextClass } from '../widgets/nextClass/NextClass'
import { TopBar } from '../widgets/TopBar'
import { TripBubble } from '../widgets/trips/TripBubble'
import { WeatherPill } from '../widgets/weather/WeatherPill'
import { CardArea } from './layout/CardArea'
import { LyricsPickerHost } from '../widgets/music/LyricsPickerHost'
import './FocusScreen.css'

/** No order of the user's yet: soonest first. One array, so the pill can tell it hasn't changed. */
const NO_ORDER: readonly string[] = []

/** Everything shows until settings arrive, so the first paint matches the usual screen. */
const ALL_WIDGETS: WidgetSettings = {
  music: true,
  todos: true,
  timer: true,
  clock: true,
  nextClass: false,
  nextBus: false,
  weather: false,
  trips: false,
  layout: null
}

interface FocusScreenProps {
  /** null until the main process answers. */
  settings: Settings | null
  care: ScreenCare | null
  /** The cards are being moved and resized. */
  editing: boolean
}

export function FocusScreen({ settings, care, editing }: FocusScreenProps): React.JSX.Element {
  const placement = usePlacement()
  // Only here: in Customize, Space flips the switch it's on.
  useSpacePlayPause()
  const widgets = settings?.widgets ?? ALL_WIDGETS
  const dimmed = (care?.dimmed ?? false) && !editing
  const menus = useGlassMenus(editing, dimmed, settings?.theme.quickMenuScale ?? 1)
  const shift = care?.shift ?? { x: 0, y: 0 }
  // Burn-in protection moves everything, the idle clock included.
  const style = { transform: `translate(${shift.x}px, ${shift.y}px)` }

  if (dimmed) {
    return (
      <div className="focus-screen" style={style}>
        <IdleView />
      </div>
    )
  }

  return (
    <div className="focus-screen" style={style}>
      <TopBar
        placementLabel={placement?.label ?? null}
        showClock={widgets.clock}
        onCustomize={() => window.focusScreen.openCustomize()}
        layoutEditing={
          editing
            ? {
                custom: widgets.layout !== null,
                reset: () => window.focusScreen.updateSettings({ widgets: { layout: null } }),
                done: () => window.focusScreen.setLayoutEditing(false)
              }
            : null
        }
        // Arranging cards needs the room, and the class isn't what you're looking at then.
        nextClass={
          widgets.nextClass && !editing ? (
            <NextClass picked={settings?.nextClass.calendars ?? []} />
          ) : null
        }
        nextBus={
          widgets.nextBus && !editing ? (
            <>
              <NextBus order={settings?.nextBus.order ?? NO_ORDER} />
              <NextShuttle />
            </>
          ) : null
        }
        weather={
          widgets.weather && !editing ? <WeatherPill unit={settings?.weather.unit ?? 'f'} /> : null
        }
        trips={widgets.trips && !editing ? <TripBubble /> : null}
      />
      <CardArea
        widgets={widgets}
        music={settings?.music ?? null}
        timer={settings?.timer ?? null}
        editing={editing}
        menuCard={menus.open?.card ?? null}
        onOpenMenu={menus.openCard}
      />
      {menus.open && (
        <CardMenu key={menus.open.menu.token} open={menus.open} onClosed={menus.closed} />
      )}
      <LyricsPickerHost />
    </div>
  )
}
