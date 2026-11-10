import type { DisplaySettings, SettingsPatch, ShowOn } from '../../../main/ipc'
import { useDisplayChoices } from '../../hooks/useDisplayChoices'
import { PillGroup, Section, ToggleRow, type PillOption } from './controls'
import { IDLE_PRESETS, KEEP_AWAKE_CHOICES } from './customizeView'

export function DisplaySection({
  display,
  update
}: {
  display: DisplaySettings
  update: (patch: SettingsPatch) => void
}): React.JSX.Element {
  const choices = useDisplayChoices() ?? []
  const selected = choices.find((choice) => choice.selected)
  // Pills need simple values; the index finds the ShowOn behind each one.
  const showOnOptions: PillOption<number>[] = choices.map((choice, index) => ({
    value: index,
    label: choice.label,
    disabled: choice.missing
  }))
  const pickShowOn = (index: number): void => {
    const showOn: ShowOn | undefined = choices[index]?.showOn
    if (showOn) update({ display: { showOn } })
  }

  const idle = display.idleDimMinutes
  const idleOptions: PillOption<number>[] = [
    ...IDLE_PRESETS.map((minutes) => ({
      value: minutes,
      label: minutes === 0 ? 'Never' : `${minutes} min`
    })),
    // Set by hand in settings.json; shown so the choice isn't invisible.
    ...((IDLE_PRESETS as readonly number[]).includes(idle)
      ? []
      : [{ value: idle, label: `${idle} min`, disabled: true }])
  ]

  return (
    <Section title="Display">
      <PillGroup
        label="Show on"
        options={showOnOptions}
        value={selected ? choices.indexOf(selected) : null}
        onPick={pickShowOn}
      >
        {selected && (
          <span className="customize__hint customize__hint--wide">{selected.detail}</span>
        )}
      </PillGroup>
      <PillGroup
        label="Dim when idle after"
        options={idleOptions}
        value={idle}
        onPick={(idleDimMinutes) => update({ display: { idleDimMinutes } })}
      >
        <span className="customize__hint customize__hint--wide">
          With no music playing and no timer running, only the clock and album art stay up.
        </span>
      </PillGroup>
      <PillGroup
        label="Keep screens awake"
        options={KEEP_AWAKE_CHOICES}
        value={display.keepAwake}
        onPick={(keepAwake) => update({ display: { keepAwake } })}
      >
        <span className="customize__hint customize__hint--wide">
          {KEEP_AWAKE_CHOICES.find((choice) => choice.value === display.keepAwake)?.hint}
        </span>
      </PillGroup>
      <div className="customize__rows customize__rows--ruled">
        <ToggleRow
          label="Burn-in protection"
          hint="Shifts the layout a few pixels over time"
          on={display.burnInShift}
          onToggle={(burnInShift) => update({ display: { burnInShift } })}
        />
        <ToggleRow
          label="Keep on top"
          hint="Stays above other windows on that screen"
          on={display.alwaysOnTop}
          onToggle={(alwaysOnTop) => update({ display: { alwaysOnTop } })}
        />
        <ToggleRow
          label="Hide cursor"
          hint="When the mouse rests on the Focus Screen"
          on={display.hideCursor}
          onToggle={(hideCursor) => update({ display: { hideCursor } })}
        />
      </div>
    </Section>
  )
}
