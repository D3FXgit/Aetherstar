import type { PitchSample, SongChart } from '../contracts/types'
import { flattenNotes } from './matching/flattenNotes'
import { judgeNote } from './matching/judgeNote'
import { DEFAULT_TOLERANCE_SEMITONES } from './matching/hzToPitchClass'
import { createClockBuffer } from './matching/reconcileClock'
import { scoreNote } from './scoring/scoreNote'
import { buildScoringPlan } from './scoring/scoringPlan'
import { createLineTracker } from './scoring/lineRating'
import { SCORING } from './scoring/constants'
import { isScoredKind } from './scoring/scoringPlan'
import { beatToMs, msToBeat } from '../stage/timing/beatMs'
import type { NoteWithId } from './types'

/**
 * Live play never hands judgeNote a frame the pitch store classed as unvoiced:
 * src/audio/pitchStore.ts drops frames with no pitch (hz 0, or confidence
 * below its MIN_PITCH_CONFIDENCE of 0.5) unless they are loud enough (rms at
 * or above its VOICED_RMS_GATE of 0.02). Rap notes are judged on exactly those
 * voiced frames, so a replayed trace applies the same filter -- otherwise a
 * recorded silence would earn every rap note. Mirrors pitchStore's private
 * isPitched/isVoiced; kept local so the replay stays free of the store module.
 */
function isVoicedFrame(sample: PitchSample): boolean {
  const pitched =
    Number.isFinite(sample.hz) &&
    sample.hz > 0 &&
    (typeof sample.confidence !== 'number' || !Number.isFinite(sample.confidence) || sample.confidence >= 0.5)
  return pitched || (Number.isFinite(sample.rms) && (sample.rms as number) >= 0.02)
}

/**
 * Replays a recorded pitch trace against a chart through the real
 * judgeNote/scoreNote/line-bonus pipeline -- no mocks, no React, no live mic
 *. Used by both `/lab/gameplay` and the golden-file
 * determinism test, so there is exactly one replay implementation.
 *
 * `score` is on the same 0..10,000 scale live play uses (rounded), measured
 * against every line of `chart` as one singer's part.
 */
export function replayPitchTrace(
  chart: SongChart,
  allSamples: PitchSample[],
  toleranceSemitones: number = DEFAULT_TOLERANCE_SEMITONES,
): { score: number; notes: NoteWithId[]; maxScore: number } {
  const notes = flattenNotes(chart.lines)
  const plan = buildScoringPlan(chart.lines)
  const lines = createLineTracker(plan)
  let score = 0
  let sampleCursor = 0

  for (const note of notes) {
    const noteStartMs = beatToMs(note.startBeat, chart.meta.bpm, chart.meta.gap)
    const noteEndMs = beatToMs(note.startBeat + note.length, chart.meta.bpm, chart.meta.gap)

    const clockBuffer = createClockBuffer()
    const noteSamples: PitchSample[] = []
    while (sampleCursor < allSamples.length && allSamples[sampleCursor].t < noteEndMs) {
      const sample = allSamples[sampleCursor]
      if (sample.t >= noteStartMs) {
        clockBuffer.record(sample.t, msToBeat(sample.t, chart.meta.bpm, chart.meta.gap))
        noteSamples.push(sample)
      }
      sampleCursor++
    }

    if (!isScoredKind(note.kind)) continue
    const judgment = judgeNote(note, noteSamples, clockBuffer, toleranceSemitones, null, noteSamples.filter(isVoicedFrame))
    const points = scoreNote(note, judgment.credit, plan)
    score += points
    const completed = lines.record(note.noteId, points)
    if (completed) score += completed.bonusPoints
  }

  return { score: Math.round(score), notes, maxScore: plan.maxScore }
}

/** The ceiling a trace's score is measured against: 10,000 when any note is scorable, else 0. */
export function theoreticalMaxScore(notes: NoteWithId[]): number {
  return notes.some((note) => isScoredKind(note.kind) && note.length > 0) ? SCORING.maxScore : 0
}
