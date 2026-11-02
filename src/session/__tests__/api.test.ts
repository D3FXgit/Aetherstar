import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as api from '../api'

describe('session api', () => {
  beforeEach(() => {
    window.api = {
      session: {
        start: vi.fn().mockResolvedValue({ id: 's1', startedAt: 1 }),
        recordEntry: vi.fn().mockResolvedValue(undefined),
        listLeaderboard: vi.fn().mockResolvedValue([]),
        listSongHighscores: vi.fn().mockResolvedValue([{ playerId: 'p1', score: 9000 }]),
      },
    } as unknown as Window['api']
  })

  it('start calls window.api.session.start and returns its result', async () => {
    expect(await api.start()).toEqual({ id: 's1', startedAt: 1 })
  })

  it('recordEntry calls window.api.session.recordEntry with the given entry', async () => {
    const entry = { sessionId: 's1', songPath: '/song', playerId: 'p1', score: 100, epicCount: 1, goodCount: 0, awfulCount: 0 }
    await api.recordEntry(entry)
    expect(window.api!.session.recordEntry).toHaveBeenCalledWith(entry)
  })

  it('listLeaderboard returns window.api.session.listLeaderboard result', async () => {
    expect(await api.listLeaderboard()).toEqual([])
  })

  it('listSongHighscores passes the song query through', async () => {
    const query = { songPath: '/song', difficulty: 'hard' as const, limit: 3 }
    expect(await api.listSongHighscores(query)).toEqual([{ playerId: 'p1', score: 9000 }])
    expect(window.api!.session.listSongHighscores).toHaveBeenCalledWith(query)
  })

  it('listSongHighscores resolves to an empty list when the read fails', async () => {
    vi.mocked(window.api!.session.listSongHighscores!).mockRejectedValue(new Error('db closed'))
    await expect(api.listSongHighscores({ songPath: '/song' })).resolves.toEqual([])
  })
})

describe('session api — window.api unavailable', () => {
  beforeEach(() => {
    window.api = undefined
  })

  it('start resolves to null instead of throwing', async () => {
    await expect(api.start()).resolves.toBeNull()
  })

  it('listLeaderboard resolves to an empty array instead of throwing', async () => {
    await expect(api.listLeaderboard()).resolves.toEqual([])
  })

  it('listSongHighscores resolves to an empty array instead of throwing', async () => {
    await expect(api.listSongHighscores({ songPath: '/song' })).resolves.toEqual([])
  })

  it('recordEntry resolves instead of throwing', async () => {
    await expect(
      api.recordEntry({ sessionId: 's1', songPath: '/song', playerId: 'p1', score: 0, epicCount: 0, goodCount: 0, awfulCount: 0 }),
    ).resolves.toBeUndefined()
  })
})
