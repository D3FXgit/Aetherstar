// Typed Audio Manager contract. The real Web Audio engine and the mock both
// implement it, so UI that drives music (ducking on hover/focus, previews)
// can be tested against the mock with the semantics the engine really has.

/**
 * Independent, concurrently-playing music buses.
 *
 * The original contract modelled a *single* current source, which made
 * "duck the menu music under a song preview" inexpressible: starting the
 * preview necessarily destroyed the music. Naming the buses lets the two
 * coexist with independent gain, so the menu music survives (and keeps its
 * playback position) for the whole life of the app's menu screens.
 *
 * - `music` -- the menu music: the bundled loop (started once, ducked/restored)
 *   or a rotation of library songs (src/audio/menuMusic.ts). Never stopped by
 *   anything but an explicit `stop`.
 * - `preview` -- the short-lived per-song preview in the Song Selector and the
 *   Library detail panel. Started and *stopped* freely.
 * - `results` -- the "results bed": the song just sung, muffled as if heard
 *   from the next room, behind the results screen (src/audio/resultsBed.ts).
 *   Started and stopped by App.tsx's policy only.
 */
export type AudioChannelName = 'music' | 'preview' | 'results'

/**
 * An optional effect chain a track is played through, between its own gain
 * node (fades, normalisation) and its channel's mixer bus.
 *
 * - `muffled` -- low-pass + high-shelf cut + a short procedural room reverb,
 *   at a reduced level: music through a wall. Tuned in src/audio/resultsBed.ts.
 */
export type AudioEffectName = 'muffled'

/**
 * `music` is the default for every method, so call sites that only ever touch
 * the menu track (App.tsx's scene policy) never have to name a channel.
 */
export const DEFAULT_AUDIO_CHANNEL: AudioChannelName = 'music'

/** What the engine reports once a track is actually playing (see `PlayOptions.onStarted`). */
export interface StartedTrackInfo {
  /** The track's full length, in seconds (NaN when the media does not say). */
  durationSec: number
  /** Where playback opened, in seconds. */
  offsetSec: number
}

/** Per-call options for starting a track. */
export interface PlayOptions {
  /**
   * Where a song preview starts, in seconds -- the chart's #PREVIEWSTART when
   * it has one. Ignored on the `music` channel unless `startAtPreview` is set.
   * Absent, null or out of range: the engine falls back to its own guess (and
   * to the library row's value, when the index carries one).
   */
  previewStartSec?: number | null
  /**
   * Open at the preview start (above) on the `music` channel too. The `preview`
   * channel always does. Used when a library song plays as menu music.
   */
  startAtPreview?: boolean
  /** Loop the track (the default). False plays it once and lets it end. */
  loop?: boolean
  /**
   * Keep the decoded buffer cached for a later replay (the default). False for
   * a whole song played once as menu music: its PCM is tens of MB and nothing
   * asks for it again soon. False still *reuses* a buffer some cached play
   * (a preview of the same song) already holds; it only never adds one.
   * Meaningless for a streamed track (the engine's songs), which holds no buffer.
   */
  cache?: boolean
  /**
   * Play the track through an effect chain (see `AudioEffectName`). Absent: dry,
   * exactly as before. A context that cannot build part of the chain (a test
   * double, a reduced context) gets whatever part it can -- never an error.
   */
  effect?: AudioEffectName
  /** Called once the track is loaded, started and installed on its channel -- never for a superseded one. */
  onStarted?: (info: StartedTrackInfo) => void
  /** Called when the track could not be loaded or played -- never for a superseded one. */
  onError?: (error: unknown) => void
  /**
   * Called when a track that does not loop plays out to the end of its audio
   * while it is still its channel's track -- never after a `stop`, never for
   * the outgoing side of a crossfade, never for a looping track.
   */
  onEnded?: () => void
  /**
   * The shape of a `crossfadeTo`. `linear` (the default) is the engine's
   * historic ramp. `equal-power` is a sine/cosine pair -- the right curve for
   * two *different* songs, whose sum would otherwise dip by 3 dB mid-fade.
   */
  fadeCurve?: 'linear' | 'equal-power'
}

/** Per-call options for `transfer`. */
export interface TransferOptions {
  /** Hand over only if the source channel is playing exactly this track; otherwise nothing changes. */
  track?: string
  /** Set (true) or clear (false) looping on the source as it changes hands. Absent: left as it is. */
  loop?: boolean
  /** The new owner's natural-end callback (see `PlayOptions.onEnded`); replaces the old owner's. */
  onEnded?: () => void
}

/** What `transfer` handed over. */
export interface TransferredTrack {
  track: string
  /** The track's full length, in seconds (NaN when the media does not say). */
  durationSec: number
  /** Where in the track playback is at the moment of the handover, in seconds. */
  positionSec: number
}

export interface AudioManager {
  play: (track: string, channel?: AudioChannelName, options?: PlayOptions) => void
  duckTo: (volume: number, ms: number, channel?: AudioChannelName) => void
  restore: (ms: number, channel?: AudioChannelName) => void
  crossfadeTo: (track: string, ms: number, channel?: AudioChannelName, options?: PlayOptions) => void
  /**
   * Fade the channel to silence over `ms` and then actually stop its source,
   * clearing the channel. Distinct from `duckTo(0, ms)`, which leaves the
   * source running (and resumable via `restore`) at zero gain -- the right
   * behaviour for the menu track during gameplay, the wrong one for a preview
   * that must never come back or keep looping.
   *
   * Idempotent: stopping an already-stopped (or still-fading) channel is a
   * no-op, so overlapping teardown paths -- a launch handler and the unmount
   * cleanup that follows it -- cannot restart or lengthen the fade.
   */
  stop: (ms: number, channel?: AudioChannelName) => void
  /**
   * Hand the source playing on `from` over to `to` *without touching the
   * source*: no new load, no new start, no restart -- the same samples keep
   * coming out at the same position. Whatever `to` was playing is stopped on
   * the usual fade; `from` is left empty. If the two buses sit at different
   * levels (the Menu music and Music sliders, the stage ceiling) the level
   * glides from one to the other over `ms` rather than jumping.
   *
   * Returns what was handed over, or null when there was nothing (matching
   * `options.track`) to hand over -- the caller then falls back to a normal
   * stop/play.
   *
   * Optional, so the many hand-rolled test doubles of this contract stay
   * valid; callers treat a missing `transfer` exactly like a null result.
   */
  transfer?: (from: AudioChannelName, to: AudioChannelName, ms: number, options?: TransferOptions) => TransferredTrack | null
}
