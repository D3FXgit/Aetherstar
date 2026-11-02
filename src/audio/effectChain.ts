// Effect chains a track can be played through (PlayOptions.effect), built from
// plain Web Audio nodes between the track's own gain node and its channel bus.
//
//   muffled   track gain -> low-pass -> high-shelf --+--> dry ---------------+--> level -> bus
//                                                    +--> convolver -> wet --+
//
// The tuning lives in src/audio/resultsBed.ts. Each node type is optional on
// AudioContextLike, and a chain is built from whatever the context offers: no
// filters means no filtering, no convolver means no room -- but the level is
// always applied, so a reduced context still plays the bed quieter rather than
// at full level.
import type { AudioEffectName } from './audioManagerContract'
import type { AudioContextLike, BiquadFilterNodeLike, ConvolverNodeLike, GainNodeLike } from './webAudioApi'
import { RESULTS_BED_EFFECT, dbToGain, type MuffledEffectConfig } from './resultsBed'

/** Used when a context does not report its own rate (test doubles). */
const FALLBACK_SAMPLE_RATE = 48000

/** Fixed seeds: the "room" sounds the same every time, and tests are deterministic. */
const IMPULSE_SEED = 0x5eed

/** The built `muffled` chain. `input` is where the track connects; the rest is exposed for tests. */
export interface MuffledChain {
  input: GainNodeLike | BiquadFilterNodeLike
  lowpass: BiquadFilterNodeLike | null
  highShelf: BiquadFilterNodeLike | null
  convolver: ConvolverNodeLike | null
  dry: GainNodeLike
  wet: GainNodeLike | null
  level: GainNodeLike
}

/** mulberry32: a tiny seeded PRNG, uniform in [0, 1). */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A small room's impulse response: `preDelayMs` of silence, then stereo white
 * noise (independent per channel, for width) decaying exponentially to -60 dB
 * over `seconds`. Null when the context cannot make buffers.
 */
export function createRoomImpulse(context: AudioContextLike, seconds: number, preDelayMs: number): AudioBuffer | null {
  if (typeof context.createBuffer !== 'function') return null
  const rate = context.sampleRate
  const sampleRate = typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : FALLBACK_SAMPLE_RATE
  const preDelay = Math.max(0, Math.round((preDelayMs / 1000) * sampleRate))
  const tail = Math.max(1, Math.round(Math.max(0, seconds) * sampleRate))
  const buffer = context.createBuffer(2, preDelay + tail, sampleRate)

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    const random = seededRandom(IMPULSE_SEED + channel * 7919)
    for (let i = 0; i < tail; i++) {
      // 10^(-3t): amplitude -60 dB at t = 1, i.e. an RT60 of `seconds`.
      data[preDelay + i] = (random() * 2 - 1) * Math.pow(10, (-3 * i) / tail)
    }
  }
  return buffer
}

/** One impulse per context and shape: generating ~1.5 s of stereo noise is not free. */
const impulseCache = new WeakMap<AudioContextLike, Map<string, AudioBuffer>>()

function cachedRoomImpulse(context: AudioContextLike, seconds: number, preDelayMs: number): AudioBuffer | null {
  const key = `${seconds}:${preDelayMs}`
  let perContext = impulseCache.get(context)
  const cached = perContext?.get(key)
  if (cached) return cached
  const impulse = createRoomImpulse(context, seconds, preDelayMs)
  if (!impulse) return null
  if (!perContext) {
    perContext = new Map()
    impulseCache.set(context, perContext)
  }
  perContext.set(key, impulse)
  return impulse
}

/** Builds the `muffled` chain into `output` and returns it; connect the track to `chain.input`. */
export function buildMuffledChain(
  context: AudioContextLike,
  output: unknown,
  config: MuffledEffectConfig = RESULTS_BED_EFFECT,
): MuffledChain {
  const level = context.createGain()
  level.gain.value = dbToGain(config.levelDb)
  level.connect(output)

  let lowpass: BiquadFilterNodeLike | null = null
  let highShelf: BiquadFilterNodeLike | null = null
  if (typeof context.createBiquadFilter === 'function') {
    lowpass = context.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = config.lowpassHz
    lowpass.Q.value = config.lowpassQ

    highShelf = context.createBiquadFilter()
    highShelf.type = 'highshelf'
    highShelf.frequency.value = config.highShelfHz
    highShelf.gain.value = config.highShelfDb
    lowpass.connect(highShelf)
  }

  // The point the dry and wet paths fan out from: the end of the filters, or a
  // plain unity node when there are none.
  const input: GainNodeLike | BiquadFilterNodeLike = lowpass ?? context.createGain()
  const fanOut = highShelf ?? input

  let convolver: ConvolverNodeLike | null = null
  let wet: GainNodeLike | null = null
  const impulse = typeof context.createConvolver === 'function' ? cachedRoomImpulse(context, config.reverbSeconds, config.reverbPreDelayMs) : null
  if (impulse && typeof context.createConvolver === 'function') {
    convolver = context.createConvolver()
    // Set before the buffer: normalisation is applied when the buffer is assigned.
    convolver.normalize = true
    convolver.buffer = impulse
    wet = context.createGain()
    wet.gain.value = config.wet
    fanOut.connect(convolver)
    convolver.connect(wet)
    wet.connect(level)
  }

  const dry = context.createGain()
  // No room to send to: the direct path carries the whole level on its own.
  dry.gain.value = convolver ? config.dry : config.dry + config.wet
  fanOut.connect(dry)
  dry.connect(level)

  return { input, lowpass, highShelf, convolver, dry, wet, level }
}

/**
 * Builds `effect` into `output` and returns the node to connect the track to.
 * Building is best-effort: a context that throws while making the chain gets
 * `output` back, i.e. the track plays dry rather than not at all.
 */
export function connectEffect(context: AudioContextLike, effect: AudioEffectName | undefined, output: unknown): unknown {
  if (!effect) return output
  try {
    switch (effect) {
      case 'muffled':
        return buildMuffledChain(context, output).input
    }
  } catch {
    // Fall through to dry.
  }
  return output
}
