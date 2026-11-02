import { describe, expect, it, beforeEach } from 'vitest'
import { useScoreStore } from '../useScoreStore'
import type { JudgedHit, LineRatingEvent, NoteWithId } from '../../types'

const NOTE: NoteWithId = { noteId: 'note-0', kind: 'normal', startBeat: 0, length: 4, pitch: 60, syllable: 'la' }

function hit(playerId: string, points: number | undefined, tier: JudgedHit['tier'] = 'epic'): JudgedHit {
  return { playerId, tier, noteId: NOTE.noteId, deviationCents: 0, t: 0, points }
}

function lineRating(playerId: string, bonusPoints: number): LineRatingEvent {
  return { playerId, lineIndex: 0, rating: 'perfect', label: 'Perfect!', fraction: 1, bonusPoints, t: 1 }
}

describe('useScoreStore', () => {
  beforeEach(() => {
    useScoreStore.getState().reset({
      players: [
        { playerId: 'p1', name: 'Alex', score: 0, combo: 0, rank: 2 },
        { playerId: 'p2', name: 'Sam', score: 100, combo: 0, rank: 1 },
      ],
      combo: 0,
      rank: ['p2', 'p1'],
    })
  })

  it('adds each hit\'s points to the emitting player only', () => {
    useScoreStore.getState().applyHit(hit('p1', 40), NOTE)

    const [p1, p2] = useScoreStore.getState().players
    expect(p1.score).toBe(40)
    expect(p2.score).toBe(100)
  })

  it('scores nothing for a hit that carries no points', () => {
    useScoreStore.getState().applyHit(hit('p1', undefined), NOTE)
    expect(useScoreStore.getState().players[0].score).toBe(0)
  })

  it('has no combo: the field stays 0 however long the run', () => {
    for (let i = 0; i < 10; i += 1) useScoreStore.getState().applyHit(hit('p1', 10), NOTE)
    const state = useScoreStore.getState()
    expect(state.players[0].combo).toBe(0)
    expect(state.combo).toBe(0)
    expect(state.players[0].score).toBe(100)
  })

  it('recomputes rank with the highest score first', () => {
    useScoreStore.getState().applyHits([{ event: hit('p1', 150), note: NOTE }])

    const state = useScoreStore.getState()
    expect(state.rank).toEqual(['p1', 'p2'])
    expect(state.players.find((p) => p.playerId === 'p1')?.rank).toBe(1)
  })

  it('keeps an unchanged player\'s object identity, so a memoised card does not re-render', () => {
    const before = useScoreStore.getState().players[1]
    useScoreStore.getState().applyHit(hit('p1', 10), NOTE)
    expect(useScoreStore.getState().players[1]).toBe(before)
  })

  it('accumulates exactly and publishes whole points, so fractional shares land on the true total', () => {
    for (let i = 0; i < 3; i += 1) useScoreStore.getState().applyHit(hit('p1', 10_000 / 3), NOTE)
    expect(useScoreStore.getState().players[0].score).toBe(10_000)
    expect(Number.isInteger(useScoreStore.getState().players[0].score)).toBe(true)
  })

  it('adds line bonuses and publishes each singer\'s newest line verdict in the same write', () => {
    let writes = 0
    const unsubscribe = useScoreStore.subscribe(() => {
      writes += 1
    })
    useScoreStore.getState().applyHits([{ event: hit('p1', 90), note: NOTE }], [lineRating('p1', 10)])
    unsubscribe()

    const state = useScoreStore.getState()
    expect(writes).toBe(1)
    expect(state.players[0].score).toBe(100)
    expect(state.lineRatingByPlayerId.p1?.label).toBe('Perfect!')
    expect(state.latestLineRating?.playerId).toBe('p1')
    expect(state.lineRatingByPlayerId.p2).toBeUndefined()
  })

  // The HUD only shows the newest verdict, so results need the running count.
  it('counts every announced line verdict per singer, and none for poor lines', () => {
    useScoreStore.getState().applyHits([], [lineRating('p1', 0), { ...lineRating('p2', 0), rating: 'great' }])
    useScoreStore.getState().applyHits([], [lineRating('p1', 0), { ...lineRating('p1', 0), rating: 'poor', label: null }])

    const { lineTallyByPlayerId } = useScoreStore.getState()
    expect(lineTallyByPlayerId.p1).toEqual({ perfect: 2, great: 0, good: 0, ok: 0 })
    expect(lineTallyByPlayerId.p2).toEqual({ perfect: 0, great: 1, good: 0, ok: 0 })
  })

  it('does not write at all for an empty frame', () => {
    let writes = 0
    const unsubscribe = useScoreStore.subscribe(() => {
      writes += 1
    })
    useScoreStore.getState().applyHits([], [])
    unsubscribe()
    expect(writes).toBe(0)
  })

  it('reset clears line verdicts and the exact totals', () => {
    useScoreStore.getState().applyHits([{ event: hit('p1', 12.4), note: NOTE }], [lineRating('p1', 0)])
    useScoreStore.getState().reset({ players: [{ playerId: 'p1', name: 'Alex', score: 0, combo: 0, rank: 1 }], combo: 0, rank: ['p1'] })

    const state = useScoreStore.getState()
    expect(state.lineRatingByPlayerId).toEqual({})
    expect(state.latestLineRating).toBeNull()
    expect(state.lineTallyByPlayerId).toEqual({})
    useScoreStore.getState().applyHit(hit('p1', 1), NOTE)
    expect(useScoreStore.getState().players[0].score).toBe(1)
  })
})
