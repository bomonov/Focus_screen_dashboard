import { useEffect, useRef, useState } from 'react'
import type { BackgroundMode, SettingsPatch, ThemeSettings } from '../../../main/ipc'
import { useBackgroundPhoto } from '../../hooks/useBackgroundPhoto'
import { ACCENT_SWATCHES, PRESETS } from '../../theme/presets'
import { PillGroup, Section, ToggleRow } from './controls'
import { QuickMenuSize } from './QuickMenuSize'
import { PlusIcon } from '../../widgets/icons'

/** The native color panel sends a change per drag step; save once it settles. */
const COLOR_SAVE_DELAY_MS = 200

const BACKGROUNDS = [
  { value: 'solid', label: 'Solid' },
  { value: 'art', label: 'Blur album art' },
  { value: 'living', label: 'Living album colors' },
  { value: 'photo', label: 'Your photo' }
] as const

export function ThemeSection({
  theme,
  update
}: {
  theme: ThemeSettings
  update: (patch: SettingsPatch) => void
}): React.JSX.Element {
  return (
    <Section title="Theme">
      <div className="customize__themes">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="customize__theme"
            aria-pressed={theme.preset === preset.id}
            // A theme comes with its own accent; pick another one afterwards if you like.
            onClick={() => update({ theme: { preset: preset.id, accent: preset.accent } })}
          >
            <span
              className="customize__theme-swatch"
              aria-hidden="true"
              style={{ background: preset.colors.bg }}
            >
              <span style={{ width: '60%', background: preset.colors.card }} />
              <span style={{ width: '35%', background: preset.accent }} />
            </span>
            <span>{preset.label}</span>
          </button>
        ))}
      </div>
      <AccentPicker theme={theme} update={update} />
      <BackgroundPicker theme={theme} update={update} />
      <div className="customize__rows customize__rows--ruled">
        <ToggleRow
          label="Glass cards"
          hint="See-through, frosted cards; best over blurred album art or your photo"
          on={theme.glass}
          onToggle={(glass) => update({ theme: { glass } })}
        />
      </div>
      <QuickMenuSize scale={theme.quickMenuScale} update={update} />
    </Section>
  )
}

function AccentPicker({
  theme,
  update
}: {
  theme: ThemeSettings
  update: (patch: SettingsPatch) => void
}): React.JSX.Element {
  const accent = theme.accent.toUpperCase()
  const isSwatch = ACCENT_SWATCHES.some((swatch) => swatch.color === accent)
  const [draft, setDraft] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(saveTimer.current), [])

  function pickCustom(color: string): void {
    setDraft(color)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => update({ theme: { accent: color } }), COLOR_SAVE_DELAY_MS)
  }

  return (
    <div className="customize__group">
      <span className="customize__group-label" id="accent-label">
        Accent
      </span>
      <div className="customize__swatches" role="group" aria-labelledby="accent-label">
        {ACCENT_SWATCHES.map((swatch) => (
          <button
            key={swatch.color}
            type="button"
            className="customize__swatch"
            aria-label={swatch.label}
            aria-pressed={accent === swatch.color}
            style={{ background: swatch.color }}
            onClick={() => update({ theme: { accent: swatch.color } })}
          />
        ))}
        <label
          className="customize__swatch customize__swatch--custom"
          aria-pressed={!isSwatch}
          title="Any color"
          style={isSwatch ? undefined : { background: accent }}
        >
          <input
            type="color"
            className="customize__color-input"
            aria-label="Choose any accent color"
            // <input type=color> only takes lowercase #rrggbb.
            value={(draft ?? accent).toLowerCase()}
            onChange={(event) => pickCustom(event.target.value.toUpperCase())}
            onBlur={() => setDraft(null)}
          />
          {isSwatch && <PlusIcon />}
        </label>
      </div>
      {theme.accentFromArt && (
        <span className="customize__hint">
          Match accent to album art is on, so this color shows when a song has no cover.
        </span>
      )}
    </div>
  )
}

function BackgroundPicker({
  theme,
  update
}: {
  theme: ThemeSettings
  update: (patch: SettingsPatch) => void
}): React.JSX.Element {
  const photo = useBackgroundPhoto(true)
  const [message, setMessage] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)

  async function choosePhoto(): Promise<void> {
    if (choosing) return
    setChoosing(true)
    setMessage(null)
    const result = await window.focusScreen
      .chooseBackgroundPhoto()
      .catch(() => ({ ok: false as const, message: 'Something went wrong. Try again.' }))
    setChoosing(false)
    // Main switches the background to the photo itself once it's saved.
    if (!result.ok && result.message) setMessage(result.message)
  }

  function pick(mode: BackgroundMode): void {
    setMessage(null)
    if (mode === 'photo' && !photo) void choosePhoto()
    else update({ theme: { background: mode } })
  }

  return (
    <PillGroup label="Background" options={BACKGROUNDS} value={theme.background} onPick={pick}>
      {theme.background === 'art' && (
        <span className="customize__hint customize__hint--wide">
          Shows while a song with a cover is playing.
        </span>
      )}
      {theme.background === 'living' && (
        <span className="customize__hint customize__hint--wide">
          The song’s colors drift slowly behind the cards, and rest while the music is paused.
        </span>
      )}
      {theme.background === 'photo' && (
        <span className="customize__photo">
          {photo && (
            <img className="customize__photo-thumb" src={photo} alt="Your background photo" />
          )}
          <button
            type="button"
            className="customize__button"
            disabled={choosing}
            onClick={() => void choosePhoto()}
          >
            Choose another photo…
          </button>
        </span>
      )}
      {message && (
        <span className="customize__error customize__hint--wide" role="alert">
          {message}
        </span>
      )}
    </PillGroup>
  )
}
