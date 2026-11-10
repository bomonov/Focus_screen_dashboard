import type { MusicSettings, SettingsPatch, ThemeSettings } from '../../../main/ipc'
import { useAutoSync } from '../../hooks/useAutoSync'
import { useCoverEditor } from '../../hooks/useCoverEditor'
import { useCoverMotion } from '../../hooks/useCoverMotion'
import { useMusic } from '../../hooks/useMusic'
import { usePrepare } from '../../hooks/usePrepare'
import { useEffect, useId, useRef, useState } from 'react'
import { PillGroup, Section, ToggleRow } from './controls'
import { CoverPartsEditor } from './CoverPartsEditor'
import {
  autoSyncRow,
  lyricsChoice,
  movingPartsRow,
  lyricsPatch,
  motionStrengthFromSlider,
  motionStrengthLabel,
  PREPARE_AWAY_HINT,
  prepareRow
} from './customizeView'

export function MusicSection({
  music,
  theme,
  update
}: {
  music: MusicSettings
  theme: ThemeSettings
  update: (patch: SettingsPatch) => void
}): React.JSX.Element {
  const autoSyncState = useAutoSync()
  const autoSync = autoSyncRow(autoSyncState)
  const prepare = prepareRow(usePrepare(), autoSyncState, useMusic(), music.prepareWhenAway)
  return (
    <Section title="Music">
      <PillGroup
        label="Lyrics"
        options={[
          { value: 'synced', label: 'Synced' },
          { value: 'full', label: 'Full text' },
          { value: 'off', label: 'Off' }
        ]}
        value={lyricsChoice(music)}
        onPick={(choice) => update({ music: lyricsPatch(choice) })}
      />
      <PillGroup
        label="Cover"
        options={[
          { value: 'record', label: 'Spinning record' },
          { value: 'animated', label: 'Animated cover' }
        ]}
        value={music.cover}
        onPick={(cover) => update({ music: { cover } })}
      />
      {music.cover === 'record' ? (
        <PillGroup
          label="Disc spin"
          options={[
            { value: 'slow', label: 'Slow' },
            { value: 'normal', label: 'Normal' },
            { value: 'still', label: 'Still' }
          ]}
          value={music.spinSpeed}
          onPick={(spinSpeed) => update({ music: { spinSpeed } })}
        />
      ) : (
        <PillGroup
          label="Cover light"
          options={[
            { value: 'none', label: 'None' },
            { value: 'sheen', label: 'Sheen' },
            { value: 'sparkle', label: 'Sparkle' }
          ]}
          value={music.coverLight}
          onPick={(coverLight) => update({ music: { coverLight } })}
        />
      )}
      {music.cover === 'animated' && <MovingParts music={music} update={update} />}
      <div className="customize__rows customize__rows--ruled">
        {music.cover === 'animated' && (
          <ToggleRow
            label="Backlight"
            hint="The cover’s colors glowing softly behind it"
            on={music.coverGlow}
            onToggle={(coverGlow) => update({ music: { coverGlow } })}
          />
        )}
        <ToggleRow
          label="Romaji under Japanese lyrics"
          hint="From VocaDB, which gets the song’s title to find them, or made on this computer from a dictionary for songs it hasn’t got"
          on={music.romaji}
          onToggle={(romaji) => update({ music: { romaji } })}
        />
        <ToggleRow
          label="Match accent to album art"
          hint="Takes the accent color from the song’s cover"
          on={theme.accentFromArt}
          onToggle={(accentFromArt) => update({ theme: { accentFromArt } })}
        />
        {autoSync && (
          <ToggleRow
            label="Auto-sync plain lyrics"
            hint={autoSync.hint}
            detail={autoSync.detail}
            disabled={!autoSync.installed && !music.autoSync}
            on={music.autoSync}
            onToggle={(on) => update({ music: { autoSync: on } })}
          />
        )}
        {autoSync?.openSettings && (
          <div className="customize__row">
            <span className="customize__toggle-text">
              <span>Let Focus Screen Audio listen</span>
              <span className="customize__hint">
                Privacy &amp; Security › Screen &amp; System Audio Recording
              </span>
            </span>
            <button
              type="button"
              className="customize__button"
              onClick={() => window.focusScreen.openAudioCaptureSettings()}
            >
              Open System Settings
            </button>
          </div>
        )}
        {prepare && (
          <div className="customize__row">
            <span className="customize__toggle-text">
              <span>Prepare playlist</span>
              <span className="customize__hint">{prepare.hint}</span>
            </span>
            <button
              type="button"
              className="customize__button"
              disabled={!prepare.enabled}
              onClick={() => window.focusScreen.sendPrepareCommand({ kind: prepare.action })}
            >
              {prepare.action === 'stop' ? 'Stop' : 'Start'}
            </button>
          </div>
        )}
        {prepare && (
          <ToggleRow
            label="Prepare while I’m away"
            hint={PREPARE_AWAY_HINT}
            on={music.prepareWhenAway}
            onToggle={(on) => update({ music: { prepareWhenAway: on } })}
          />
        )}
        <ToggleRow
          label="Show player name"
          hint="“Now playing · Apple Music”"
          on={music.showPlayerName}
          onToggle={(showPlayerName) => update({ music: { showPlayerName } })}
        />
        <div className="customize__row">
          <span className="customize__toggle-text">
            <span>YouTube Music</span>
            <span className="customize__hint">
              In Chrome or Safari, through the Focus Screen extension
            </span>
          </span>
          <button
            type="button"
            className="customize__button"
            onClick={() => window.focusScreen.pairBrowser()}
          >
            Pair browser…
          </button>
        </div>
      </div>
    </Section>
  )
}

/** The animated cover's moving parts: on or off, and the editor that picks them. */
function MovingParts({
  music,
  update
}: {
  music: MusicSettings
  update: (patch: SettingsPatch) => void
}): React.JSX.Element | null {
  const motion = useCoverMotion()
  const editor = useCoverEditor()
  if (!motion || motion.setup === 'unsupported') return null
  const parts = movingPartsRow(motion.setup)
  return (
    <div className="customize__rows customize__rows--ruled">
      <ToggleRow
        label="Moving parts"
        hint={parts.hint}
        detail={parts.detail}
        // Turning it off stays possible; turning it on waits for the add-on.
        disabled={!parts.installed && !music.movingParts}
        on={music.movingParts}
        onToggle={(movingParts) => update({ music: { movingParts } })}
      />
      {motion.available && (
        <div className="customize__row">
          <span className="customize__toggle-text">
            <span>Pick the parts that move</span>
            <span className="customize__hint">On the cover that’s playing now</span>
          </span>
          <button
            type="button"
            className="customize__button"
            disabled={editor?.open ?? false}
            onClick={() => window.focusScreen.sendCoverEditorCommand({ kind: 'open' })}
          >
            Edit moving parts…
          </button>
        </div>
      )}
      {motion.available && <MotionStrength strength={music.motionStrength} update={update} />}
      {motion.available && <CoverPartsEditor strength={music.motionStrength} />}
    </div>
  )
}

/** A drag sends a value per step; save once it settles, as the menu size slider does. */
const SAVE_DELAY_MS = 200

/**
 * How far the moving parts move, live on the Focus Screen and in the editor's preview. Only the
 * distance changes, never the rhythm: quicker loops were what made the first animated cover dizzy.
 */
function MotionStrength({
  strength,
  update
}: {
  strength: number
  update: (patch: SettingsPatch) => void
}): React.JSX.Element {
  const id = useId()
  const [draft, setDraft] = useState<number | null>(null)
  const [saved, setSaved] = useState(strength)
  if (strength !== saved) {
    setSaved(strength)
    if (draft === strength) setDraft(null)
  }
  const shown = draft ?? strength
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  function slide(tenths: number): void {
    const next = motionStrengthFromSlider(tenths)
    setDraft(next)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => update({ music: { motionStrength: next } }), SAVE_DELAY_MS)
  }

  const fill = ((shown - 0.5) / 2) * 100
  return (
    <div className="customize__group">
      <div className="menu-size__heading">
        <label className="customize__group-label" htmlFor={id}>
          How much the parts move
        </label>
        <output className="menu-size__value" htmlFor={id}>
          {motionStrengthLabel(shown)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="customize__slider"
        min={5}
        max={25}
        step={1}
        value={Math.round(shown * 10)}
        aria-valuetext={motionStrengthLabel(shown)}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
        onChange={(event) => slide(Number(event.target.value))}
      />
    </div>
  )
}
