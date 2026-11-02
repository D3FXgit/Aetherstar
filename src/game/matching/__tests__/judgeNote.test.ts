import { describe, expect, it } from 'vitest'
import { judgeNote, NO_SIGNAL_DEVIATION_CENTS, UNSCORED_JUDGEMENT } from '../judgeNote'
import { createClockBuffer } from '../reconcileClock'
import { toleranceSemitonesFor } from '../../../calibration/difficulty'
import type { NoteWithId } from '../../types'
import type { NoteKind, PitchSample } from '../../../contracts/types'

const NOTE: NoteWithId = { noteId: 'note-0', kind: 'normal', startBeat: 4, length: 4, pitch: 9, syllable: 'la' }
const A4 = 440

function sample(t: number, hz: number, rms?: number): PitchSample {
  return { t, hz, confidence: 1, deviceId: 'dev-1', rms }
}

function centsAbove(hz: number, cents: number): number {
  return hz * Math.pow(2, cents / 1200)
}

const START_MS = 1000
const MS_PER_BEAT = 300

/** A dense clock over the note (and a little past it), 300 ms per beat. */
function denseClock(note: NoteWithId = NOTE) {
  const clock = createClockBuffer()
  const spanMs = note.length * MS_PER_BEAT
  for (let ms = 0; ms <= spanMs + 100; ms += 16) clock.record(START_MS + ms, note.startBeat + ms / MS_PER_BEAT)
  return clock
}

/** Samples every 10 ms (the native ~100 Hz frame rate) over [fromBeat, toBeat) of the note, relative beats. */
function sung(hz: number, fromBeat = 0, toBeat = NOTE.length, rms?: number): PitchSample[] {
  const samples: PitchSample[] = []
  for (let ms = fromBeat * MS_PER_BEAT; ms < toBeat * MS_PER_BEAT; ms += 10) samples.push(sample(START_MS + ms, hz, rms))
  return samples
}

describe('judgeNote', () => {
  it('only uses samples whose reconciled beat falls within the note\'s span', () => {
    const clock = createClockBuffer()
    clock.record(1000, 3)
    clock.record(1010, 5)
    clock.record(1020, 6)
    clock.record(1030, 9)

    const result = judgeNote(NOTE, [sample(1000, 100), sample(1010, A4), sample(1020, A4), sample(1030, 100)], clock)

    expect(result.deviationCents).toBeCloseTo(0, 0)
    expect(result.tier).toBe('epic')
  })

  it('never scores a freestyle note: unscored, whatever was sung', () => {
    const freestyle: NoteWithId = { ...NOTE, kind: 'freestyle' }
    const result = judgeNote(freestyle, sung(A4), denseClock())

    expect(result).toEqual(UNSCORED_JUDGEMENT)
    expect(result.credit).toBe(0)
  })

  it('returns an awful judgement with a finite sentinel deviation for silence', () => {
    const result = judgeNote(NOTE, [], createClockBuffer())

    expect(result.tier).toBe('awful')
    expect(result.credit).toBe(0)
    expect(result.deviationCents).toBe(NO_SIGNAL_DEVIATION_CENTS)
  })

  it('ignores unpitched (hz <= 0) frames instead of scoring them as a sung note', () => {
    const clock = createClockBuffer()
    clock.record(1010, 5)
    clock.record(1020, 6)

    const silent = judgeNote(NOTE, [sample(1010, 0), sample(1020, 0)], clock)
    expect(silent.tier).toBe('awful')
    expect(silent.deviationCents).toBe(NO_SIGNAL_DEVIATION_CENTS)

    const mixed = judgeNote(NOTE, [sample(1010, 0), sample(1020, A4)], clock)
    expect(mixed.tier).toBe('epic')
  })

  it('drops samples the clock buffer never observed, instead of snapping them into the note', () => {
    const clock = createClockBuffer(250)
    clock.record(30_000, 5)

    const stale = Array.from({ length: 50 }, (_, i) => sample(1000 + i * 20, A4))
    const result = judgeNote(NOTE, stale, clock)

    expect(result.tier).toBe('awful')
    expect(result.deviationCents).toBe(NO_SIGNAL_DEVIATION_CENTS)
  })

  describe('semitone tolerance per difficulty (UltraStar-style rounding)', () => {
    const easy = toleranceSemitonesFor('easy')
    const normal = toleranceSemitonesFor('normal')
    const hard = toleranceSemitonesFor('hard')

    it('is 2 / 1 / 0 semitones for Easy / Normal / Hard', () => {
      expect([easy, normal, hard]).toEqual([2, 1, 0])
    })

    it.each([
      // cents off, Easy, Normal, Hard -- full credit or none
      [0, 1, 1, 1],
      [40, 1, 1, 1], // rounds to the written semitone
      [120, 1, 1, 0], // rounds to one semitone off
      [-120, 1, 1, 0],
      [220, 1, 0, 0], // rounds to two semitones off
      [320, 0, 0, 0], // three semitones off
    ])('%i cents off: Easy %i, Normal %i, Hard %i', (cents, atEasy, atNormal, atHard) => {
      const samples = sung(centsAbove(A4, cents))
      expect(judgeNote(NOTE, samples, denseClock(), easy).credit).toBe(atEasy)
      expect(judgeNote(NOTE, samples, denseClock(), normal).credit).toBe(atNormal)
      expect(judgeNote(NOTE, samples, denseClock(), hard).credit).toBe(atHard)
    })

    it('is octave-independent: the right note an octave up is the right note', () => {
      const result = judgeNote(NOTE, sung(A4 * 2), denseClock(), hard)
      expect(result.credit).toBe(1)
      expect(result.tier).toBe('epic')
    })

    it('keeps cents only for the cosmetic tier: in tolerance but not dead-on reads "good"', () => {
      expect(judgeNote(NOTE, sung(centsAbove(A4, 20)), denseClock(), normal).tier).toBe('epic')
      expect(judgeNote(NOTE, sung(centsAbove(A4, 120)), denseClock(), normal).tier).toBe('good')
    })
  })

  describe('per-beat credit', () => {
    it('pays every beat sung, and nothing for the beats not sung', () => {
      expect(judgeNote(NOTE, sung(A4, 0, 4), denseClock()).credit).toBe(1)
      expect(judgeNote(NOTE, sung(A4, 0, 2), denseClock()).credit).toBe(0.5)
      expect(judgeNote(NOTE, sung(A4, 1, 4), denseClock()).credit).toBe(0.75)
      expect(judgeNote(NOTE, sung(A4, 3, 4), denseClock()).credit).toBe(0.25)
    })

    it('has no cliff: 3 of 4 beats is worth 3/4 of the note, not a drop to a lower tier rate', () => {
      const result = judgeNote(NOTE, sung(A4, 0, 3), denseClock())
      expect(result.credit).toBe(0.75)
      expect(result.beatsHit).toBe(3)
      expect(result.beatsCharged).toBe(4)
      expect(result.tier).toBe('good')
    })

    it('counts a beat sung off-pitch as missed, whatever the rest of the note did', () => {
      const samples = [...sung(A4, 0, 2), ...sung(centsAbove(A4, 300), 2, 4)]
      expect(judgeNote(NOTE, samples, denseClock()).credit).toBe(0.5)
    })

    it('does not charge beats the audio pipeline has not delivered yet', () => {
      // Sung through beat 3, and audio has only been heard up to there.
      const heardUntil = START_MS + 3 * MS_PER_BEAT
      const result = judgeNote(NOTE, sung(A4, 0, 3), denseClock(), 1, heardUntil)
      expect(result.credit).toBe(1)
      expect(result.beatsCharged).toBe(3)
    })
  })

  describe('rap notes', () => {
    const RAP: NoteWithId = { ...NOTE, kind: 'rap' as NoteKind }

    it('credits voiced sound at any pitch', () => {
      const anyPitch = sung(centsAbove(A4, 500))
      expect(judgeNote(RAP, anyPitch, denseClock(), 0).credit).toBe(1)
    })

    it('scores on the voiced (level-gated) frames when given, even when nothing was pitched', () => {
      const unpitchedButLoud = sung(0, 0, 4, 0.2)
      const result = judgeNote(RAP, [], denseClock(), 1, null, unpitchedButLoud)
      expect(result.credit).toBe(1)
      expect(result.tier).toBe('epic')
    })

    it('scores silence at nothing', () => {
      const result = judgeNote(RAP, [], denseClock(), 1, null, [])
      expect(result.credit).toBe(0)
      expect(result.tier).toBe('awful')
    })

    it('pays per beat, like a pitched note', () => {
      const golden: NoteWithId = { ...NOTE, kind: 'goldenRap' }
      expect(judgeNote(golden, [], denseClock(), 1, null, sung(0, 0, 2, 0.2)).credit).toBe(0.5)
    })
  })

  it('reports a credit that is always a usable fraction', () => {
    for (const from of [0, 0.5, 1, 2, 3.5]) {
      const { credit } = judgeNote(NOTE, sung(A4, from, 4), denseClock())
      expect(Number.isFinite(credit)).toBe(true)
      expect(credit).toBeGreaterThanOrEqual(0)
      expect(credit).toBeLessThanOrEqual(1)
    }
  })
})
