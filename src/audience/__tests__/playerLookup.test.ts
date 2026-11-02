import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fetchPlayerProfiles, buildProfileMap } from '../playerLookup'

const PROFILE_A = { id: 'p1', name: 'Alex', color: 'oklch(0.78 0.19 195)', avatarUrl: '' }
const PROFILE_B = { id: 'p2', name: 'Sam', color: 'oklch(0.78 0.19 320)', avatarUrl: '' }

beforeEach(() => {
  // @ts-expect-error -- only players.list matters for this test
  window.api = {
    players: { list: vi.fn().mockResolvedValue([PROFILE_A, PROFILE_B]) },
  } as Window['api']
})

describe('fetchPlayerProfiles', () => {
  it('calls window.api.players.list() and returns its result', async () => {
    const profiles = await fetchPlayerProfiles()
    expect(window.api!.players.list).toHaveBeenCalledOnce()
    expect(profiles).toEqual([PROFILE_A, PROFILE_B])
  })
})

describe('buildProfileMap', () => {
  it('returns a Map keyed by profile id', () => {
    const map = buildProfileMap([PROFILE_A, PROFILE_B])
    expect(map.get('p1')).toEqual(PROFILE_A)
    expect(map.get('p2')).toEqual(PROFILE_B)
    expect(map.get('unknown')).toBeUndefined()
  })
})
