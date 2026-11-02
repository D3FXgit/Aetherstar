// The volume mixer: the user's own levels, on top of loudness normalisation.
//
// Every sound the app makes belongs to exactly one channel, and its final level
// is   normalisation (songs only)  x  channel  x  master.
//
//   music        the song itself on stage, and song previews (Song Select,
//                Party Draw, the Library panel) -- so a preview is heard at the
//                level the song will be sung at
//   guideVocals  the separated vocal stem, on songs that ship one
//   effects      UI and gameplay sound effects (sfxPlayer.ts)
//   menuMusic    the menu music: library songs or the bundled loop (menuMusic.ts)
//   master       everything above
//
// The mic monitor ("karaoke effect") is not on this list: it is mixed in the
// native layer, outside Web Audio, and keeps its own level.
//
// Slider positions persist in appPreferencesStore; this module maps a position
// to a gain and lets the audio code read or subscribe to it without importing
// React.
import { useAppPreferencesStore } from '../settings/appPreferencesStore'
import type { MixerChannel, MixerVolumes } from '../settings/types'

export type { MixerChannel, MixerVolumes }

/**
 * Slider position (0..1) to linear gain.
 *
 * Squared, because loudness is perceived roughly logarithmically: a linear
 * mapping puts all the audible change in the bottom fifth of the slider. With
 * the square, 50 % is -12 dB and 25 % is -24 dB, which is how people expect a
 * volume control to behave. 0 is true silence.
 */
export function sliderToGain(position: number): number {
  if (!Number.isFinite(position) || position <= 0) return 0
  const clamped = Math.min(1, position)
  return clamped * clamped
}

/** The final gain for one channel, master included. For `master` itself, just the master gain. */
export function mixerGainFrom(volumes: MixerVolumes, channel: MixerChannel): number {
  const master = sliderToGain(volumes.master)
  return channel === 'master' ? master : master * sliderToGain(volumes[channel])
}

/** The current gain for a channel, master included. */
export function getMixerGain(channel: MixerChannel): number {
  return mixerGainFrom(useAppPreferencesStore.getState().mixer, channel)
}

/**
 * Calls `listener` whenever any mixer slider moves. Returns the unsubscribe.
 * Fires only for mixer changes, not for unrelated preference writes.
 */
export function subscribeMixer(listener: (volumes: MixerVolumes) => void): () => void {
  return useAppPreferencesStore.subscribe((state, previous) => {
    if (state.mixer !== previous.mixer) listener(state.mixer)
  })
}

/** React: the current gain for one channel, master included. Re-renders when it changes. */
export function useMixerGain(channel: MixerChannel): number {
  return useAppPreferencesStore((state) => mixerGainFrom(state.mixer, channel))
}
