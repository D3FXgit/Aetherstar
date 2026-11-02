import { describe, expect, it } from 'vitest'
import { rankSingers } from '../results/singers'
import type { SongChart, SongLine } from '../../contracts/types'
import type { SessionSongResult } from '../types'

const NOTE = { kind: 'normal' as const, startBeat: 0, length: 4, pitch: 60, syllable: 'la' }

/** A duet with no shared lines: lanes alternate P1, P2, P1 (see laneParts.ts). */
const DUET: SongLine[] = [
  { part: 'p1', notes: [NOTE] },
  { part: 'p2', notes: [{ ...NOTE, startBeat: 8 }] },
]
const CHART: SongChart = { meta: {} as never, lines: DUET }

function result(playerId: string, score: number): SessionSongResult {
  return { playerId, score, epicCount: 0, goodCount: 0, awfulCount: 0, bestLine: null }
}

describe('rankSingers', () => {
  // Review finding: the results screen used its own part split (the third
  // singer = shared lines only), so a third duet singer who sang P1 perfectly
  // was ranked against a 0-point maximum and came out Tone Deaf.
  it('ranks every singer against the lines their own lane sang', () => {
    const ranked = rankSingers({
      results: [result('a', 9_500), result('b', 9_500), result('c', 9_500)],
      assignedPlayerIds: ['a', 'b', 'c'],
      players: [],
      chart: CHART,
      newHighscores: new Set(),
    })

    expect(ranked.map((singer) => singer.rating.title)).toEqual(['Superstar', 'Superstar', 'Superstar'])
  })

  it('ranks the second singer of a single-part chart against the whole chart', () => {
    const ranked = rankSingers({
      results: [result('a', 9_500), result('b', 9_500)],
      assignedPlayerIds: ['a', 'b'],
      players: [],
      chart: { meta: {} as never, lines: [{ part: 'p1', notes: [NOTE] }] },
      newHighscores: new Set(),
    })

    expect(ranked.map((singer) => singer.rating.title)).toEqual(['Superstar', 'Superstar'])
  })
})
