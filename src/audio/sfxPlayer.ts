import { SFX_URLS } from './sfxAssets'
import { ensureAudioContextRunning, getSharedAudioContext, type AudioContextLike, type GainNodeLike } from './webAudioApi'
import type { SfxHandle, SfxName, SfxPlayer } from './sfxContract'

/**
 * The real player narrows `SfxPlayer.play` to always return a handle. The wider
 * contract exists for the many stand-ins that have none (see sfxContract.ts);
 * this one is backed by an actual voice every time, so its callers can stop
 * what they started without a null check.
 */
export interface RealSfxPlayer extends SfxPlayer {
  play: (name: SfxName) => SfxHandle
  /**
   * Decode every sound up front. Idempotent, and safe to ignore -- `play`
   * decodes on demand anyway. Awaiting it is how a caller guarantees the
   * *first* hit of a song is as prompt as the thousandth.
   */
  preload: () => Promise<void>
}

/** How a sound's bytes are fetched. Injectable so tests never touch the network. */
export type SfxFetcher = (url: string) => Promise<ArrayBuffer>

async function fetchAudioBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  return response.arrayBuffer()
}

/** Quiet enough to sit under the menu music rather than punch through it. */
export const DEFAULT_SFX_VOLUME = 0.6

/**
 * How long a cancelled sound takes to reach silence.
 *
 * A bare stop cuts the waveform at whatever sample value it happened to be on,
 * which is an audible click -- and the one sound that is ever actually
 * cancelled is `song_selected.wav`, which is at full level from 300 ms in
 * (SONG_SELECTED_PEAK_OFFSET_MS), so the click would be a loud one. 120 ms is
 * short enough to read as "that stopped" rather than as a fade-out.
 */
export const SFX_STOP_FADE_MS = 120

/**
 * Below this much playback, a cancelled sound is cut rather than faded.
 *
 * Two reasons, and they point the same way. A fade that is three times longer
 * than the sound has existed keeps a sound the caller has *cancelled* audible
 * for longer than doing nothing would -- which is precisely the StrictMode
 * mount/cleanup/mount case, where the cleanup lands in the same tick as the
 * play and a fading first copy would be exactly the layering being fixed. And
 * there is nothing to click: `assets/sfx/song_selected.wav` is digital silence
 * at 0 ms with its first transient at ~50 ms (see sfxAssets.ts), and no UI
 * sound in the set is at full level 40 ms in.
 */
export const SFX_CUT_INSTEAD_OF_FADE_MS = 40

/**
 * How many copies of one sound can overlap.
 *
 * Four is the point where a run of hits still layers convincingly and a fifth
 * simultaneous copy of the same 160 ms sample is not separately audible -- it
 * just adds level. The oldest voice is stopped past that, which is standard
 * game-audio voice stealing, and it is the thing that stops eight lanes of
 * simultaneous Excellents from summing into clipping.
 */
export const SFX_VOICES_PER_SOUND = 4

/**
 * One-shot SFX as Web Audio buffer sources, on the *same* AudioContext as the
 * music (getSharedAudioContext).
 *
 * That sharing is the whole point of this file's current shape. SFX used to be
 * HTMLAudioElements -- `new Audio(url)` -- which is a reasonable thing to reach
 * for and was wrong here in two escalating ways:
 *
 *   1. A fresh element per play meant a three-and-a-half minute song built
 *      thousands of detached media elements, because hit feedback fires up to
 *      ~11-22 times a second across eight lanes. Chromium caps concurrent media
 *      resources, so the song's own audio -- which is also the timing clock --
 *      competed with spent one-shots for a decoder. Reported as the SFX killing
 *      the song and freezing the app; answered with a bounded element pool.
 *   2. The pool fixed the churn and not the underlying mismatch: a media
 *      element and an AudioContext are two *different* audio paths to the same
 *      output device. Every element that starts or stops makes Chromium
 *      reconcile them, and the render quantum the music is being pulled through
 *      is what gives -- heard as intermittent buffer noise under the music and
 *      during gameplay, exactly as reported ("glitchy and make weird buffer
 *      noises sometimes").
 *
 * There is no reconciling to do when there is only one path. A decoded
 * AudioBuffer per sound, played through an AudioBufferSourceNode, mixes into
 * the same graph the music is already in: nothing is allocated on the audio
 * thread, nothing is decoded per play, and the stop fade is a scheduled gain
 * ramp rather than a `setInterval` on the main thread -- which also takes ~11-22
 * timers a second out of the frame budget during a song.
 */
export function createSfxPlayer(
  audioContextFactory: () => AudioContextLike = getSharedAudioContext,
  urls: Record<SfxName, string> = SFX_URLS,
  /** A fixed gain, or a function read at the start of every sound -- how the mixer's Effects slider applies live. */
  volume: number | (() => number) = DEFAULT_SFX_VOLUME,
  fetchAudio: SfxFetcher = fetchAudioBytes,
): RealSfxPlayer {
  let context: AudioContextLike | null = null

  function currentVolume(): number {
    const value = typeof volume === 'function' ? volume() : volume
    return Number.isFinite(value) && value > 0 ? value : 0
  }
  /**
   * Exactly one gesture listener pair alive at a time. A UI sound fires on
   * every hover, and one listener per play would turn a sweep across a menu
   * into a burst of resume() calls.
   */
  let resumeArmed = false

  /**
   * The context is built on first use, not at construction: `useSfx` builds the
   * player lazily but a module-level `new AudioContext()` would still be one
   * more suspended context in every test environment and Dev Lab route that
   * never plays a sound.
   */
  function getContext(): AudioContextLike | null {
    if (!context) {
      try {
        context = audioContextFactory()
      } catch {
        // No Web Audio in this environment -- every sound becomes a no-op
        // rather than an exception thrown into a click handler.
        return null
      }
    }
    return context
  }

  /** Decoded buffers, and the in-flight decodes, so a sound is fetched once however often it is played. */
  const buffers = new Map<SfxName, AudioBuffer>()
  const decoding = new Map<SfxName, Promise<AudioBuffer | null>>()
  /** Currently-sounding voices per sound, oldest first, for voice stealing. */
  const voices = new Map<SfxName, VoiceHandle[]>()

  function load(name: SfxName): Promise<AudioBuffer | null> {
    const cached = decoding.get(name)
    if (cached) return cached

    const url = urls[name]
    const audioContext = getContext()
    if (!url || !audioContext) return Promise.resolve(null)

    const pending = fetchAudio(url)
      .then((data) => audioContext.decodeAudioData(data))
      .then((buffer) => {
        buffers.set(name, buffer)
        return buffer
      })
      .catch(() => {
        // A sound that will not decode is a missing sound, not a broken app.
        // Dropped from `decoding` so a later play can retry it.
        decoding.delete(name)
        return null
      })

    decoding.set(name, pending)
    return pending
  }

  function start(name: SfxName, buffer: AudioBuffer, handle: VoiceHandle): void {
    const audioContext = getContext()
    if (!audioContext || handle.stopped) return

    // A context can be suspended long after it was created -- the autoplay
    // policy, or Chromium suspending a window that lost the audible-media role.
    //
    // Asking is not enough, and assuming the click that triggered this *is* the
    // qualifying gesture is not either: the first sound of a session is a hover
    // on the boot screen, which is not a gesture, and it is this player that
    // builds the shared context. So it arms the same listener the music engine
    // does. Everything is on one context now, which means whichever subsystem
    // gets there first is responsible for unblocking it for all of them.
    if (!resumeArmed) {
      resumeArmed = true
      ensureAudioContextRunning(audioContext, () => {
        resumeArmed = false
      })
    }

    const gain = audioContext.createGain()
    gain.gain.value = currentVolume()
    gain.connect(audioContext.destination)

    const source = audioContext.createBufferSource()
    source.buffer = buffer
    source.connect(gain)
    source.start()

    handle.attach(audioContext, source, gain)

    const sounding = voices.get(name) ?? []
    sounding.push(handle)
    // Steal the oldest once this sound is over its voice budget. It is the one
    // that started longest ago and is therefore nearest to finishing anyway.
    while (sounding.length > SFX_VOICES_PER_SOUND) sounding.shift()?.stop(0)
    voices.set(name, sounding)
  }

  return {
    preload: async () => {
      await Promise.all((Object.keys(urls) as SfxName[]).map((name) => load(name)))
    },

    play: (name) => {
      if (!urls[name]) return NOOP_HANDLE
      try {
        const handle = new VoiceHandle()
        const ready = buffers.get(name)
        if (ready) {
          // The common case, and the one that has to be immediate: a decoded
          // sound starts in this same tick, with no promise between the click
          // and the click sound.
          start(name, ready, handle)
        } else {
          void load(name).then((buffer) => {
            if (buffer) start(name, buffer, handle)
          })
        }
        return handle
      } catch {
        // Never let a sound effect throw into the interaction that triggered it.
        return NOOP_HANDLE
      }
    },
  }
}

/** Returned when there was never a sound to play, so callers never have to null-check. */
const NOOP_HANDLE: SfxHandle = { stop: () => {} }

/**
 * One sounding voice.
 *
 * A class rather than a closure because the handle is handed out *before* the
 * voice necessarily exists: the first play of a sound has to wait for a decode,
 * and a caller that cancels in between (the StrictMode cleanup) must cancel the
 * sound that has not started yet, not fail to.
 */
class VoiceHandle implements SfxHandle {
  stopped = false
  private context: AudioContextLike | null = null
  private source: { stop: (when?: number) => void } | null = null
  private gain: GainNodeLike | null = null
  private startedAt = 0

  attach(context: AudioContextLike, source: { stop: (when?: number) => void }, gain: GainNodeLike): void {
    this.context = context
    this.source = source
    this.gain = gain
    this.startedAt = context.currentTime
  }

  stop(fadeMs: number = SFX_STOP_FADE_MS): void {
    // Idempotent. Two teardown paths reaching the same sound (a React cleanup
    // and an explicit cancel, say) must not start a second ramp from a
    // half-faded value -- the same reasoning as webAudioManager's stop().
    if (this.stopped) return
    this.stopped = true

    const { context, source, gain } = this
    // Cancelled before its buffer finished decoding: `start` sees `stopped` and
    // never begins it.
    if (!context || !source || !gain) return

    try {
      const playedMs = (context.currentTime - this.startedAt) * 1000
      if (fadeMs <= 0 || playedMs < SFX_CUT_INSTEAD_OF_FADE_MS) {
        gain.gain.value = 0
        source.stop()
        return
      }

      const endTime = context.currentTime + fadeMs / 1000
      gain.gain.setValueAtTime(gain.gain.value, context.currentTime)
      gain.gain.linearRampToValueAtTime(0, endTime)
      // Stopped only once the ramp has landed, so the node is torn down at
      // silence rather than mid-fade -- which would be the click all over again.
      source.stop(endTime)
    } catch {
      // Stopping a sound is always best-effort cleanup, never a reason to fail
      // the caller's teardown.
    }
  }
}
