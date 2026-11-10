import { createContext, useContext } from 'react'
import { presetInfo } from './presets'

/**
 * The Focus Screen's card ground (`cardGround`), for colors fitted in script rather than in
 * the theme's variables: the singers' colors depend on the song, so they can't be set ahead.
 */
export const CardGroundContext = createContext<string>(presetInfo('night').colors.card)

export const useCardGround = (): string => useContext(CardGroundContext)
