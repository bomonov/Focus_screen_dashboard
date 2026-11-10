import type { PlayerId } from '../music/types'

/**
 * Which apps' audio to listen to for each player, by bundle ID prefix. Safari (and its web
 * apps) and Chrome play web audio from helper processes: WebKit's GPU process and Chrome's
 * audio service. Other sound from the same browser comes along; ours is the loud part.
 */
export function playerBundles(player: PlayerId): string[] {
  switch (player) {
    case 'appleMusic':
      return ['com.apple.Music']
    case 'spotify':
      return ['com.spotify.client']
    case 'ytmSafari':
      return ['com.apple.WebKit.GPU', 'com.apple.Safari']
    case 'ytmChrome':
      return ['com.google.Chrome']
    case 'demo':
      // The demo player makes no sound.
      return []
  }
}
