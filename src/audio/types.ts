// Audio-domain types (mic devices, capture, IPC payloads). Shared song/pitch
// types stay in src/contracts/types.ts.
import type { PitchSample } from '../contracts/types'

export interface AudioDevice {
  id: string
  name: string
  channelCount: number
  sampleRate: number
}

export type MicPermissionStatus = 'granted' | 'denied' | 'not-determined' | 'restricted'

export interface DeviceCaptureState {
  /** Most recent *pitched* sample. Level-only frames (silence) never land here. */
  latest: PitchSample | null
  /** The most recent pitched samples, capped at MAX_CAPTURE_SAMPLES. Level-only frames are excluded, so scoring and calibration see the same stream they always did. */
  samples: PitchSample[]
  /**
   * How many samples have been evicted from the front of `samples` since this
   * capture started; 0 before the cap is reached.
   *
   * A consumer that tracks its read position as an absolute count has to
   * subtract this to get an index into the current array -- eviction shifts
   * every index, and without it a reader silently re-processes samples it has
   * already scored. Optional so the many hand-built capture-state fixtures in
   * the test suite keep compiling; treat a missing value as 0.
   */
  droppedSamples?: number
  /** Date.now() - t of the last frame received, or null before any frame arrives. */
  latencyMs: number | null
  /**
   * Input level of the most recent frame, pitched or not: RMS amplitude 0..1.
   *
   * Tracked separately from `latest.rms` because the frames that matter most to
   * a level meter are exactly the ones with no pitch -- a live-but-silent mic
   * emits nothing but level-only frames, and reading the level off `latest`
   * would pin the meter to whenever the singer last made a pitched sound.
   *
   * Optional, like `levelAt`, only so the many hand-built capture-state
   * fixtures that predate the meters keep type-checking; the store always
   * writes both, and `useCaptureLevel` treats a missing one as silence.
   */
  level?: number
  /** Date.now() when `level` was last updated; 0 before any frame arrives. Consumers use this to decay a stalled capture's meter to zero. */
  levelAt?: number
}

export interface PitchBatchPayload {
  deviceId: string
  samples: PitchSample[]
}

export interface DeviceListChangedPayload {
  devices: AudioDevice[]
  added: AudioDevice[]
  removed: AudioDevice[]
}

export interface RawScopeChunkPayload {
  deviceId: string
  chunk: Float32Array
}

/**
 * Live microphone monitoring -- the "karaoke effect": the singers' voices come
 * back out of the speakers alongside the song, quieter than it.
 *
 * Owned by the main process (electron/audio/monitor-settings.cjs) and consumed
 * by the native addon, not by any renderer audio graph -- there is no
 * MediaStream in this app for a GainNode to monitor, and capture is a `cpal`
 * input stream the Rust side already holds. The renderer only ever reads and
 * writes this pair of values.
 */
export interface MicMonitorSettings {
  /** Off by default: a karaoke app that amplifies the room unasked is a bad first run. */
  enabled: boolean
  /** 0..1 as the slider reports it. The gain it maps to is capped well below unity in Rust. */
  level: number
}
