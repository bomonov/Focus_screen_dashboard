import { audioHelperPath } from '../../../paths'
import { isMac } from '../../../platform'
import { createAudioHelperClient, type StartAudioHelper } from '../../autosync/client'
import { audioHelper } from '../../autosync/helper'
import type { SingerTap } from './editorDeps'

// The color-coding editor's own tap on the music player's audio, for the waveform. Like
// "Prepare playlist", it runs a helper process of its own, so it never disturbs auto-sync's
// recording; it's opened with the editor and closed with it, so nothing listens while the
// editor is shut. (The bundle IDs to listen to come from the player, see autosync/players.ts.)

const NO_WAVEFORM_ON_WINDOWS = "There's no waveform on Windows yet."
const NO_WAVEFORM_NOT_BUILT = "There's no waveform: the audio helper isn't built on this Mac."

/** What the waveform's place says when there's no tap at all (`openSingerTap` gave null). */
export function noTapNote(): string {
  return isMac ? NO_WAVEFORM_NOT_BUILT : NO_WAVEFORM_ON_WINDOWS
}

/** A tap over a helper of its own: only the part of the helper's client the editor needs. */
export function singerTapOver(startHelper: StartAudioHelper): SingerTap {
  const client = createAudioHelperClient(startHelper)
  return {
    start: (bundles) => client.start(bundles),
    stop: () => client.stop(),
    onAudio: (listener) => client.onAudio(listener),
    access: () => client.access(),
    dispose: () => client.dispose()
  }
}

/** Null on Windows, or when the audio helper isn't built (dev: `npm run build:audio`). */
export function openSingerTap(): SingerTap | null {
  if (!isMac) return null
  const startHelper = audioHelper(audioHelperPath)
  return startHelper ? singerTapOver(startHelper) : null
}
