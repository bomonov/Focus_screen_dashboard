import { describe, expect, it } from 'vitest'
import type { ThemeSettings } from '../../main/ipc'
import { contrast } from './color'
import { cardGround, effectiveAccent, PRESETS, presetInfo, themeVariables } from './presets'

const night: ThemeSettings = {
  preset: 'night',
  accent: '#FFC627',
  background: 'solid',
  accentFromArt: false,
  glass: false,
  quickMenuScale: 1
}

describe('PRESETS', () => {
  it('are readable from across the room', () => {
    for (const { id, colors, accent } of PRESETS) {
      expect(contrast(colors.text, colors.card), `${id} text`).toBeGreaterThanOrEqual(7)
      expect(contrast(colors.textSecondary, colors.card), `${id} secondary`).toBeGreaterThanOrEqual(
        4.5
      )
      expect(contrast(colors.textDim, colors.card), `${id} dim`).toBeGreaterThanOrEqual(3)
      expect(contrast(colors.textSecondary, colors.bg), `${id} top bar`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(accent, colors.card), `${id} accent`).toBeGreaterThanOrEqual(3)
    }
  })

  it('match the mockup swatches', () => {
    expect(PRESETS.map((p) => [p.id, p.colors.bg, p.colors.card, p.accent])).toEqual([
      ['night', '#000000', '#191919', '#FFC627'],
      ['maroon', '#5A1229', '#8C1D40', '#FFC627'],
      ['day', '#E8E8E8', '#FFFFFF', '#8C1D40'],
      ['oled', '#000000', '#0D0D0D', '#747474']
    ])
  })
})

describe('effectiveAccent', () => {
  it('uses the chosen accent unless album art colors are on', () => {
    expect(effectiveAccent(night, '#3366FF')).toBe('#FFC627')
    expect(effectiveAccent({ ...night, accentFromArt: true }, null)).toBe('#FFC627')
  })

  it('makes a cover color readable on the theme', () => {
    const accent = effectiveAccent({ ...night, preset: 'day', accentFromArt: true }, '#FFE680')
    expect(contrast(accent, presetInfo('day').colors.card)).toBeGreaterThanOrEqual(3)
  })
})

describe('themeVariables', () => {
  it('sets every color and picks text for the accent', () => {
    const vars = themeVariables({ ...night, preset: 'day' }, null, false)
    expect(vars['--bg']).toBe('#E8E8E8')
    expect(vars['--card']).toBe('#FFFFFF')
    expect(vars['--accent']).toBe('#FFC627')
    expect(vars['--on-accent']).toBe('#000000')
  })

  it('lets a picture show through the cards', () => {
    expect(themeVariables(night, null, true)['--card']).toBe('rgb(25 25 25 / 0.78)')
  })

  it('lifts the quieter text on glass over a picture, and only there', () => {
    // The lightest the smoky glass gets over the brightest living color (glass.css, presets.ts).
    const ground = '#4E4A27'
    const glass = themeVariables(night, null, true, true)
    for (const tier of ['--text-secondary', '--text-dim'] as const) {
      expect(contrast(glass[tier] ?? '', ground)).toBeGreaterThanOrEqual(4.5)
    }
    // Still two tiers: the dim one stays the quieter.
    expect(contrast(glass['--text-dim'] ?? '', ground)).toBeLessThan(
      contrast(glass['--text-secondary'] ?? '', ground)
    )
    const plain = themeVariables(night, null, true)
    expect(plain['--text-dim']).toBe('#9A9A9A')
    expect(plain['--text-secondary']).toBe('#BFBFBF')
    // Daylight glass is white glass with dark words: nothing to lift.
    const day = themeVariables({ ...night, preset: 'day' }, null, true, true)
    expect(day['--text-dim']).toBe(presetInfo('day').colors.textDim)
  })

  it('keeps accent words readable whatever accent goes with whatever theme', () => {
    expect(themeVariables(night, null, false)['--accent-text']).toBe('#FFC627')
    const goldOnDay =
      themeVariables({ ...night, preset: 'day' }, null, false)['--accent-text'] ?? ''
    expect(contrast(goldOnDay, '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    const maroonOnNight = themeVariables({ ...night, accent: '#8C1D40' }, null, false)
    expect(maroonOnNight['--accent']).toBe('#8C1D40')
    expect(contrast(maroonOnNight['--accent-text'] ?? '', '#191919')).toBeGreaterThanOrEqual(4.5)
  })
  it('keeps the weather icons 3:1 on every theme’s card', () => {
    const names = ['sun', 'moon', 'cloud', 'rain', 'storm', 'snow']
    for (const preset of PRESETS) {
      const variables = themeVariables({ ...night, preset: preset.id }, null, false)
      for (const name of names) {
        const color = variables[`--weather-${name}`] ?? ''
        expect(
          contrast(color, preset.colors.card),
          `${name} on ${preset.id}`
        ).toBeGreaterThanOrEqual(3)
      }
    }
    // Where it already reads, the colour stays as drawn.
    expect(themeVariables(night, null, false)['--weather-sun']).toBe('#FFC627')
  })

  it('keeps a trip’s "live" words 4.5:1 on every theme, glass over a picture too', () => {
    for (const preset of PRESETS) {
      const plain = themeVariables({ ...night, preset: preset.id }, null, false)
      expect(
        contrast(plain['--trip-live'] ?? '', preset.colors.card),
        `live on ${preset.id}`
      ).toBeGreaterThanOrEqual(4.5)
    }
    const glassy = themeVariables(night, null, true, true)['--trip-live'] ?? ''
    expect(contrast(glassy, '#4E4A27')).toBeGreaterThanOrEqual(4.5)
    // Night's is the To-do card's Google green, as drawn.
    expect(themeVariables(night, null, false)['--trip-live']).toBe('#78BE20')
  })
})

describe('cardGround', () => {
  it('is the brightest glass over a picture on a dark theme, else the theme’s card', () => {
    expect(cardGround(night, true)).toBe('#4E4A27')
    expect(cardGround(night, false)).toBe('#191919')
    // Daylight's glass is milky white: its words are read against its white card.
    expect(cardGround({ ...night, preset: 'day' }, true)).toBe('#FFFFFF')
  })
})
