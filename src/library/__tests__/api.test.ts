import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as api from '../api'

describe('library api', () => {
  beforeEach(() => {
    window.api = {
      library: {
        addRoot: vi.fn().mockResolvedValue(undefined),
        removeRoot: vi.fn().mockResolvedValue(undefined),
        listRoots: vi.fn().mockResolvedValue([{ path: '/library', addedAt: 1 }]),
        rescan: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
        getSong: vi.fn().mockResolvedValue(null),
        listScanErrors: vi.fn().mockResolvedValue([]),
        onScanProgress: vi.fn().mockReturnValue(() => {}),
      },
    } as unknown as Window['api']
  })

  it('addRoot calls window.api.library.addRoot', async () => {
    await api.addRoot('/library')
    expect(window.api!.library.addRoot).toHaveBeenCalledWith('/library')
  })

  it('removeRoot calls window.api.library.removeRoot', async () => {
    await api.removeRoot('/library')
    expect(window.api!.library.removeRoot).toHaveBeenCalledWith('/library')
  })

  it('listRoots returns window.api.library.listRoots result', async () => {
    const roots = await api.listRoots()
    expect(roots).toEqual([{ path: '/library', addedAt: 1 }])
  })

  it('rescan calls window.api.library.rescan', async () => {
    await api.rescan('/library')
    expect(window.api!.library.rescan).toHaveBeenCalledWith('/library')
  })

  it('search calls window.api.library.search with filters', async () => {
    await api.search({ query: 'nova' })
    expect(window.api!.library.search).toHaveBeenCalledWith({ query: 'nova' })
  })

  it('getSong calls window.api.library.getSong', async () => {
    await api.getSong('/library/song')
    expect(window.api!.library.getSong).toHaveBeenCalledWith('/library/song')
  })

  it('listScanErrors calls window.api.library.listScanErrors', async () => {
    await api.listScanErrors()
    expect(window.api!.library.listScanErrors).toHaveBeenCalled()
  })

  it('onScanProgress subscribes via window.api.library.onScanProgress', () => {
    const cb = vi.fn()
    api.onScanProgress(cb)
    expect(window.api!.library.onScanProgress).toHaveBeenCalledWith(cb)
  })
})

describe('library api — window.api unavailable (e.g. rendered outside Electron)', () => {
  beforeEach(() => {
    window.api = undefined
  })

  it('search resolves to an empty array instead of throwing', async () => {
    await expect(api.search({})).resolves.toEqual([])
  })

  it('listRoots resolves to an empty array instead of throwing', async () => {
    await expect(api.listRoots()).resolves.toEqual([])
  })

  it('listScanErrors resolves to an empty array instead of throwing', async () => {
    await expect(api.listScanErrors()).resolves.toEqual([])
  })

  it('getSong resolves to null instead of throwing', async () => {
    await expect(api.getSong('/x')).resolves.toBeNull()
  })

  it('onScanProgress returns a no-op unsubscribe instead of throwing', () => {
    expect(() => api.onScanProgress(() => {})()).not.toThrow()
  })
})
