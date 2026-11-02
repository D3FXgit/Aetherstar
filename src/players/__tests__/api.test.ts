import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as api from '../api'

beforeEach(() => {
  // @ts-expect-error -- only the `players` namespace matters for this test
  window.api = {
    players: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
      reorder: vi.fn().mockResolvedValue(undefined),
      readImportedPhoto: vi.fn().mockResolvedValue('data:image/jpeg;base64,abc'),
    },
  } as Window['api']
})

describe('players api layer', () => {
  it('list() calls window.api.players.list', async () => {
    await api.list()
    expect(window.api!.players.list).toHaveBeenCalledOnce()
  })

  it('list() resolves to an empty array instead of throwing when window.api is absent', async () => {
    delete window.api
    await expect(api.list()).resolves.toEqual([])
  })

  // A partial preload (a test harness stubbing one namespace, or a bridge that
  // failed halfway) leaves window.api present but window.api.players missing.
  it('list() resolves to an empty array when window.api exists without a players namespace', async () => {
    window.api = {} as Window['api']
    await expect(api.list()).resolves.toEqual([])
  })

  it('create() calls window.api.players.create with the input', async () => {
    await api.create({ name: 'Alex', color: 'coral' })
    expect(window.api!.players.create).toHaveBeenCalledWith({ name: 'Alex', color: 'coral' })
  })

  it('update() calls window.api.players.update with the input', async () => {
    await api.update({ id: 'p1', name: 'Alexandra' })
    expect(window.api!.players.update).toHaveBeenCalledWith({ id: 'p1', name: 'Alexandra' })
  })

  it('deletePlayer() calls window.api.players.delete with the id', async () => {
    await api.deletePlayer('p1')
    expect(window.api!.players.delete).toHaveBeenCalledWith('p1')
  })

  it('reorder() calls window.api.players.reorder with the ordered ids', async () => {
    await api.reorder(['p2', 'p1'])
    expect(window.api!.players.reorder).toHaveBeenCalledWith(['p2', 'p1'])
  })

  it('readImportedPhoto() calls window.api.players.readImportedPhoto with the path', async () => {
    await api.readImportedPhoto('/tmp/photo.jpg')
    expect(window.api!.players.readImportedPhoto).toHaveBeenCalledWith('/tmp/photo.jpg')
  })
})
