import { describe, expect, it } from 'vitest'
import { generateHitEvent } from '../hit'

describe('generateHitEvent', () => {
  it('returns a valid HitTier and echoes the given playerId', () => {
    const event = generateHitEvent(1000, 'player-1')

    expect(event.playerId).toBe('player-1')
    expect(event.t).toBe(1000)
    expect(['epic', 'good', 'awful']).toContain(event.tier)
    expect(typeof event.noteId).toBe('string')
    expect(event.noteId.length).toBeGreaterThan(0)
    expect(typeof event.deviationCents).toBe('number')
  })
})
