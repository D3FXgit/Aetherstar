import type { PitchSample } from '../../contracts/types'
import type { NoteJudgement, NoteWithId } from '../types'
import { DEFAULT_TOLERANCE_SEMITONES, isWithinSemitoneTolerance, matchPitch, TOLERANCE_BANDS_CENTS } from './hzToPitchClass'
import { meanDeviationCents, measureCoverage, type CoverageSample } from './noteCoverage'
import type { createClockBuffer } from './reconcileClock'
import { isRapKind } from '../scoring/scoringPlan'

/** Sentinel deviation for a note with zero in-span samples (silence): finite, the furthest an octave-agnostic match can be. */
export const NO_SIGNAL_DEVIATION_CENTS = 600

/**
 * The verdict for a freestyle note. Freestyle is unscored: worth 0, excluded
 * from the maximum, and given no feedback -- callers must not emit a hit for
 * it at all (Gameplay skips freestyle notes before judging).
 */
export const UNSCORED_JUDGEMENT: NoteJudgement = Object.freeze({
  tier: 'awful',
  deviationCents: 0,
  coverage: 0,
  credit: 0,
  beatsHit: 0,
  beatsCharged: 0,
}) as NoteJudgement

/**
 * Judges one note against the live pitch stream, UltraStar-style.
 *
 * Filters samples to those whose reconciled beat falls within the note's
 * [startBeat, startBeat+length) span and measures, beat by beat, whether the
 * singer was in tolerance (see noteCoverage.ts). `credit` -- the fraction of
 * beats hit -- is the share of the note's points earned and of its pill
 * filled.
 *
 * - **Pitched notes** (normal, golden): the sung pitch is rounded to the
 *   nearest semitone, octave-independent, and must land within
 *   `toleranceSemitones` of the note (Easy 2, Normal 1, Hard 0).
 * - **Rap notes** (rap, goldenRap): any voiced sound counts, at any pitch.
 *   Judged on `voicedSamples` (frames the pitch store saw as voiced: pitched,
 *   or loud enough), falling back to the pitched samples when not given.
 * - **Freestyle**: `UNSCORED_JUDGEMENT`, never consults samples.
 *
 * `tier` is visual feedback only: 'awful' = nothing landed, 'epic' = every
 * charged beat landed and (for pitched notes) within the cosmetic
 * `TOLERANCE_BANDS_CENTS.epic` on average, 'good' otherwise.
 */
export function judgeNote(
  note: NoteWithId,
  samples: readonly PitchSample[],
  clockBuffer: ReturnType<typeof createClockBuffer>,
  toleranceSemitones: number = DEFAULT_TOLERANCE_SEMITONES,
  /**
   * Timestamp of the newest audio frame the pipeline has delivered, pitched or
   * not. Beats beyond it are not charged -- audio still in flight is not a
   * singer's silence. Omitted means "everything is in".
   */
  observedUntilMs?: number | null,
  /** Voiced frames at any pitch, for rap notes. */
  voicedSamples?: readonly PitchSample[],
): NoteJudgement {
  if (note.kind === 'freestyle') return UNSCORED_JUDGEMENT

  const rap = isRapKind(note.kind)
  const source = rap ? (voicedSamples ?? samples) : samples
  const inSpan: CoverageSample[] = []
  const noteEndBeat = note.startBeat + note.length

  for (const sample of source) {
    if (!rap) {
      // A level-only frame (hz 0) is not a sung pitch: hzToSemitone(0) is
      // -Infinity and would poison the averaged deviation with NaN.
      if (!Number.isFinite(sample.hz) || sample.hz <= 0) continue
    }

    const beat = clockBuffer.beatAt(sample.t)
    if (beat === null) continue
    if (beat < note.startBeat || beat >= noteEndBeat) continue

    inSpan.push({
      t: sample.t,
      deviationCents: rap ? 0 : matchPitch(sample.hz, note.pitch, toleranceSemitones).deviationCents,
    })
  }

  if (inSpan.length === 0) {
    return {
      tier: 'awful',
      deviationCents: rap ? 0 : NO_SIGNAL_DEVIATION_CENTS,
      coverage: 0,
      credit: 0,
      beatsHit: 0,
      beatsCharged: Math.max(0, note.length),
    }
  }

  // Circular: deviations are octave-folded, so +599 and -599 are neighbours, not opposites.
  const averageDeviationCents = rap ? 0 : meanDeviationCents(inSpan)

  const result = measureCoverage(
    inSpan,
    clockBuffer.timeAt(note.startBeat),
    clockBuffer.timeAt(noteEndBeat),
    note.length,
    rap ? () => true : (deviation) => isWithinSemitoneTolerance(deviation, toleranceSemitones),
    observedUntilMs,
  )

  const dead = rap || Math.abs(result.onPitchDeviationCents) <= TOLERANCE_BANDS_CENTS.epic
  const tier = result.credit <= 0 ? 'awful' : result.credit >= 1 && dead ? 'epic' : 'good'

  return {
    tier,
    deviationCents: averageDeviationCents,
    coverage: result.coverage,
    credit: result.credit,
    beatsHit: result.beatsHit,
    beatsCharged: result.beatsCharged,
  }
}
