import { describe, it, expect } from 'vitest'
import { newHighscoreHolders } from '../highscores'

describe('newHighscoreHolders', () => {
  it('awards a record only for beating the best on the same difficulty', () => {
    const holders = newHighscoreHolders(
      [
        { playerId: 'easy', score: 6000, difficulty: 'easy' },
        { playerId: 'hard', score: 6000, difficulty: 'hard' },
      ],
      { easy: 7000, hard: 5000 },
    )
    expect([...holders]).toEqual(['hard'])
  })

  it('gives a shared difficulty record to the better of two singers who both beat it', () => {
    const holders = newHighscoreHolders(
      [
        { playerId: 'a', score: 8000, difficulty: 'normal' },
        { playerId: 'b', score: 9000, difficulty: 'normal' },
      ],
      { normal: 5000 },
    )
    expect([...holders]).toEqual(['b'])
  })

  it('counts a first score as a record, but never a zero, and never a tie', () => {
    expect([...newHighscoreHolders([{ playerId: 'a', score: 10, difficulty: 'normal' }], {})]).toEqual(['a'])
    expect(newHighscoreHolders([{ playerId: 'a', score: 0, difficulty: 'normal' }], {}).size).toBe(0)
    expect(newHighscoreHolders([{ playerId: 'a', score: 500, difficulty: 'normal' }], { normal: 500 }).size).toBe(0)
  })
})
