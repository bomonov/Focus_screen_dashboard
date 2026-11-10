import type { HotkeySettings, SettingsPatch } from '../../../main/ipc'
import { useHotkeys } from '../../hooks/useHotkeys'
import { Section, ToggleRow } from './controls'
import { hotkeyNote } from './customizeView'

export function ShortcutsSection({
  hotkeys,
  update
}: {
  hotkeys: HotkeySettings
  update: (patch: SettingsPatch) => void
}): React.JSX.Element {
  const state = useHotkeys()

  return (
    <Section title="Keyboard shortcuts">
      <div className="customize__rows">
        <ToggleRow
          label="Work in any app"
          hint="Control the Focus Screen while you type somewhere else"
          on={hotkeys.enabled}
          onToggle={(enabled) => update({ hotkeys: { enabled } })}
        />
      </div>
      {state && (
        <dl className="customize__keys" aria-disabled={!state.enabled}>
          {state.hotkeys.map((hotkey) => {
            const note = hotkeyNote(state, hotkey)
            return (
              <div key={hotkey.action} className="customize__key-row">
                <dt className="customize__toggle-text">
                  <span>{hotkey.label}</span>
                  {note && <span className="customize__error">{note}</span>}
                </dt>
                <dd>
                  <kbd className="customize__kbd">{hotkey.keys}</kbd>
                </dd>
              </div>
            )
          })}
        </dl>
      )}
      {/* macOS lets two apps claim the same keys without saying so, so a clash can go unseen. */}
      {hotkeys.enabled && (
        <p className="customize__hint">
          If one does nothing, another app may be using the same keys.
        </p>
      )}
    </Section>
  )
}
