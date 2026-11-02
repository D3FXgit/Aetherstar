import { describe, expect, it } from 'vitest'
import { judgeNote } from '../judgeNote'
import { createClockBuffer } from '../reconcileClock'
import type { NoteWithId } from '../../types'
import type { PitchSample } from '../../../contracts/types'

/**
 * Not "is the maths right" -- "can a real person win".
 *
 * Every other scoring test asserts that a given deviation maps to a given tier.
 * None asks whether an ordinary singer, singing an ordinary song, ever reaches
 * the top tier. When the EPIC band was 20 cents they did not: a party singer
 * lands 15-30 cents off on a held note, so they got GOOD on every note forever
 * and the game felt punishing while every test stayed green.
 *
 * These drive realistic singers through the real `judgeNote` (the same path
 * Gameplay uses) at four note lengths. If someone tightens a band, or breaks the
 * timing forgiveness in noteCoverage.ts, this is the test that says the game
 * stopped being winnable.
 */

const MS_PER_BEAT = 500 // 120 BPM
const HOP_MS = 29 // native detector analysis hop
const T0 = 100_000
const NOTE_LENGTHS_BEATS = [0.5, 1, 2, 4]

function clockFor(startBeat: number, lengthBeats: number) {
  const clock = createClockBuffer()
  for (let b = startBeat - 4; b <= startBeat + lengthBeats + 4; b += 0.25) {
    clock.record(T0 + b * MS_PER_BEAT, b)
  }
  return clock
}

function hzFor(semitone: number, centsOff: number): number {
  return 440 * Math.pow(2, (semitone - 9) / 12) * Math.pow(2, centsOff / 1200)
}

interface Singer {
  /** Steady pitch offset from the note, in cents. */
  centsOff: number
  /** How late the singer starts the note. */
  lateMs: number
  /** How early they stop. */
  releaseEarlyMs: number
  /** Systematic latency shifting every sample later (an uncalibrated rig). */
  latencyMs: number
  vibratoCents?: number
}

function trace(note: NoteWithId, lengthBeats: number, s: Singer): PitchSample[] {
  const spanStart = T0 + note.startBeat * MS_PER_BEAT
  const spanEnd = spanStart + lengthBeats * MS_PER_BEAT
  const sing0 = spanStart + s.lateMs
  const sing1 = spanEnd - s.releaseEarlyMs
  const out: PitchSample[] = []
  for (let t = sing0; t <= sing1; t += HOP_MS) {
    const vib = s.vibratoCents ? s.vibratoCents * Math.sin((2 * Math.PI * 5.5 * (t - sing0)) / 1000) : 0
    out.push({ t: t + s.latencyMs, hz: hzFor(note.pitch, s.centsOff + vib), confidence: 1, deviceId: 'd' })
  }
  return out
}

function judge(singer: Singer, lengthBeats: number) {
  const note: NoteWithId = { noteId: 'n', kind: 'normal', startBeat: 8, length: lengthBeats, pitch: 9, syllable: 'la' }
  return judgeNote(note, trace(note, lengthBeats, singer), clockFor(8, lengthBeats))
}

const VIBRATO_SINGER: Singer = { centsOff: 25, lateMs: 80, releaseEarlyMs: 50, latencyMs: 0, vibratoCents: 50 }

const ORDINARY_SINGERS: Array<[string, Singer]> = [
  ['machine: dead on, full duration', { centsOff: 0, lateMs: 0, releaseEarlyMs: 0, latencyMs: 0 }],
  ['good singer: 15c sharp, 50ms late', { centsOff: 15, lateMs: 50, releaseEarlyMs: 30, latencyMs: 0 }],
  ['decent amateur: 25c sharp, 80ms late', { centsOff: 25, lateMs: 80, releaseEarlyMs: 50, latencyMs: 0 }],
  ['dead on, 120ms uncalibrated rig latency', { centsOff: 0, lateMs: 0, releaseEarlyMs: 0, latencyMs: 120 }],
  ['realistic: 20c sharp, 60ms late, 60ms rig latency', { centsOff: 20, lateMs: 60, releaseEarlyMs: 40, latencyMs: 60 }],
]

describe('an ordinary singer can win', () => {
  describe.each(NOTE_LENGTHS_BEATS)('a %s-beat note', (lengthBeats) => {
    it.each(ORDINARY_SINGERS)('%s reaches EPIC with (almost) full credit', (_label, singer) => {
      const result = judge(singer, lengthBeats)

      expect(result.tier).toBe('epic')
      expect(result.credit).toBeGreaterThan(0.9)
    })
  })
})

describe('vibrato', () => {
  it.each([1, 2, 4])('a decent amateur with wide vibrato reaches EPIC on a %s-beat note', (lengthBeats) => {
    const result = judge(VIBRATO_SINGER, lengthBeats)

    expect(result.tier).toBe('epic')
    expect(result.credit).toBeGreaterThan(0.9)
  })

  // 250 ms is barely more than one vibrato cycle, so the swing does not average
  // out inside the measuring window: full credit, but not the top tier.
  it('on a 0.5-beat note the same singer is GOOD with full credit', () => {
    const result = judge(VIBRATO_SINGER, 0.5)

    expect(result.tier).toBe('good')
    expect(result.credit).toBeGreaterThan(0.9)
  })
})

describe('the top tier still means something', () => {
  it.each(NOTE_LENGTHS_BEATS)('a steady 45c-off singer is GOOD, not EPIC, on a %s-beat note', (lengthBeats) => {
    const result = judge({ centsOff: 45, lateMs: 0, releaseEarlyMs: 0, latencyMs: 0 }, lengthBeats)

    expect(result.tier).toBe('good')
  })

  // Normal difficulty accepts the neighbouring semitone (UltraStar-style), so
  // "off" now means rounding to two semitones away.
  it.each(NOTE_LENGTHS_BEATS)('a singer a clear 170c off scores nothing on a %s-beat note', (lengthBeats) => {
    const result = judge({ centsOff: 170, lateMs: 0, releaseEarlyMs: 0, latencyMs: 0 }, lengthBeats)

    expect(result.tier).toBe('awful')
    expect(result.credit).toBe(0)
  })

  it('not singing at all scores nothing', () => {
    const note: NoteWithId = { noteId: 'n', kind: 'normal', startBeat: 8, length: 2, pitch: 9, syllable: 'la' }
    const result = judgeNote(note, [], clockFor(8, 2))

    expect(result.tier).toBe('awful')
    expect(result.credit).toBe(0)
  })
})
