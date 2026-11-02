// The results bed: the song just sung, playing on behind the results screen
// "as if heard from the garage" -- muffled through a wall, quieter, with a bit
// of room around it.
//
// Every tuning knob for it lives in this file:
//
//   RESULTS_BED_EFFECT     the `muffled` effect chain (src/audio/effectChain.ts)
//   RESULTS_BED_FADE_IN_MS / RESULTS_BED_FADE_OUT_MS   the policy's fades
//
// *When* it plays is App.tsx's audio policy (the results scene, with a sung
// song in the session); *what* plays is the song's own audio file, from the
// same start point its preview uses (#PREVIEWSTART, else the preview
// heuristic), looped from there to the end, at the song's loudness
// normalisation, on the `results` engine channel -- whose mixer bus is the
// Music slider (x Master), like the song itself on stage.
import type { PlayOptions } from './audioManagerContract'

/** The `muffled` effect: everything that makes the song sound like it is in the next room. */
export interface MuffledEffectConfig {
  /** Low-pass cutoff, Hz: what the wall lets through. */
  lowpassHz: number
  /** Low-pass resonance. ~0.7 is a gentle, un-peaky (Butterworth) knee. */
  lowpassQ: number
  /** High-shelf corner, Hz: an extra dull-down of whatever the low-pass leaves above it. */
  highShelfHz: number
  /** High-shelf gain, dB (negative: a cut). */
  highShelfDb: number
  /** Reverb tail length, seconds: the impulse decays to -60 dB over this (RT60). */
  reverbSeconds: number
  /** Silence before the reverb tail, ms: the room's first reflection. */
  reverbPreDelayMs: number
  /** Reverb (wet) level, 0..1. */
  wet: number
  /** Direct (dry) level, 0..1. */
  dry: number
  /** Overall level of the bed, dB, relative to the song at its normal (normalised, mixer) level. */
  levelDb: number
}

export const RESULTS_BED_EFFECT: Readonly<MuffledEffectConfig> = Object.freeze({
  lowpassHz: 750,
  lowpassQ: 0.7,
  highShelfHz: 2500,
  highShelfDb: -6,
  reverbSeconds: 1.5,
  reverbPreDelayMs: 12,
  wet: 0.4,
  dry: 0.6,
  levelDb: -6,
})

/** How long the bed takes to come up once the results screen appears. */
export const RESULTS_BED_FADE_IN_MS = 1500

/**
 * How long it takes to go away when the results screen is left (leaderboard,
 * song select, home). Leaving for the song-start transition (a Versus rematch)
 * uses the preview's launch fade instead -- see App.tsx.
 */
export const RESULTS_BED_FADE_OUT_MS = 800

/**
 * The engine options for a results bed opening at `previewStartSec` (null: the
 * engine's preview heuristic, or the library row's own value).
 *
 * Not cached: a library song is streamed by the engine (webAudioManager.ts),
 * never decoded whole, and on an engine that does decode it, a whole song's
 * PCM is tens of MB -- exactly the case menu music already declines to cache.
 */
export function resultsBedPlayOptions(previewStartSec: number | null | undefined, extra: Partial<PlayOptions> = {}): PlayOptions {
  return {
    effect: 'muffled',
    startAtPreview: true,
    previewStartSec: previewStartSec ?? null,
    loop: true,
    cache: false,
    ...extra,
  }
}

/** dB to linear amplitude. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}
