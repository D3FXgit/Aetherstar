import {
  createAudioContext,
  ensureAudioContextRunning,
  type AudioContextLike,
  type BufferSourceNodeLike,
  type GainNodeLike,
  type MediaElementLike,
  type MediaElementSourceNodeLike,
} from './webAudioApi'
import {
  DEFAULT_AUDIO_CHANNEL,
  type AudioChannelName,
  type AudioManager,
  type PlayOptions,
  type TransferOptions,
  type TransferredTrack,
} from './audioManagerContract'
import { computeGainRamp } from './gainRamp'
import { applyLoopDeclick } from './declick'
import { connectEffect } from './effectChain'

// Short enough to be inaudible as a fade, long enough to remove the hard
// sample-value discontinuity a naive `loop = true` produces at the seam
// (heard as an audible click/pop -- "clipping" -- on every loop repeat).
// Applied to song previews, which loop arbitrary song audio from a mid-song
// offset. NOT applied to the menu music: menu_music/menu_loop.wav is authored
// as a seamless loop, and fading its edges would put an audible dip in the
// middle of the music on every pass. (A library song played as menu music does
// not loop at all -- it is faded in and crossfaded out by menuMusic.ts.) The
// results bed (resultsBed.ts) loops song audio from mid-song like a preview,
// so it gets the fade too.
export const LOOP_DECLICK_SECONDS = 0.015

/** Whether a channel's buffers get the anti-click edge fade (see LOOP_DECLICK_SECONDS). */
export function channelNeedsDeclick(channelName: AudioChannelName): boolean {
  return channelName !== 'music'
}

/** How long a refined loudness gain (a measurement that landed after the track started) takes to fade in. */
export const REFINED_GAIN_RAMP_MS = 800

/** How long a mixer slider move takes to land on a bus: just enough to avoid zipper noise. */
export const MIXER_RAMP_MS = 50

/**
 * How long after its fade has reached zero a streamed track's element is
 * paused and released. A buffer source's stop is scheduled on the audio clock
 * and lands sample-exactly; an element is paused from a timer, so it is given
 * this much slack to be sure the fade is over before the audio is cut.
 */
export const STREAM_RELEASE_MARGIN_MS = 50

async function loadBuffer(audioContext: AudioContextLike, track: string, declick: boolean): Promise<AudioBuffer> {
  const response = await fetch(track)
  if (response.ok !== undefined && !response.ok) {
    throw new Error(`Failed to fetch audio track: ${track} (${response.status})`)
  }
  const data = await response.arrayBuffer()
  const buffer = await audioContext.decodeAudioData(data)
  if (declick) applyLoopDeclick(buffer, LOOP_DECLICK_SECONDS)
  return buffer
}

/**
 * Drops whatever automation is still scheduled on a gain node from `at` on,
 * holding the value it has reached.
 *
 * Without this a new ramp is *added to* a fade still in flight rather than
 * replacing it: the old fade's later points stay on the timeline and drag the
 * gain back to where the old fade was heading once the new ramp is done (a
 * stop mid-crossfade swelling back up, a refined loudness overridden by the
 * end of the fade-in it landed during). Optional on the node interface, so
 * minimal test doubles simply skip it.
 */
function cancelAutomation(gainNode: GainNodeLike, at: number): void {
  const param = gainNode.gain
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(at)
  else if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(at)
}

/** Anchors the gain node's current value at "now", then schedules a linear ramp to `toGain` over `ms`. */
function scheduleGainRamp(audioContext: AudioContextLike, gainNode: GainNodeLike, toGain: number, ms: number): void {
  const { targetGain, endTimeSeconds } = computeGainRamp(gainNode.gain.value, toGain, ms, audioContext.currentTime)
  cancelAutomation(gainNode, audioContext.currentTime)
  gainNode.gain.setValueAtTime(gainNode.gain.value, audioContext.currentTime)
  gainNode.gain.linearRampToValueAtTime(targetGain, endTimeSeconds)
}

/** How many straight segments approximate one equal-power (sine/cosine) fade. */
export const EQUAL_POWER_STEPS = 16

/**
 * An equal-power fade as a run of linear ramps: `in` follows a sine from the
 * current value up to `toGain`, `out` a cosine from the current value down to
 * `toGain`. Paired, the two keep the summed power of two *different* songs
 * constant, where a linear pair dips by 3 dB in the middle.
 *
 * Linear segments rather than `setValueCurveAtTime`, because a value curve
 * forbids any other automation inside its span -- and a stop, a duck or the
 * next crossfade can land mid-fade at any moment. Sixteen segments track the
 * curve to within a fraction of a decibel.
 */
function scheduleEqualPowerFade(
  audioContext: AudioContextLike,
  gainNode: GainNodeLike,
  toGain: number,
  ms: number,
  direction: 'in' | 'out',
): void {
  const now = audioContext.currentTime
  const from = gainNode.gain.value
  cancelAutomation(gainNode, now)
  gainNode.gain.setValueAtTime(from, now)
  const seconds = Math.max(0, ms) / 1000
  if (seconds === 0) {
    gainNode.gain.linearRampToValueAtTime(toGain, now)
    return
  }
  for (let step = 1; step <= EQUAL_POWER_STEPS; step++) {
    const x = step / EQUAL_POWER_STEPS
    const shape = direction === 'in' ? Math.sin((x * Math.PI) / 2) : 1 - Math.cos((x * Math.PI) / 2)
    const value = step === EQUAL_POWER_STEPS ? toGain : from + (toGain - from) * shape
    gainNode.gain.linearRampToValueAtTime(value, now + seconds * x)
  }
}

/**
 * `AudioBufferSourceNode.stop()` throws if the node was never started, and can
 * throw on a node the context has already torn down. Tearing a source down is
 * always best-effort cleanup -- never a reason to fail the caller's action.
 */
function stopBufferSource(source: BufferSourceNodeLike, when?: number): void {
  try {
    source.stop(when)
  } catch {
    // Already stopped / never started -- nothing to clean up.
  }
}

/**
 * A playing track, whichever way its audio reaches the graph.
 *
 * - `buffer` -- decoded whole into an AudioBuffer and played by an
 *   AudioBufferSourceNode: the bundled menu loop (a seamless loop needs
 *   sample-exact looping) and anything else the engine is not told to stream.
 * - `element` -- streamed by an `<audio>` element into a
 *   MediaElementAudioSourceNode: songs (previews, library menu music, the
 *   results bed). It starts as soon as the audio around its start point has
 *   arrived, where a buffer has to wait for the whole file to be fetched and
 *   decoded -- hundreds of ms to over a second for a 4-minute song, and ~85 MB
 *   of PCM held while it plays.
 *
 * Both feed the same per-track gain node, effect and mixer bus, so fades,
 * normalisation, ducking and the bus swap of a `transfer` cannot tell them
 * apart. `loop` is live: `transfer` switches it on the playing track.
 */
type Voice = BufferVoice | ElementVoice

interface BufferVoice {
  kind: 'buffer'
  node: BufferSourceNodeLike
  loop: boolean
  /** Stop at context time `when` (now when absent). */
  stop(when?: number): void
}

interface ElementVoice {
  kind: 'element'
  element: MediaElementLike
  loop: boolean
  /** Where a loop goes back to, in seconds: the track's start point. */
  loopStart: number
  /** Stop -- pause the element and release it -- once context time `when` has passed (now when absent). */
  stop(when?: number): void
}

function bufferVoice(node: BufferSourceNodeLike): BufferVoice {
  return {
    kind: 'buffer',
    node,
    get loop() {
      return node.loop
    },
    set loop(value: boolean) {
      node.loop = value
    },
    stop: (when) => stopBufferSource(node, when),
  }
}

/** A streamed start that a newer call on its channel overtook: dropped, never reported. */
class SupersededError extends Error {
  constructor() {
    super('superseded')
  }
}

/** Resolves once the element knows the track's length; rejects if it cannot load the track at all. */
function waitForMetadata(element: MediaElementLike, track: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // HAVE_METADATA or better: already there.
    if (element.readyState >= 1) {
      resolve()
      return
    }
    const cleanup = () => {
      element.removeEventListener('loadedmetadata', onMetadata)
      element.removeEventListener('error', onError)
    }
    const onMetadata = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error(`Failed to load audio track: ${track}`))
    }
    element.addEventListener('loadedmetadata', onMetadata)
    element.addEventListener('error', onError)
  })
}

/**
 * Where a song preview starts, in seconds.
 *
 * The chart's #PREVIEWSTART when it is given and lands inside the song (with a
 * second to spare); otherwise the old guess -- a minute in for a full-length
 * song, a third of the way in for a short one, the top for a jingle.
 */
export function previewStartOffset(durationSec: number | undefined, previewStartSec?: number | null): number {
  const duration = typeof durationSec === 'number' && Number.isFinite(durationSec) ? durationSec : null
  if (typeof previewStartSec === 'number' && Number.isFinite(previewStartSec) && previewStartSec > 0) {
    if (duration === null || previewStartSec < duration - 1) return previewStartSec
  }
  if (duration === null) return 0
  if (duration > 75) return 60
  if (duration > 20) return Math.floor(duration * 0.33)
  return 0
}

/**
 * One independently-gained bus. `generation` is bumped by every call that
 * changes what the channel should be playing (play/crossfadeTo/stop) and
 * captured by the async ones before they await their decode: a continuation
 * that comes back holding a stale generation has been superseded and must tear
 * down the source it just started instead of clobbering the newer one.
 */
interface Channel {
  source: Voice | null
  gain: GainNodeLike | null
  generation: number
  /**
   * The loudness-normalisation gain of whatever this channel is currently
   * playing -- i.e. what "full volume" means for *this* track.
   *
   * Kept per channel because `restore()` and `duckTo()` are stated as fractions
   * of full volume, and full volume is per-track. Ramping to a literal 1 on
   * restore would silently undo the normalisation of the song that is playing.
   */
  trackGain: number
  /** The fraction of full volume the channel is currently meant to be at (1 playing, the duck level when ducked). */
  fraction: number
  /** The URL the installed source plays, or null. What `transfer` matches `options.track` against. */
  track: string | null
  /**
   * Where the installed source is, as an anchor: it was `offsetSec` into the
   * track at context time `startedAt`. Re-anchored on every transfer.
   */
  startedAt: number
  offsetSec: number
  /** The installed track's full length, in seconds (NaN when unknown). */
  durationSec: number
  /** Called when the installed source plays out to its end (see PlayOptions.onEnded). */
  onEnded: (() => void) | null
  /** A loudness measurement still on its way for the installed track, so a transfer can carry it along. */
  refinedGain: Promise<number | null> | undefined
}

function createChannel(): Channel {
  return {
    source: null,
    gain: null,
    generation: 0,
    trackGain: 1,
    fraction: 1,
    track: null,
    startedAt: 0,
    offsetSec: 0,
    durationSec: Number.NaN,
    onEnded: null,
    refinedGain: undefined,
  }
}

/** Forgets the installed source (it is not stopped here). The generation is the caller's business. */
function clearChannel(channel: Channel): void {
  channel.source = null
  channel.gain = null
  channel.trackGain = 1
  channel.fraction = 1
  channel.track = null
  channel.startedAt = 0
  channel.offsetSec = 0
  channel.durationSec = Number.NaN
  channel.onEnded = null
  channel.refinedGain = undefined
}

const CHANNEL_NAMES: readonly AudioChannelName[] = ['music', 'preview', 'results']

/**
 * What the engine needs to know about one track before playing it.
 *
 * `refinedGain` is for a track whose loudness was not known at start: the
 * resolver measures it (from the decoded buffer, when there is one) and
 * resolves this with the real gain (or null), and the engine fades the channel
 * to it.
 */
export interface TrackInfo {
  gain: number
  refinedGain?: Promise<number | null>
  /** The library's #PREVIEWSTART for this track, used when the caller passed none. */
  previewStartSec?: number | null
}

/**
 * How loud one particular track should be played relative to everything else on
 * its bus -- the per-song loudness normalisation, for the song previews that
 * run through this engine. 1 for anything with no measurement source (the menu
 * track).
 *
 * Injected rather than imported so this file stays a pure Web Audio engine with
 * no knowledge of the song library; see useWebAudioManager.ts for the wiring.
 * Handed the buffer being decoded, when the track is decoded at all, so it can
 * measure a track nobody has measured yet without a second fetch. A streamed
 * track has no buffer: measuring it is the resolver's own background business,
 * and must never hold up the start.
 */
export type TrackGainResolver = (track: string, context: { buffer?: Promise<AudioBuffer> }) => Promise<number | TrackInfo>

const UNITY_GAIN: TrackGainResolver = () => Promise.resolve(1)

/**
 * The user's volume mixer, as the engine sees it: one gain per engine channel,
 * and a way to hear about changes. Optional -- without it the channels connect
 * straight to the destination, exactly as before.
 */
export interface MixerBinding {
  gainFor: (channel: AudioChannelName) => number
  subscribe: (listener: () => void) => () => void
}

/**
 * Which tracks the engine streams through a media element instead of decoding
 * whole (see `Voice`). Optional -- without it, or on a context that cannot
 * stream, every track is decoded, exactly as before.
 */
export interface StreamingBinding {
  /** Whether `track`, about to play on `channel`, is streamed. */
  shouldStream: (track: string, channel: AudioChannelName) => boolean
  /** A fresh media element. Defaults to `new Audio()`. */
  createElement?: () => MediaElementLike
}

function defaultMediaElement(): MediaElementLike | null {
  return typeof Audio === 'undefined' ? null : (new Audio() as unknown as MediaElementLike)
}

function toTrackInfo(value: number | TrackInfo): TrackInfo {
  return typeof value === 'number' ? { gain: value } : value
}

/** The real `AudioManager`: Web Audio-backed play/duck/restore/crossfade/stop, per named channel. */
export function createWebAudioManager(
  audioContextFactory: () => AudioContextLike = createAudioContext,
  resolveTrackGain: TrackGainResolver = UNITY_GAIN,
  mixer?: MixerBinding,
  streaming?: StreamingBinding,
): AudioManager {
  const audioContext = audioContextFactory()

  /**
   * A context can be suspended long after it was created -- Chromium suspends
   * one whose window loses the audible-media role, which this app has already
   * been bitten by once (the audience window taking focus killed the main
   * window's menu music). The construction-time resume below is a one-shot and
   * cannot see that, so every action re-checks and re-arms.
   *
   * `resumeArmed` keeps exactly one gesture listener pair alive at a time:
   * duckTo/restore run on every scene transition, and one listener per action
   * would turn a single click into a burst of resume() calls.
   *
   * A 'closed' context is deliberately not touched -- resume() rejects on one,
   * and nothing can bring it back.
   */
  let resumeArmed = false
  function ensureRunning(): void {
    if (audioContext.state !== 'suspended' || resumeArmed) return
    resumeArmed = true
    ensureAudioContextRunning(audioContext, () => {
      resumeArmed = false
    })
  }

  ensureRunning()

  const channels: Record<AudioChannelName, Channel> = {
    music: createChannel(),
    preview: createChannel(),
    results: createChannel(),
  }
  const bufferCache = new Map<string, AudioBuffer>()

  /**
   * One mixer bus per channel, created on first use and kept for the life of
   * the engine: track gain nodes come and go, the bus stays, so a slider move
   * is one ramp on one node whatever is playing.
   */
  const buses: Partial<Record<AudioChannelName, GainNodeLike>> = {}
  function outputFor(channelName: AudioChannelName): unknown {
    if (!mixer) return audioContext.destination
    let bus = buses[channelName]
    if (!bus) {
      bus = audioContext.createGain()
      bus.gain.value = mixer.gainFor(channelName)
      bus.connect(audioContext.destination)
      buses[channelName] = bus
    }
    return bus
  }
  mixer?.subscribe(() => {
    for (const name of Object.keys(buses) as AudioChannelName[]) {
      const bus = buses[name]
      if (bus) scheduleGainRamp(audioContext, bus, mixer.gainFor(name), MIXER_RAMP_MS)
    }
  })

  /**
   * Cached per track *and* per edge treatment: the declick fade mutates the
   * decoded samples, so a declicked buffer must never be handed to the
   * seamless-loop music channel (or the other way round).
   */
  async function loadCachedBuffer(track: string, declick: boolean, store = true): Promise<AudioBuffer> {
    const key = `${declick ? 'declick' : 'raw'}:${track}`
    const cached = bufferCache.get(key)
    if (cached) return cached

    const buffer = await loadBuffer(audioContext, track, declick)
    if (store) bufferCache.set(key, buffer)
    return buffer
  }

  interface Started {
    source: Voice
    gainNode: GainNodeLike
    trackGain: number
    refinedGain?: Promise<number | null>
    durationSec: number
    offsetSec: number
    startedAt: number
  }

  /** Makes a started track the channel's track. */
  function install(channel: Channel, track: string, started: Started, options: PlayOptions | undefined): void {
    channel.source = started.source
    channel.gain = started.gainNode
    channel.trackGain = started.trackGain
    channel.fraction = 1
    channel.track = track
    channel.startedAt = started.startedAt
    channel.offsetSec = started.offsetSec
    channel.durationSec = started.durationSec
    channel.onEnded = options?.onEnded ?? null
    channel.refinedGain = started.refinedGain
  }

  /**
   * Where the channel's source is right now, in seconds into the track --
   * folded back into the loop region for a looping source.
   */
  function positionOf(channel: Channel): number {
    const { source: voice, durationSec } = channel
    // An element knows where it is, loops and buffering stalls included.
    if (voice?.kind === 'element') {
      const current = voice.element.currentTime
      return Number.isFinite(durationSec) && durationSec > 0 ? Math.min(current, durationSec) : current
    }
    const source = voice?.node
    let position = channel.offsetSec + Math.max(0, audioContext.currentTime - channel.startedAt)
    if (!source || !Number.isFinite(durationSec) || durationSec <= 0) return position
    if (source.loop) {
      const loopStart = typeof source.loopStart === 'number' && source.loopStart > 0 ? source.loopStart : 0
      const loopEnd = typeof source.loopEnd === 'number' && source.loopEnd > loopStart ? source.loopEnd : durationSec
      if (position > loopEnd && loopEnd > loopStart) position = loopStart + ((position - loopStart) % (loopEnd - loopStart))
    }
    return Math.min(position, durationSec)
  }

  /**
   * A source finished. If it is still some channel's track, it ran out of
   * audio by itself -- every stop, replacement and crossfade unhooks a source
   * from its channel *before* stopping it -- so the channel is now silent and
   * its owner is told. The generation is deliberately left alone: a crossfade
   * already decoding the next track must still land.
   */
  function handleSourceEnded(source: Voice): void {
    for (const name of CHANNEL_NAMES) {
      const channel = channels[name]
      if (channel.source !== source) continue
      const onEnded = channel.onEnded
      clearChannel(channel)
      try {
        onEnded?.()
      } catch {
        // The owner's bug, never the engine's.
      }
      return
    }
  }

  /**
   * Tells the caller its track is now the one playing. A throwing callback is
   * the caller's bug, never a reason to fail the playback that already began.
   */
  function reportStarted(options: PlayOptions | undefined, started: Started): void {
    try {
      options?.onStarted?.({ durationSec: started.durationSec, offsetSec: started.offsetSec })
    } catch {
      // Ignored: see above.
    }
  }

  function reportError(options: PlayOptions | undefined, error: unknown): void {
    try {
      options?.onError?.(error)
    } catch {
      // Ignored: see reportStarted.
    }
  }

  /**
   * Starts `track` through a fresh gain node -- shared by play() and
   * crossfadeTo(). Streamed through a media element when the streaming
   * binding says so (startStreamedSource), else decoded (cached per track) and
   * played from the buffer.
   *
   * `initialGain` is a *fraction of full volume for this track* (1 for play, 0
   * for the incoming side of a crossfade); the track's own normalisation gain
   * is resolved here and multiplied in, and reported back so the channel can
   * remember what full volume means for it.
   *
   * The gain lookup runs alongside the load rather than after it, and inside
   * this function -- under the caller's generation guard -- so a stop() that
   * lands during the lookup still supersedes it. `isCurrent` is that guard, for
   * a start that can give up early.
   */
  async function startSource(
    track: string,
    initialGain: number,
    channelName: AudioChannelName,
    options: PlayOptions | undefined,
    isCurrent: () => boolean,
  ): Promise<Started> {
    const element = streamingElementFor(track, channelName)
    if (element) return startStreamedSource(element, track, initialGain, channelName, options, isCurrent)
    return startBufferSource(track, initialGain, channelName, options)
  }

  /** A fresh element to stream `track` through, or null when it is to be decoded instead. */
  function streamingElementFor(track: string, channelName: AudioChannelName): MediaElementLike | null {
    if (!streaming || typeof audioContext.createMediaElementSource !== 'function') return null
    try {
      if (!streaming.shouldStream(track, channelName)) return null
      return (streaming.createElement ?? defaultMediaElement)()
    } catch {
      return null
    }
  }

  async function startBufferSource(
    track: string,
    initialGain: number,
    channelName: AudioChannelName,
    options: PlayOptions | undefined,
  ): Promise<Started> {
    const declick = channelNeedsDeclick(channelName)
    // `cache: false` never *adds* a whole song to the cache, but still reuses
    // one already there (the results bed of a song previewed before it was sung).
    const bufferPromise = loadCachedBuffer(track, declick, options?.cache !== false)
    const [buffer, resolved] = await Promise.all([bufferPromise, resolveTrackGain(track, { buffer: bufferPromise })])
    const info = toTrackInfo(resolved)
    const trackGain = Number.isFinite(info.gain) && info.gain >= 0 ? info.gain : 1

    const source = audioContext.createBufferSource()
    source.buffer = buffer
    source.loop = options?.loop !== false

    const fromPreviewStart = channelName === 'preview' || options?.startAtPreview === true
    const startOffset = fromPreviewStart
      ? previewStartOffset(buffer.duration, options?.previewStartSec ?? info.previewStartSec)
      : 0

    if (startOffset > 0 && source.loop) {
      source.loopStart = startOffset
      if (typeof buffer.duration === 'number' && Number.isFinite(buffer.duration)) {
        source.loopEnd = buffer.duration
      }
    }

    const gainNode = audioContext.createGain()
    gainNode.gain.value = initialGain * trackGain

    const voice = bufferVoice(source)
    source.onended = () => handleSourceEnded(voice)
    source.connect(gainNode)
    // The effect (if any) sits after the track's gain node, so fades and
    // normalisation drive what goes *into* the room and the reverb tail rings
    // out naturally after a stop.
    gainNode.connect(connectEffect(audioContext, options?.effect, outputFor(channelName)))
    source.start(0, startOffset)

    const durationSec = typeof buffer.duration === 'number' ? buffer.duration : Number.NaN
    return {
      source: voice,
      gainNode,
      trackGain,
      refinedGain: info.refinedGain,
      durationSec,
      offsetSec: startOffset,
      startedAt: audioContext.currentTime,
    }
  }

  /**
   * Wires `element` into the graph as a voice: element -> its source node -> a
   * short edge fade -> `output`, which the caller connects to the track's gain
   * node.
   *
   * The edge fade is the streamed counterpart of the buffer path's declick
   * (LOOP_DECLICK_SECONDS): playback opens mid-song, on whatever sample the
   * start point lands on, and a loop jumps from the end back to it -- both
   * clicks without a few ms of fade-in.
   */
  function createElementVoice(element: MediaElementLike, mediaNode: MediaElementSourceNodeLike) {
    const edge = audioContext.createGain()
    edge.gain.value = 0
    mediaNode.connect(edge)

    let released = false
    let stopTimer: ReturnType<typeof setTimeout> | null = null
    /** The context time the pending stop is due at. */
    let stopDue = Number.POSITIVE_INFINITY

    function fadeEdgeIn(): void {
      const now = audioContext.currentTime
      cancelAutomation(edge, now)
      edge.gain.setValueAtTime(0, now)
      edge.gain.linearRampToValueAtTime(1, now + LOOP_DECLICK_SECONDS)
    }

    /** Pauses, unhooks and empties the element, so neither it nor its decoder outlives the track. Idempotent. */
    function release(): void {
      if (released) return
      released = true
      if (stopTimer !== null) clearTimeout(stopTimer)
      stopTimer = null
      element.removeEventListener('ended', onEnded)
      try {
        element.pause()
      } catch {
        // Best-effort teardown, like stopBufferSource.
      }
      try {
        mediaNode.disconnect()
        edge.disconnect?.()
      } catch {
        // Already disconnected.
      }
      try {
        element.removeAttribute('src')
        element.load()
      } catch {
        // Nothing left to unload.
      }
    }

    const voice: ElementVoice = {
      kind: 'element',
      element,
      loop: false,
      loopStart: 0,
      stop(when?: number) {
        if (released) return
        const now = audioContext.currentTime
        const due = when === undefined ? now : Math.max(now, when)
        // An earlier stop already pending wins, as the earlier fade does.
        if (due >= stopDue) return
        stopDue = due
        if (stopTimer !== null) clearTimeout(stopTimer)
        stopTimer = null
        if (when === undefined) {
          release()
          return
        }
        stopTimer = setTimeout(release, (due - now) * 1000 + STREAM_RELEASE_MARGIN_MS)
      },
    }

    /**
     * The element played out. A looping voice goes back to its start point (an
     * element's own `loop` would go back to 0, not to the preview start);
     * anything else is over: its channel is told, and the element released.
     */
    function onEnded(): void {
      if (released) return
      if (voice.loop) {
        cancelAutomation(edge, audioContext.currentTime)
        edge.gain.setValueAtTime(0, audioContext.currentTime)
        element.currentTime = voice.loopStart
        void element.play().then(fadeEdgeIn, () => {})
        return
      }
      handleSourceEnded(voice)
      release()
    }
    element.addEventListener('ended', onEnded)

    async function begin(): Promise<void> {
      await element.play()
      fadeEdgeIn()
    }

    return { voice, output: edge, begin, release }
  }

  /**
   * startSource() for a streamed track. The element loads just enough to know
   * the track's length (for the preview-start heuristic) while the loudness
   * lookup runs alongside, seeks to the start point and plays: the track is
   * audible as soon as the audio there has arrived, not once the whole file is
   * decoded.
   *
   * Between those steps a newer call on the channel (`isCurrent` false) ends
   * the start early, so browsing quickly through songs never leaves a queue of
   * elements loading songs nobody will hear. Whatever fails releases the
   * element before the error goes back to the caller.
   */
  async function startStreamedSource(
    element: MediaElementLike,
    track: string,
    initialGain: number,
    channelName: AudioChannelName,
    options: PlayOptions | undefined,
    isCurrent: () => boolean,
  ): Promise<Started> {
    element.preload = 'auto'
    // A MediaElementAudioSourceNode outputs silence for media the page may not
    // read, so the request is made in CORS mode (the media schemes are
    // registered corsEnabled -- electron/privileged-schemes.cjs).
    element.crossOrigin = 'anonymous'
    element.src = track
    const mediaNode = audioContext.createMediaElementSource!(element)
    const { voice, output, begin, release } = createElementVoice(element, mediaNode)
    try {
      const [, resolved] = await Promise.all([waitForMetadata(element, track), resolveTrackGain(track, {})])
      if (!isCurrent()) throw new SupersededError()
      const info = toTrackInfo(resolved)
      const trackGain = Number.isFinite(info.gain) && info.gain >= 0 ? info.gain : 1

      const durationSec = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : Number.NaN
      const fromPreviewStart = channelName === 'preview' || options?.startAtPreview === true
      const startOffset = fromPreviewStart
        ? previewStartOffset(durationSec, options?.previewStartSec ?? info.previewStartSec)
        : 0
      voice.loop = options?.loop !== false
      voice.loopStart = startOffset

      const gainNode = audioContext.createGain()
      gainNode.gain.value = initialGain * trackGain
      output.connect(gainNode)
      // The effect sits after the track's gain node, exactly as for a buffer.
      gainNode.connect(connectEffect(audioContext, options?.effect, outputFor(channelName)))

      if (startOffset > 0) element.currentTime = startOffset
      await begin()
      if (!isCurrent()) throw new SupersededError()

      return {
        source: voice,
        gainNode,
        trackGain,
        refinedGain: info.refinedGain,
        durationSec,
        offsetSec: startOffset,
        startedAt: audioContext.currentTime,
      }
    } catch (error) {
      release()
      throw error
    }
  }

  /**
   * A measurement that lands after the track started: fade the channel to the
   * level it should have had, unless the channel has moved on since.
   */
  function applyRefinedGain(channelName: AudioChannelName, generation: number, refined: Promise<number | null> | undefined): void {
    if (!refined) return
    void refined
      .then((gain) => {
        const channel = channels[channelName]
        if (gain === null || !Number.isFinite(gain) || gain < 0) return
        if (channel.generation !== generation || !channel.gain) return
        channel.trackGain = gain
        scheduleGainRamp(audioContext, channel.gain, channel.fraction * gain, REFINED_GAIN_RAMP_MS)
      })
      .catch(() => {})
  }

  async function play(track: string, channelName: AudioChannelName = DEFAULT_AUDIO_CHANNEL, options?: PlayOptions): Promise<void> {
    ensureRunning()
    const channel = channels[channelName]
    const generation = ++channel.generation

    let started: Started
    try {
      started = await startSource(track, 1, channelName, options, () => channel.generation === generation)
    } catch (error) {
      if (channel.generation === generation) reportError(options, error)
      return
    }

    const { source, refinedGain } = started

    // Superseded while decoding (a second play(), a crossfadeTo(), or a stop()
    // landed on this channel). Tear the just-started source down rather than
    // installing it.
    if (channel.generation !== generation) {
      source.stop()
      return
    }

    // The outgoing source is stopped only now that its replacement is already
    // running, so replacing a track never opens a silent gap. (Installed
    // first, so the outgoing source's end never reads as a track playing out.)
    const outgoing = channel.source
    install(channel, track, started, options)
    if (outgoing) outgoing.stop()
    applyRefinedGain(channelName, generation, refinedGain)
    reportStarted(options, started)
  }

  function duckTo(volume: number, ms: number, channelName: AudioChannelName = DEFAULT_AUDIO_CHANNEL): void {
    ensureRunning()
    const channel = channels[channelName]
    if (!channel.gain) return
    // `volume` is a fraction of full volume, and full volume for this channel
    // is whatever the current track's normalisation gain made it.
    channel.fraction = volume
    scheduleGainRamp(audioContext, channel.gain, volume * channel.trackGain, ms)
  }

  function restore(ms: number, channelName: AudioChannelName = DEFAULT_AUDIO_CHANNEL): void {
    ensureRunning()
    const channel = channels[channelName]
    if (!channel.gain) return
    channel.fraction = 1
    scheduleGainRamp(audioContext, channel.gain, channel.trackGain, ms)
  }

  async function crossfadeTo(
    track: string,
    ms: number,
    channelName: AudioChannelName = DEFAULT_AUDIO_CHANNEL,
    options?: PlayOptions,
  ): Promise<void> {
    ensureRunning()
    const channel = channels[channelName]
    const outgoingGain = channel.gain
    const outgoingSource = channel.source
    const generation = ++channel.generation

    let started: Started
    try {
      started = await startSource(track, 0, channelName, options, () => channel.generation === generation)
    } catch (error) {
      if (channel.generation === generation) reportError(options, error)
      return
    }

    const { source, gainNode, trackGain, refinedGain } = started

    if (channel.generation !== generation) {
      source.stop()
      return
    }

    // Installed first, so the outgoing source is no longer the channel's track
    // by the time its scheduled stop fires (which would otherwise read as the
    // track having played out).
    install(channel, track, started, options)

    if (options?.fadeCurve === 'equal-power') {
      scheduleEqualPowerFade(audioContext, gainNode, trackGain, ms, 'in')
      if (outgoingGain) scheduleEqualPowerFade(audioContext, outgoingGain, 0, ms, 'out')
    } else {
      scheduleGainRamp(audioContext, gainNode, trackGain, ms)
      if (outgoingGain) scheduleGainRamp(audioContext, outgoingGain, 0, ms)
    }
    // Schedule the outgoing source's stop for the moment its fade reaches
    // zero: stopping it any earlier is the click the fade exists to avoid, and
    // never stopping it leaks a looping source per crossfade.
    if (outgoingSource) outgoingSource.stop(audioContext.currentTime + ms / 1000)

    applyRefinedGain(channelName, generation, refinedGain)
    reportStarted(options, started)
  }

  function stop(ms: number, channelName: AudioChannelName = DEFAULT_AUDIO_CHANNEL): void {
    const channel = channels[channelName]
    // Bumped even when there is nothing to stop: a play()/crossfadeTo() still
    // awaiting its decode for this channel must not install its source after
    // the caller has asked for silence.
    channel.generation++

    const { source, gain } = channel
    // Idempotent -- clearing the refs is what makes a second stop() (the
    // unmount cleanup that follows a launch handler, say) a no-op rather than a
    // second, longer ramp restarted from a half-faded value.
    if (!source) return
    clearChannel(channel)

    if (gain) scheduleGainRamp(audioContext, gain, 0, ms)
    source.stop(audioContext.currentTime + ms / 1000)
  }

  /**
   * Swaps two channels' mixer buses and glides each to its new role's level.
   *
   * This is what makes a handover seamless: the handed-over source stays
   * wired to the very same nodes, so not one connection changes -- the bus it
   * sits on simply *becomes* the other channel's bus, and its level moves from
   * the old role's mixer gain to the new one's on the audio clock. Anything
   * still fading out on either bus (the tail of a crossfade) travels with its
   * bus and finishes its fade there.
   */
  function swapBuses(a: AudioChannelName, b: AudioChannelName, ms: number): void {
    if (!mixer) return
    outputFor(a)
    outputFor(b)
    const busA = buses[a]
    buses[a] = buses[b]
    buses[b] = busA
    for (const name of [a, b]) {
      const bus = buses[name]
      if (bus) scheduleGainRamp(audioContext, bus, mixer.gainFor(name), ms)
    }
  }

  function transfer(from: AudioChannelName, to: AudioChannelName, ms: number, options?: TransferOptions): TransferredTrack | null {
    if (from === to) return null
    const outgoing = channels[from]
    const { source, gain, track } = outgoing
    if (!source || !gain || track === null) return null
    if (options?.track !== undefined && options.track !== track) return null
    ensureRunning()

    // Measured before anything about the source changes, and the new channel
    // is re-anchored on it, so the position stays right if looping is
    // switched off below.
    const positionSec = positionOf(outgoing)

    // Whatever the destination still had makes room, on the usual fade.
    stop(ms, to)
    const incoming = channels[to]
    const generation = ++incoming.generation
    incoming.source = source
    incoming.gain = gain
    incoming.trackGain = outgoing.trackGain
    incoming.fraction = outgoing.fraction
    incoming.track = track
    incoming.startedAt = audioContext.currentTime
    incoming.offsetSec = positionSec
    incoming.durationSec = outgoing.durationSec
    incoming.onEnded = options?.onEnded ?? null
    incoming.refinedGain = outgoing.refinedGain
    if (options?.loop !== undefined) source.loop = options.loop

    // The source channel is empty now, and anything still decoding for it
    // (the next menu song of a pending crossfade) is superseded.
    outgoing.generation++
    clearChannel(outgoing)

    swapBuses(from, to, ms)
    applyRefinedGain(to, generation, incoming.refinedGain)
    return { track, durationSec: incoming.durationSec, positionSec }
  }

  return { play, duckTo, restore, crossfadeTo, stop, transfer }
}