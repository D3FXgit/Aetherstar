import { describe, expect, it, vi, beforeEach } from 'vitest'
import { usePlayersStore } from '../store'
import * as api from '../api'

vi.mock('../api')

const PLAYER_A = { id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' }
const PLAYER_B = { id: 'p2', name: 'Sam', color: 'cyan', avatarUrl: '' }

beforeEach(() => {
  usePlayersStore.setState({ players: [] })
  vi.mocked(api.list).mockResolvedValue([PLAYER_A, PLAYER_B])
  vi.mocked(api.create).mockResolvedValue(PLAYER_A)
  vi.mocked(api.update).mockResolvedValue({ ...PLAYER_A, name: 'Alexandra' })
  vi.mocked(api.deletePlayer).mockResolvedValue(undefined)
  vi.mocked(api.reorder).mockResolvedValue(undefined)
})

describe('usePlayersStore', () => {
  it('load() populates players from api.list', async () => {
    await usePlayersStore.getState().load()
    expect(usePlayersStore.getState().players).toEqual([PLAYER_A, PLAYER_B])
  })

  it('create() calls api.create and refreshes players from api.list', async () => {
    await usePlayersStore.getState().create({ name: 'Alex', color: 'coral' })
    expect(api.create).toHaveBeenCalledWith({ name: 'Alex', color: 'coral' })
    expect(api.list).toHaveBeenCalled()
    expect(usePlayersStore.getState().players).toEqual([PLAYER_A, PLAYER_B])
  })

  it('update() calls api.update and refreshes players', async () => {
    await usePlayersStore.getState().update({ id: 'p1', name: 'Alexandra' })
    expect(api.update).toHaveBeenCalledWith({ id: 'p1', name: 'Alexandra' })
    expect(api.list).toHaveBeenCalled()
  })

  it('delete() calls api.deletePlayer and refreshes players', async () => {
    await usePlayersStore.getState().delete('p1')
    expect(api.deletePlayer).toHaveBeenCalledWith('p1')
    expect(api.list).toHaveBeenCalled()
  })

  it('reorder() calls api.reorder and refreshes players', async () => {
    await usePlayersStore.getState().reorder(['p2', 'p1'])
    expect(api.reorder).toHaveBeenCalledWith(['p2', 'p1'])
    expect(api.list).toHaveBeenCalled()
  })
})
