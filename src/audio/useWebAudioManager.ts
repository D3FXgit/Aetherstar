import { create } from 'zustand'
import type { AudioChannelName, AudioManager } from './audioManagerContract'
import { getSharedAudioContext } from './webAudioApi'
import {
  createWebAudioManager,
  type MixerBinding,
  type StreamingBinding,
  type TrackGainResolver,
  type TrackInfo,
} from './webAudioManager'
import { analyseSongLoudness, loadSongInfo, loadSongLoudness, measureSongFromBuffer, songFolderForMedia } from './songGain'
import { computeLoudnessGain, hasLoudnessMeasurement, MAX_NORMALISATION_GAIN, type SongLoudness } from './loudness'
import { getMixerGain, subscribeMixer, type MixerChannel } from './mixer'

/**
 * Engine channel to mixer channel: the `music` bus is the menu music; the
 * `preview` bus and the `results` bus (the sung song behind the results
 * screen) play songs, so the Music slider sets their level.
 */
export function mixerChannelFor(channel: AudioChannelName): MixerChannel {
  return channel === 'music' ? 'menuMusic' : 'music'
}

/**
 * The stage ceiling for previews: on stage the song's `<audio>` element plays
 * at min(normalisation x music volume, 1), so a preview must too -- and must
 * stay there while the Music slider moves *during* the preview. The cap
 * therefore lives on the preview bus, recomputed on every mixer change, rather
 * than being baked into the track's gain once at start (which let a slider
 * raised mid-preview play it up to +6 dB louder than the stage would).
 *
 * The track's gain node carries the plain normalisation gain N; the bus
 * carries min(music, 1/N), so the product is exactly min(N x music, 1).
 *
 * The menu-music bus gets the same ceiling against the Menu music slider: when
 * it plays a library song (src/audio/menuMusic.ts) that song is normalised
 * exactly like its preview, and must not be boosted past full scale either.
 * The bundled loop has no measurement and is never boosted (N = 1).
 */
const latestTrack: Record<AudioChannelName, string | null> = { music: null, preview: null, results: null }
/** Normalisation gain of the track each bus is capped for (1: no boost to cap). */
const normalisation: Record<AudioChannelName, number> = { music: 1, preview: 1, results: 1 }
const ceilingListeners = new Set<() => void>()

function notifyCeiling(): void {
  for (const listener of ceilingListeners) listener()
}

function recordNormalisation(track: string, gain: number): void {
  if (!Number.isFinite(gain) || gain <= 0) return
  let changed = false
  for (const channel of ['music', 'preview', 'results'] as const) {
    if (latestTrack[channel] !== track || normalisation[channel] === gain) continue
    normalisation[channel] = gain
    changed = true
  }
  if (changed) notifyCeiling()
}

/** The preview bus gain: the Music slider, capped so normalisation x bus never exceeds 1. */
export function previewBusGain(): number {
  return Math.min(getMixerGain('music'), 1 / normalisation.preview)
}

/** The menu-music bus gain: the Menu music slider, capped the same way for a library song. */
export function menuMusicBusGain(): number {
  return Math.min(getMixerGain(mixerChannelFor('music')), 1 / normalisation.music)
}

/**
 * The results bus gain: the Music slider with the preview's stage ceiling. The
 * bed's own -13 dB (or so) is in its effect chain (resultsBed.ts), so it stays
 * that far below the song as it was sung whatever the slider says.
 */
export function resultsBusGain(): number {
  return Math.min(getMixerGain(mixerChannelFor('results')), 1 / normalisation.results)
}

function busGainFor(channel: AudioChannelName): number {
  switch (channel) {
    case 'preview':
      return previewBusGain()
    case 'results':
      return resultsBusGain()
    case 'music':
      return menuMusicBusGain()
  }
}

export const mixerBinding: MixerBinding = {
  gainFor: busGainFor,
  subscribe: (listener) => {
    const unsubscribeMixer = subscribeMixer(() => listener())
    ceilingListeners.add(listener)
    return () => {
      unsubscribeMixer()
      ceilingListeners.delete(listener)
    }
  },
}

/** A preview's loudness-normalisation gain; the stage ceiling is applied on the bus (previewBusGain). */
function previewGain(loudness: SongLoudness): number {
  return computeLoudnessGain({ ...loudness, maxGain: MAX_NORMALISATION_GAIN })
}

/** Test seam: forget which tracks the buses are capped for. */
export function resetPreviewCeilingForTests(): void {
  latestTrack.music = null
  latestTrack.preview = null
  latestTrack.results = null
  normalisation.music = 1
  normalisation.preview = 1
  normalisation.results = 1
}

/**
 * Remember the track about to start on a bus, so its normalisation is the one
 * the bus caps. Anything that is not library media on the menu bus -- the
 * bundled loop -- is never boosted, so the menu cap lifts straight away.
 */
function noteTrack(track: string, channel: AudioChannelName | undefined): void {
  const bus = channel ?? 'music'
  latestTrack[bus] = track
  if (bus === 'music' && !songFolderForMedia(track) && normalisation.music !== 1) {
    normalisation.music = 1
    notifyCeiling()
  }
}

/**
 * How long a streamed song with no loudness measurement has to stay on a bus
 * before it is measured. Measuring means fetching and decoding the whole file
 * (analyseSongLoudness), so it is kept for a song someone is actually
 * listening to -- not every song skimmed past while browsing.
 */
export const STREAMED_MEASURE_DELAY_MS = 2000

/** Whether `track` is still the latest track on any bus. */
function isOnABus(track: string): boolean {
  return latestTrack.music === track || latestTrack.preview === track || latestTrack.results === track
}

/**
 * The loudness gain of a streamed, unmeasured song, from a measurement made in
 * the background: after STREAMED_MEASURE_DELAY_MS, if the song is still
 * playing, through analyseSongLoudness -- the stage's renderer measurement,
 * with its own gameplay-idle gating. Entirely off the start path: playback
 * never waits for it. Null when there is nothing (new) to apply.
 */
function measureStreamedInBackground(track: string, folder: string): Promise<number | null> {
  return new Promise<void>((resolve) => setTimeout(resolve, STREAMED_MEASURE_DELAY_MS))
    .then(() => (isOnABus(track) ? analyseSongLoudness(folder, { mediaUrl: track }) : null))
    .then((measured) => (measured && hasLoudnessMeasurement(measured) ? previewGain(measured) : null))
}

/**
 * Joins the pure engine to the song library: a track URL becomes that song's
 * loudness gain and #PREVIEWSTART -- for a preview and for a library song
 * played as menu music alike, so both sit at the same level. Anything that is
 * not library media -- the bundled menu loop above all -- resolves to 1
 * without an IPC call. A song with no measurement starts at the conservative
 * default and is measured -- from the buffer the engine is decoding, or, for a
 * streamed song, in the background (measureStreamedInBackground); the engine
 * fades to the real level.
 */
export const resolvePreviewTrack: TrackGainResolver = async (track, { buffer }) => {
  const folder = songFolderForMedia(track)
  if (!folder) return 1

  const [info, loudness] = await Promise.all([loadSongInfo(folder), loadSongLoudness(folder)])
  const gain = previewGain(loudness)
  recordNormalisation(track, gain)
  const result: TrackInfo = { gain, previewStartSec: info.previewStartSec }
  if (!hasLoudnessMeasurement(loudness)) {
    const refined = buffer
      ? buffer
          .then((decoded) => measureSongFromBuffer(folder, decoded))
          .then((measured) => (measured && hasLoudnessMeasurement(measured) ? previewGain(measured) : null))
      : measureStreamedInBackground(track, folder)
    result.refinedGain = refined
      .then((measuredGain) => {
        if (measuredGain !== null) recordNormalisation(track, measuredGain)
        return measuredGain
      })
      .catch(() => null)
  }
  return result
}

/**
 * A transfer moves a source -- and, inside the engine, the very bus it sits
 * on -- from one channel to the other, so the ceiling bookkeeping has to
 * follow it: the channel that receives the track is now capped for that
 * track's normalisation. No notification: the engine ramps both buses to their
 * new levels itself, over the handover's own (longer) glide.
 */
function swapCeilings(a: AudioChannelName, b: AudioChannelName): void {
  ;[latestTrack[a], latestTrack[b]] = [latestTrack[b], latestTrack[a]]
  ;[normalisation[a], normalisation[b]] = [normalisation[b], normalisation[a]]
}

/**
 * Songs -- library media, whichever bus plays them -- are streamed through a
 * media element, so a newly selected preview is heard as soon as the audio at
 * its start point arrives instead of once the whole file is decoded. Anything
 * else (the bundled menu loop, which must loop seamlessly) is decoded whole.
 */
export const streamingBinding: StreamingBinding = {
  shouldStream: (track) => songFolderForMedia(track) !== null,
}

let engine: AudioManager | null = null

function getEngine(): AudioManager {
  if (!engine) engine = createWebAudioManager(getSharedAudioContext, resolvePreviewTrack, mixerBinding, streamingBinding)
  return engine
}

/** The real counterpart to `useMockAudioManager` -- lazily constructs the real Web Audio engine on its first action. */
export const useWebAudioManager = create<AudioManager>(() => ({
  // The channel argument is forwarded verbatim, `undefined` included, so the
  // engine's own default (`music`) stays the single definition of it.
  // Options are forwarded only when given, so every existing caller's call
  // reaches the engine in exactly the shape it always had.
  play: (track, channel, options) => {
    noteTrack(track, channel)
    return options === undefined ? getEngine().play(track, channel) : getEngine().play(track, channel, options)
  },
  duckTo: (volume, ms, channel) => getEngine().duckTo(volume, ms, channel),
  restore: (ms, channel) => getEngine().restore(ms, channel),
  crossfadeTo: (track, ms, channel, options) => {
    noteTrack(track, channel)
    return options === undefined ? getEngine().crossfadeTo(track, ms, channel) : getEngine().crossfadeTo(track, ms, channel, options)
  },
  stop: (ms, channel) => getEngine().stop(ms, channel),
  transfer: (from, to, ms, options) => {
    const current = getEngine()
    if (!current.transfer || from === to) return null
    // Swapped first, because the engine reads the new levels while it swaps
    // the buses; swapped back if there turned out to be nothing to hand over.
    swapCeilings(from, to)
    const moved = current.transfer(from, to, ms, options)
    if (!moved) swapCeilings(from, to)
    return moved
  },
}))