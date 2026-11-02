import { describe, expect, it } from 'vitest'
import {
  canSlotOptOut,
  drawFairSingers,
  drawNextSongs,
  executeOptOut,
  initPartyRound,
  recordSongSung,
} from '../party/partyDrawLogic'
import type { LibrarySong } from '../../library/types'
import type { PlayerProfile } from '../../contracts/types'

function makeSong(id: string): LibrarySong {
  return {
    path: `/songs/song-${id}.txt`,
    artist: `Artist ${id}`,
    title: `Title ${id}`,
    durationMs: 180000,
    thumbnailPath: null,
    mp3Path: `/songs/song-${id}.mp3`,
    videoPath: null,
    bpm: 120,
    gap: 0,
    hasVideo: false,
    hasCover: false,
    isDuet: false,
    isPlayable: true,
    addedAt: 1,
  }
}

function makePlayer(id: string, name: string): PlayerProfile {
  return {
    id,
    name,
    avatarUrl: `avatar-${id}.png`,
    color: '#ff0077',
  }
}

describe('partyDrawLogic', () => {
  describe('drawFairSingers', () => {
    const players = [
      makePlayer('p1', 'Alice'),
      makePlayer('p2', 'Bob'),
      makePlayer('p3', 'Charlie'),
      makePlayer('p4', 'Diana'),
    ]

    it('picks candidates with lowest sing count first', () => {
      // Alice and Bob have sung 2 times; Charlie and Diana have sung 0 times.
      const singCounts = { p1: 2, p2: 2, p3: 0, p4: 0 }
      const picked = drawFairSingers(players, 2, singCounts)

      expect(picked).toHaveLength(2)
      expect(picked).toContain('p3')
      expect(picked).toContain('p4')
      expect(picked).not.toContain('p1')
      expect(picked).not.toContain('p2')
    })

    it('fills remaining slots from the next lowest tier when lower tier is exhausted', () => {
      // Charlie has sung 0 times; Alice, Bob, Diana have sung 1 time.
      const singCounts = { p1: 1, p2: 1, p3: 0, p4: 1 }
      const picked = drawFairSingers(players, 2, singCounts)

      expect(picked).toHaveLength(2)
      expect(picked).toContain('p3')
      // Second pick must be one of p1, p2, p4
      const other = picked.find((id) => id !== 'p3')
      expect(['p1', 'p2', 'p4']).toContain(other)
    })

    it('returns all candidates if requested count exceeds candidate count', () => {
      const picked = drawFairSingers(players.slice(0, 2), 4, {})
      expect(picked).toHaveLength(2)
    })

    it('returns empty array if count <= 0 or candidate list is empty', () => {
      expect(drawFairSingers(players, 0, {})).toEqual([])
      expect(drawFairSingers([], 2, {})).toEqual([])
    })
  })

  describe('drawNextSongs & cursor management', () => {
    const catalog = Array.from({ length: 9 }, (_, i) => makeSong(String(i + 1)))

    it('advances cursor by 3 and returns consecutive slices', () => {
      const first = drawNextSongs(catalog, 0, 3)
      expect(first.songs.map((s) => s.path)).toEqual([
        '/songs/song-1.txt',
        '/songs/song-2.txt',
        '/songs/song-3.txt',
      ])
      expect(first.nextCursor).toBe(3)

      const second = drawNextSongs(first.nextCatalog, first.nextCursor, 3)
      expect(second.songs.map((s) => s.path)).toEqual([
        '/songs/song-4.txt',
        '/songs/song-5.txt',
        '/songs/song-6.txt',
      ])
      expect(second.nextCursor).toBe(6)
    })

    it('reshuffles and excludes immediately declined songs upon wrap-around', () => {
      // Cursor at 6, next slice would be 6..9 (songs 7, 8, 9)
      const third = drawNextSongs(catalog, 6, 3)
      expect(third.nextCursor).toBe(9)

      // Now at cursor 9, drawing again forces wrap-around.
      // The 3 songs just declined were songs 7, 8, 9.
      const fourth = drawNextSongs(catalog, 9, 3)
      expect(fourth.songs).toHaveLength(3)
      expect(fourth.nextCursor).toBe(3)

      // The fresh 3 songs offered must not be any of the 3 just declined
      const fourthPaths = new Set(fourth.songs.map((s) => s.path))
      expect(fourthPaths.has('/songs/song-7.txt')).toBe(false)
      expect(fourthPaths.has('/songs/song-8.txt')).toBe(false)
      expect(fourthPaths.has('/songs/song-9.txt')).toBe(false)
    })

    it('handles small catalogs (< 3 songs) without crashing', () => {
      const smallCatalog = [makeSong('1'), makeSong('2')]
      const result = drawNextSongs(smallCatalog, 0, 3)
      expect(result.songs).toHaveLength(2)
      expect(result.nextCursor).toBe(0)
    })
  })

  describe('initPartyRound', () => {
    const catalog = [makeSong('1'), makeSong('2'), makeSong('3'), makeSong('4')]
    const players = [makePlayer('p1', 'Alice'), makePlayer('p2', 'Bob')]

    it('returns no-mics when claimable mics is empty', () => {
      const res = initPartyRound({
        catalog,
        allPlayers: players,
        claimableMicNumbers: [],
      })
      expect(res.status).toBe('no-mics')
    })

    it('returns no-players when player roster is empty', () => {
      const res = initPartyRound({
        catalog,
        allPlayers: [],
        claimableMicNumbers: [1, 2],
      })
      expect(res.status).toBe('no-players')
    })

    it('initializes ready state with empty excludedThisRound', () => {
      const res = initPartyRound({
        catalog,
        allPlayers: players,
        claimableMicNumbers: [1, 2],
      })
      expect(res.status).toBe('ready')
      if (res.status === 'ready') {
        expect(res.state.assignedPlayerIds).toHaveLength(2)
        expect(res.state.excludedThisRound).toEqual([])
        expect(res.state.offeredSongs).toHaveLength(3)
        expect(res.state.songCursor).toBe(3)
      }
    })
  })

  describe('canSlotOptOut & executeOptOut', () => {
    const players = [
      makePlayer('p1', 'Alice'),
      makePlayer('p2', 'Bob'),
      makePlayer('p3', 'Charlie'),
    ]
    const catalog = Array.from({ length: 6 }, (_, i) => makeSong(String(i + 1)))

    it('allows opt-out when bench candidates are available', () => {
      const init = initPartyRound({
        catalog,
        allPlayers: players,
        claimableMicNumbers: [1, 2], // slots p1 and p2, p3 is on bench
      })
      expect(init.status).toBe('ready')
      if (init.status !== 'ready') return

      expect(canSlotOptOut(0, init.state, players)).toBe(true)

      const outgoingId = init.state.assignedPlayerIds[0]
      const benchPlayer = players.find((p) => !init.state.assignedPlayerIds.includes(p.id))!
      const { state: nextState, replacedPlayerId } = executeOptOut(0, init.state, players)

      expect(replacedPlayerId).toBe(benchPlayer.id)
      expect(nextState.assignedPlayerIds[0]).toBe(benchPlayer.id)
      expect(nextState.excludedThisRound).toContain(outgoingId)

      // Bench is now empty (p1 opted out, p2 and p3 are assigned)
      expect(canSlotOptOut(0, nextState, players)).toBe(false)
      expect(canSlotOptOut(1, nextState, players)).toBe(false)
    })

    it('re-rolls 3 songs simultaneously when opt-out occurs', () => {
      const init = initPartyRound({
        catalog,
        allPlayers: players,
        claimableMicNumbers: [1],
      })
      if (init.status !== 'ready') return

      const initialOffered = init.state.offeredSongs.map((s) => s.path)
      const { state: nextState } = executeOptOut(0, init.state, players)
      const nextOffered = nextState.offeredSongs.map((s) => s.path)

      expect(nextOffered).not.toEqual(initialOffered)
    })

    it('disables opt out and returns state untouched if bench is empty', () => {
      const init = initPartyRound({
        catalog,
        allPlayers: players.slice(0, 2), // only 2 players for 2 mics -> 0 on bench
        claimableMicNumbers: [1, 2],
      })
      if (init.status !== 'ready') return

      expect(canSlotOptOut(0, init.state, players.slice(0, 2))).toBe(false)
      const { state: nextState, replacedPlayerId } = executeOptOut(0, init.state, players.slice(0, 2))
      expect(replacedPlayerId).toBeNull()
      expect(nextState).toBe(init.state)
    })
  })

  describe('recordSongSung', () => {
    it('increments sing counts for assigned singers', () => {
      const counts = { p1: 1, p2: 0 }
      const updated = recordSongSung(['p1', 'p3'], counts)
      expect(updated).toEqual({
        p1: 2,
        p2: 0,
        p3: 1,
      })
    })
  })
})
