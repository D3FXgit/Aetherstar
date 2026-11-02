// Per-song loudness normalisation: measured integrated loudness -> playback gain.
// Target -18 LUFS (ReplayGain 2.0), not the louder streaming targets, because the
// in-game <audio> volume cannot exceed 1: a quiet song can only be raised as far
// as the user's volume leaves headroom. Gain is clamped to [-20, +12] dB and a
// boost is capped so the true peak stays at or under -1 dBTP.

/** ReplayGain 2.0's reference level, and this app's normalisation target. See the header. */
export const LOUDNESS_TARGET_LUFS = -18

/** The most normalisation will ever take off a song. A -2 LUFS brickwall master needs 16 dB; nothing real needs more than 20. */
export const MIN_NORMALISATION_DB = -20

/** The most normalisation will ever add to a song, before the true-peak cap. */
export const MAX_NORMALISATION_DB = 12

/**
 * The true-peak ceiling a *boost* is never allowed to cross.
 *
 * -1 dBTP is the EBU R 128 / AES streaming-delivery ceiling: it leaves room for
 * the inter-sample peaks a reconstruction filter produces between the samples
 * that were actually stored, which is what makes a file measuring exactly
 * 0 dBFS still distort on real hardware.
 */
export const TRUE_PEAK_CEILING_DBTP = -1

/**
 * The gain for a song that has not been analysed yet.
 *
 * Not unity: a song nobody has measured is, statistically, a modern master
 * around -10..-12 LUFS, so playing it untouched is ~7 dB louder than every
 * normalised song around it -- exactly the jump this feature exists to remove.
 * -6 dB lands a typical unmeasured song near the target and errs quiet rather
 * than loud for an unusually hot one. It is only ever transient: the renderer
 * measures the song itself the first time it decodes it (songGain.ts) and the
 * result is remembered.
 */
export const UNMEASURED_GAIN_DB = -6

/**
 * The most an `HTMLMediaElement` can be asked for. Setting `volume` outside
 * 0..1 throws (`IndexSizeError`), so this is a hard property of the transport,
 * not a policy choice.
 */
export const MAX_ELEMENT_GAIN = 1

/** The full +12 dB: the ceiling for the normalisation gain on its own, before the user's volume and the transport cap. */
export const MAX_NORMALISATION_GAIN = 10 ** (MAX_NORMALISATION_DB / 20)

export interface SongLoudness {
  /** Integrated loudness (EBU R 128). Null/undefined on a song that has never been analysed. */
  loudnessLufs?: number | null
  /** True peak in dBTP. Only ever used to keep a boost from clipping. */
  truePeakDbtp?: number | null
  /** `#VOLUME` from the chart, when its author declared one: a linear multiplier applied on top of the measurement. */
  chartVolume?: number | null
}

export interface LoudnessGainInput extends SongLoudness {
  /** Ceiling for the returned gain. 1 for an `<audio>` element; MAX_NORMALISATION_GAIN before composing with a user volume. */
  maxGain?: number
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** dB -> linear amplitude ratio. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20)
}

/** Linear amplitude ratio -> dB. Returns -Infinity for silence, which is the honest answer. */
export function gainToDb(gain: number): number {
  return 20 * Math.log10(gain)
}

/** True when there is a measurement normalisation can act on. */
export function hasLoudnessMeasurement(loudness: SongLoudness | null | undefined): boolean {
  return finiteOrNull(loudness?.loudnessLufs) !== null
}

/**
 * The linear gain to play a song at.
 *
 * Composition, in order:
 *
 * 1. **Normalisation.** `target - measured` dB, clamped to [-20, +12] dB. A
 *    song with no measurement gets UNMEASURED_GAIN_DB (see its comment).
 *
 * 2. **The chart author's trim.** `#VOLUME` multiplies the result rather than
 *    replacing it: `#VOLUME:1` is a no-op and `#VOLUME:0.7` is an extra author
 *    trim on top of the measurement.
 *
 * 3. **The peak limit.** Only ever a limit on *boost*: a total above 0 dB is
 *    pulled down so the true peak stays at or under -1 dBTP, and it is never
 *    allowed to push the gain *below* unity -- attenuating a file further than
 *    the target asks, to fix distortion already baked into it, would make it
 *    quieter than every other song. With no peak measurement there is no boost.
 *
 * 4. **The transport ceiling.** `maxGain`, 1 by default.
 */
export function computeLoudnessGain(input: LoudnessGainInput = {}): number {
  const { maxGain = MAX_ELEMENT_GAIN } = input

  const measured = finiteOrNull(input.loudnessLufs)
  const normalisationDb =
    measured === null
      ? UNMEASURED_GAIN_DB
      : Math.min(MAX_NORMALISATION_DB, Math.max(MIN_NORMALISATION_DB, LOUDNESS_TARGET_LUFS - measured))

  // A non-positive or unparseable #VOLUME is treated as absent rather than as
  // "play this song silently": a chart that declares nonsense must not be able
  // to mute itself.
  const declared = finiteOrNull(input.chartVolume)
  const authorTrimDb = declared !== null && declared > 0 ? gainToDb(declared) : 0

  let totalDb = normalisationDb + authorTrimDb
  if (totalDb > 0) {
    const truePeak = finiteOrNull(input.truePeakDbtp)
    const headroomDb = truePeak === null ? 0 : Math.max(0, TRUE_PEAK_CEILING_DBTP - truePeak)
    totalDb = Math.min(totalDb, headroomDb)
  }

  return Math.min(Math.max(dbToGain(totalDb), 0), maxGain)
}

/**
 * Normalisation first, the user's volume on top, then the transport ceiling.
 *
 * Capping only the *product* is deliberate: a quiet song that wants +3 dB,
 * played with the music slider at -6 dB, comes out at -3 dB -- it keeps its
 * place relative to every other song even though an element cannot go above
 * 1.0 on its own.
 */
export function composeSongVolume(normalisationGain: number, mixerGain: number, maxGain: number = MAX_ELEMENT_GAIN): number {
  const product = normalisationGain * mixerGain
  if (!Number.isFinite(product) || product <= 0) return 0
  return Math.min(product, maxGain)
}
