import { useEffect } from 'react'
import type { ThemeSettings } from '../../main/ipc'
import { themeVariables } from '../theme/presets'

/**
 * How the glass cards look, if they're on (the Focus Screen only; Customize has nothing behind
 * it to show). Frosted blurs what's behind each card, which only a sharp photo needs: redoing
 * that blur costs the GPU every frame the record spins, and blurred album art is soft already.
 */
export type GlassLook = 'off' | 'clear' | 'frosted'

/** Puts the theme's colors on the root element, where every stylesheet reads them. */
export function useThemeVariables(
  theme: ThemeSettings | null,
  artAccent: string | null,
  overPicture: boolean,
  glass: GlassLook = 'off'
): void {
  useEffect(() => {
    if (!theme) return
    const root = document.documentElement
    const variables = themeVariables(theme, artAccent, overPicture, glass !== 'off' && overPicture)
    for (const [name, value] of Object.entries(variables)) {
      root.style.setProperty(name, value)
    }
    root.dataset.theme = theme.preset
    root.classList.toggle('over-picture', overPicture)
    root.classList.toggle('glass', glass !== 'off')
    root.classList.toggle('glass-frosted', glass === 'frosted')
  }, [theme, artAccent, overPicture, glass])
}
