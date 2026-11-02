import { describe, expect, it } from 'vitest'
import { computeRating, computeTheoreticalMaxScore, maxScoreForLane, RANKS } from '../rating'
import { buildScoringPlan } from '../../game/scoring/scoringPlan'
import { linesForLane } from '../../multiplayer/laneParts'
import type { SongLine } from '../../contracts/types'

describe('computeRating: the classic party-karaoke rank ladder', () => {
  it.each([
    [10_000, 'Superstar', 5],
    [9_000, 'Superstar', 5],
    [8_999, 'Hit Machine', 4],
    [8_000, 'Hit Machine', 4],
    [7_000, 'Lead Singer', 4],
    [6_000, 'Rising Star', 3],
    [5_000, 'Hopeful', 3],
    [4_000, 'Wannabe', 2],
    [2_000, 'Amateur', 2],
    [1_999, 'Tone Deaf', 1],
    [0, 'Tone Deaf', 1],
  ])('%i points is %s (%i stars) against the 10,000 ceiling', (score, title, stars) => {
    expect(computeRating(score)).toEqual({ title, stars })
  })

  it('rates against whatever maximum it is given', () => {
    expect(computeRating(950, 1000).title).toBe('Superstar')
    expect(computeRating(100, 1000).title).toBe('Tone Deaf')
  })

  it('gives every score a rank -- the lowest when there is no maximum at all', () => {
    expect(computeRating(0, 0)).toEqual({ title: 'Tone Deaf', stars: 1 })
    expect(computeRating(Number.NaN)).toEqual({ title: 'Tone Deaf', stars: 1 })
    expect(RANKS).toHaveLength(8)
  })
})

const NOTE = { kind: 'normal' as const, startBeat: 0, length: 4, pitch: 60, syllable: 'la' }
const DUET: SongLine[] = [
  { part: 'p1', notes: [NOTE, { ...NOTE, startBeat: 4 }] },
  { part: 'p2', notes: [{ ...NOTE, startBeat: 8, length: 40 }] },
  { part: 'solo', notes: [{ ...NOTE, startBeat: 60 }] },
]

describe('per-lane maximum', () => {
  it('is 10,000 for every lane that has anything to sing, however long', () => {
    expect(maxScoreForLane(DUET, 0)).toBe(10_000)
    expect(maxScoreForLane({ meta: {} as never, lines: DUET }, 1)).toBe(10_000)
    expect(computeTheoreticalMaxScore(DUET)).toBe(10_000)
  })

  it('is 0 for a lane with nothing scorable', () => {
    expect(maxScoreForLane([{ part: 'p1', notes: [{ ...NOTE, kind: 'freestyle' }] }], 0)).toBe(0)
    expect(computeTheoreticalMaxScore([])).toBe(0)
  })

  // Review finding: results used their own part split (3rd singer = shared
  // lines only, 2nd singer = P2 even on a non-duet chart), which disagreed
  // with the lanes the singers were actually scored on.
  it('measures a third duet singer against P1 -- the lane they sang -- not the shared lines', () => {
    const noShared: SongLine[] = [
      { part: 'p1', notes: [NOTE] },
      { part: 'p2', notes: [{ ...NOTE, startBeat: 8 }, { ...NOTE, startBeat: 12, kind: 'freestyle' }] },
    ]
    expect(maxScoreForLane(noShared, 2)).toBe(10_000)
    expect(maxScoreForLane(noShared, 3)).toBe(10_000)
  })

  it('measures every singer of a single-part chart against the whole chart', () => {
    const singlePart: SongLine[] = [{ part: 'p1', notes: [NOTE] }]
    expect(maxScoreForLane(singlePart, 1)).toBe(10_000)
  })

  it('is the maximum of exactly the lines the lane is given', () => {
    const p2Freestyle: SongLine[] = [
      { part: 'p1', notes: [NOTE] },
      { part: 'p2', notes: [{ ...NOTE, startBeat: 8, kind: 'freestyle' }] },
    ]
    expect(maxScoreForLane(p2Freestyle, 1)).toBe(buildScoringPlan(linesForLane(p2Freestyle, 1)).maxScore)
    expect(maxScoreForLane(p2Freestyle, 1)).toBe(0)
  })
})
