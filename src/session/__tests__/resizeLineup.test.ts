import { describe, expect, it } from 'vitest'
import { resizePartyLineup } from '../partyDraw/resizeLineup'
import type { PartyRoundState } from '../party/partyDrawLogic'
import type { PlayerProfile } from '../../contracts/types'
import type { LibrarySong } from '../../library/types'

const PLAYERS = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id, color: '#fff', avatarUrl: '' }) as PlayerProfile)
const SONGS = [{ path: '/s1' }, { path: '/s2' }, { path: '/s3' }] as LibrarySong[]

function round(overrides: Partial<PartyRoundState> = {}): PartyRoundState {
  return {
    shuffledCatalog: SONGS,
    songCursor: 3,
    offeredSongs: SONGS,
    assignedPlayerIds: ['a', 'b'],
    excludedThisRound: [],
    sessionSingCounts: {},
    ...overrides,
  }
}

describe('resizePartyLineup', () => {
  it('keeps the drawn singers and the songs, adding fair draws from the bench', () => {
    const state = round({ sessionSingCounts: { c: 3, d: 0 } })
    const next = resizePartyLineup(state, 3, PLAYERS, () => 0)
    expect(next.assignedPlayerIds).toEqual(['a', 'b', 'd']) // d has sung least
    expect(next.offeredSongs).toBe(state.offeredSongs)
    expect(next.songCursor).toBe(state.songCursor)
  })

  it('drops the trailing slots when shrinking', () => {
    expect(resizePartyLineup(round({ assignedPlayerIds: ['a', 'b', 'c'] }), 1, PLAYERS).assignedPlayerIds).toEqual(['a'])
  })

  it('returns the same state when nothing changes', () => {
    const state = round()
    expect(resizePartyLineup(state, 2, PLAYERS)).toBe(state)
  })

  it('draws someone who passed only when nobody else is left', () => {
    const state = round({ excludedThisRound: ['c'] })
    expect(resizePartyLineup(state, 3, PLAYERS).assignedPlayerIds).toEqual(['a', 'b', 'd'])
    expect(resizePartyLineup(state, 4, PLAYERS).assignedPlayerIds).toEqual(['a', 'b', 'd', 'c'])
  })
})
