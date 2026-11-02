import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearSingerPitches,
  publishSingerPitch,
  readSingerPitches,
  SINGER_PITCH_STALE_MS,
} from '../pitchMirror'

beforeEach(() => clearSingerPitches())

describe('the singer pitch mirror', () => {
  it('reports what the host frame loop last wrote, per singer', () => {
    publishSingerPitch('p1', 12, 1000)
    publishSingerPitch('p2', -3, 1000)

    expect(readSingerPitches(1000)).toEqual(
      expect.arrayContaining([
        { playerId: 'p1', semitone: 12 },
        { playerId: 'p2', semitone: -3 },
      ]),
    )
  })

  it('keeps only the newest value for a singer, because the loop overwrites every frame', () => {
    publishSingerPitch('p1', 4, 1000)
    publishSingerPitch('p1', 9, 1016)

    expect(readSingerPitches(1016)).toEqual([{ playerId: 'p1', semitone: 9 }])
  })

  it('drops a singer whose loop has stopped, rather than freezing a rule mid-lane', () => {
    publishSingerPitch('p1', 5, 1000)

    expect(readSingerPitches(1000 + SINGER_PITCH_STALE_MS)).toHaveLength(1)
    expect(readSingerPitches(1000 + SINGER_PITCH_STALE_MS + 1)).toEqual([])
  })

  it('null removes the marker -- a singer making no pitch draws no rule', () => {
    publishSingerPitch('p1', 5, 1000)
    publishSingerPitch('p1', null, 1010)

    expect(readSingerPitches(1010)).toEqual([])
  })

  it('refuses a non-finite semitone rather than broadcasting a NaN into the lane geometry', () => {
    publishSingerPitch('p1', Number.NaN, 1000)
    publishSingerPitch('p2', Number.POSITIVE_INFINITY, 1000)

    expect(readSingerPitches(1000)).toEqual([])
  })

  it('clears everything, so one song does not leave rules behind for the next', () => {
    publishSingerPitch('p1', 5, 1000)
    clearSingerPitches()

    expect(readSingerPitches(1000)).toEqual([])
  })
})
