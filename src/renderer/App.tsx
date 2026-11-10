import type { Settings } from '../main/ipc'
import { useArtAccent } from './hooks/useArtAccent'
import { useBackgroundPhoto } from './hooks/useBackgroundPhoto'
import { useLayoutEditing } from './hooks/useLayoutEditing'
import { useMusic } from './hooks/useMusic'
import { usePointerRest } from './hooks/usePointerRest'
import { useScreenCare } from './hooks/useScreenCare'
import { useSettings } from './hooks/useSettings'
import { useThemeVariables, type GlassLook } from './hooks/useThemeVariables'
import { useTimerChime } from './hooks/useTimerChime'
import { Backdrop } from './screens/Backdrop'
import { backdropFor } from './screens/backdropView'
import { Customize } from './screens/Customize'
import { FocusScreen } from './screens/FocusScreen'
import { LyricsEditor } from './screens/LyricsEditor'
import { CardGroundContext } from './theme/cardGround'
import { cardGround, presetInfo } from './theme/presets'

/** Which window this page is in; main puts it in the URL hash. */
export type View = 'focus' | 'customize' | 'lyrics-editor'

export function App({ view }: { view: View }): React.JSX.Element {
  const settings = useSettings()
  switch (view) {
    case 'customize':
      return <CustomizeWindow settings={settings} />
    case 'lyrics-editor':
      return <LyricsEditorWindow settings={settings} />
    case 'focus':
      return <FocusWindow settings={settings} />
  }
}

function FocusWindow({ settings }: { settings: Settings | null }): React.JSX.Element {
  const theme = settings?.theme ?? null
  const music = useMusic()
  const track = music?.track ?? null
  const artwork = track?.artwork ?? null
  const photo = useBackgroundPhoto(theme?.background === 'photo')
  const care = useScreenCare()
  const editing = useLayoutEditing()
  const backdrop = care?.dimmed ? null : backdropFor(theme?.background, track, photo)
  const glass: GlassLook = !theme?.glass ? 'off' : backdrop?.kind === 'photo' ? 'frosted' : 'clear'
  useThemeVariables(
    theme,
    useArtAccent(artwork, theme?.accentFromArt ?? false),
    backdrop !== null,
    glass
  )
  // The same ground themeVariables fits its colors to, for the colors fitted in the cards.
  const ground = theme
    ? cardGround(theme, glass !== 'off' && backdrop !== null)
    : presetInfo('night').colors.card
  // Here rather than in the Timer card, so the chime still sounds if that card is hidden.
  useTimerChime()
  // The pointer is the tool while cards are being arranged.
  usePointerRest((settings?.display.hideCursor ?? false) && !editing)

  return (
    <>
      {backdrop && <Backdrop view={backdrop} playing={music?.playing ?? false} />}
      <CardGroundContext.Provider value={ground}>
        <FocusScreen settings={settings} care={care} editing={editing} />
      </CardGroundContext.Provider>
    </>
  )
}

/** The ordinary windows next to the Focus Screen wear its theme and accent. */
function useSideWindowTheme(settings: Settings | null): void {
  const theme = settings?.theme ?? null
  const artwork = useMusic()?.track?.artwork ?? null
  // Same accent as the Focus Screen, so what you pick here is what you see there.
  useThemeVariables(theme, useArtAccent(artwork, theme?.accentFromArt ?? false), false)
}

function CustomizeWindow({ settings }: { settings: Settings | null }): React.JSX.Element {
  useSideWindowTheme(settings)
  return <Customize settings={settings} />
}

function LyricsEditorWindow({ settings }: { settings: Settings | null }): React.JSX.Element {
  useSideWindowTheme(settings)
  return <LyricsEditor settings={settings} />
}
