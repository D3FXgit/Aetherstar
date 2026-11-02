import { describe, expect, it } from 'vitest'
import { applyCalibration } from '../../../calibration/applyCalibration'
import { beatToMs, msToBeat } from '../../../stage/timing/beatMs'
import { flattenNotes } from '../flattenNotes'
import { judgeNote } from '../judgeNote'
import { createClockBuffer } from '../reconcileClock'
import type { PitchSample, SongLine } from '../../../contracts/types'

/**
 * End-to-end proof that a microphone frame becomes a score.
 *
 * Gameplay.tsx is the only place these pieces are wired together and it is a
 * per-frame rAF loop, so nothing ever asserted that the chain actually closes:
 * chart beats -> milliseconds (beatMs) -> the rolling clock buffer
 * (reconcileClock) -> calibrated sample timestamps (applyCalibration) ->
 * judgeNote. This replays that exact chain against a hand-computed timeline, so
 * a break anywhere in it -- including a beat conversion off by a factor of
 * four -- fails here rather than as "the game doesn't score me".
 */

// #BPM:250 -> 60ms per (quarter-)beat. First note: beats 4..8 -> 1240..1480ms.
const BPM = 250
const GAP = 1000
const LINES: SongLine[] = [
  {
    part: 'solo',
    notes: [
      { kind: 'normal', startBeat: 4, length: 4, pitch: 69, syllable: 'la' },
      { kind: 'normal', startBeat: 12, length: 4, pitch: 69, syllable: 'la' },
    ],
  },
]

const A440 = 440
const FRAME_MS = 1000 / 60
const SAMPLE_STEP_MS = 20

interface Options {
  /** Latency between the singer making a sound and its frame reaching the store. */
  micLatencyMs: number
  /** What calibration believes that latency to be. */
  inputOffsetMs: number
  hz: number
}

/** True while the chart wants a sound at `ms` -- the singer is silent otherwise. */
function sungDuringANote(ms: number): boolean {
  return LINES[0].notes.some(
    (note) => ms >= beatToMs(note.startBeat, BPM, GAP) && ms < beatToMs(note.startBeat + note.length, BPM, GAP),
  )
}

/**
 * Runs the same loop Gameplay runs: record (wall clock, beat) every frame,
 * feed calibrated samples in, judge each note the moment its span ends.
 */
function replayThroughLivePipeline({ micLatencyMs, inputOffsetMs, hz }: Options) {
  const notes = flattenNotes(LINES)
  const clockBuffer = createClockBuffer()
  const judgements: ReturnType<typeof judgeNote>[] = []

  let pending: PitchSample[] = []
  let noteIndex = 0
  let nextSampleAt = 0
  /**
   * How far the *audio* has been heard, in the same (calibrated) clock the
   * samples carry -- what `Gameplay` derives from `levelAt - latencyMs`.
   *
   * Every analysis window produces a frame whether or not it found a pitch, so
   * this advances through silence too; only the pitched ones are kept above.
   * Coverage must not charge a singer for note it has not heard yet (see
   * matching/noteCoverage.ts), and a 240ms mic latency is precisely the case
   * where "not heard yet" is most of the note.
   */
  let observedUntil = -Infinity

  const endMs = beatToMs(20, BPM, GAP)
  for (let audioMs = 0; audioMs <= endMs; audioMs += FRAME_MS) {
    const beat = msToBeat(audioMs, BPM, GAP)
    clockBuffer.record(audioMs, beat)

    // The mic reports what was sung `micLatencyMs` ago; calibration shifts the
    // timestamps back by what it measured that latency to be. The singer only
    // makes a sound during the notes themselves -- silence in between, as a
    // real one does -- so an uncorrected latency really does move their voice
    // out of the note instead of being masked by a continuous tone.
    while (nextSampleAt <= audioMs) {
      const sungAt = nextSampleAt - micLatencyMs
      if (sungAt >= 0 && sungDuringANote(sungAt)) {
        pending = pending.concat(
          applyCalibration([{ t: nextSampleAt, hz, confidence: 1, deviceId: 'dev-1' }], {
            inputOffsetMs,
            transpositionSemitones: 0,
          }),
        )
      }
      observedUntil = nextSampleAt - inputOffsetMs
      nextSampleAt += SAMPLE_STEP_MS
    }

    while (noteIndex < notes.length && beat >= notes[noteIndex].startBeat + notes[noteIndex].length) {
      judgements.push(judgeNote(notes[noteIndex], pending, clockBuffer, 1, observedUntil))
      pending = []
      noteIndex++
    }
  }

  return judgements
}

describe('live pitch -> score pipeline', () => {
  it('scores an on-pitch singer as epic once calibration has cancelled the input latency', () => {
    const judgements = replayThroughLivePipeline({ micLatencyMs: 45, inputOffsetMs: 45, hz: A440 })

    expect(judgements).toHaveLength(2)
    for (const judgement of judgements) {
      expect(judgement.tier).toBe('epic')
      expect(Math.abs(judgement.deviationCents)).toBeLessThan(1)
    }
  })

  /**
   * An uncorrected input latency is indistinguishable from singing late, which
   * is exactly what an unapplied calibration offset would look like on stage.
   * Held here so the offset staying wired into the matching path is a test
   * failure, not a bug report.
   */
  it('loses the short note entirely when the measured input offset is not applied', () => {
    const uncalibrated = replayThroughLivePipeline({ micLatencyMs: 240, inputOffsetMs: 0, hz: A440 })
    const calibrated = replayThroughLivePipeline({ micLatencyMs: 240, inputOffsetMs: 240, hz: A440 })

    expect(uncalibrated[0].tier).toBe('awful')
    expect(calibrated[0].tier).toBe('epic')
  })

  it('scores a singer a whole tone flat as awful', () => {
    const judgements = replayThroughLivePipeline({ micLatencyMs: 0, inputOffsetMs: 0, hz: A440 * Math.pow(2, -2 / 12) })

    expect(judgements[0].tier).toBe('awful')
    expect(judgements[0].deviationCents).toBeCloseTo(-200, 0)
  })

  /**
   * The chart is quarter-beat timed, so its first note lives at 1240..1480ms.
   * Under the old `60000/bpm` conversion the clock thought that note ran from
   * 1960ms to 2920ms -- so a singer who sang exactly on the beat had every one
   * of their frames land outside the note the game was judging.
   */
  it('puts the first note where the audio actually has it', () => {
    expect(beatToMs(4, BPM, GAP)).toBe(1240)
    expect(beatToMs(8, BPM, GAP)).toBe(1480)
    expect(msToBeat(1240, BPM, GAP)).toBe(4)
  })
})
