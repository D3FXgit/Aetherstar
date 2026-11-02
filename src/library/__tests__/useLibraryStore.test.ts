import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useLibraryStore, REINDEX_COOLDOWN_MS, SEARCH_DEBOUNCE_MS } from '../useLibraryStore'
import type { LibrarySong } from '../types'

const SONG = {
  path: '/library/song',
  artist: 'Nova Lane',
  title: 'Paper Satellites',
  durationMs: 180000,
  thumbnailPath: null,
  mp3Path: '/library/song/song.mp3',
  videoPath: '/library/song/video.mp4',
  bpm: 250,
  gap: 24065,
  hasVideo: true,
  hasCover: true,
  isDuet: false,
  isPlayable: true,
  addedAt: 1,
}

describe('useLibraryStore', () => {
  beforeEach(() => {
    let progressCallback: ((p: unknown) => void) | null = null
    window.api = {
      library: {
        addRoot: vi.fn().mockResolvedValue(undefined),
        removeRoot: vi.fn().mockResolvedValue(undefined),
        listRoots: vi.fn().mockResolvedValue([]),
        rescan: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([SONG]),
        getSong: vi.fn().mockResolvedValue(null),
        listScanErrors: vi.fn().mockResolvedValue([]),
        onScanProgress: vi.fn((cb: (p: unknown) => void) => {
          progressCallback = cb
          return () => {}
        }),
      },
    } as unknown as Window['api']
    ;(window as unknown as { __emitProgress: (p: unknown) => void }).__emitProgress = (p: unknown) =>
      progressCallback?.(p)

    useLibraryStore.setState({
      roots: [],
      results: [],
      scanProgress: {},
      scanErrors: [],
      filters: {},
      lastScanAt: {},
      isReindexing: false,
      searchBase: null,
    })
  })

  it('search() populates results', async () => {
    await act(async () => {
      await useLibraryStore.getState().search({ query: 'nova' })
    })
    expect(useLibraryStore.getState().results).toEqual([SONG])
  })

  it('addRoot updates roots after calling window.api.library.addRoot', async () => {
    vi.mocked(window.api!.library.listRoots).mockResolvedValue([{ path: '/library', addedAt: 1 }])
    await act(async () => {
      await useLibraryStore.getState().addRoot('/library')
    })
    expect(useLibraryStore.getState().roots).toEqual([{ path: '/library', addedAt: 1 }])
  })

  it('addRoot refreshes search results and scan errors after the scan completes, not just roots', async () => {
    vi.mocked(window.api!.library.listRoots).mockResolvedValue([{ path: '/library', addedAt: 1 }])
    vi.mocked(window.api!.library.listScanErrors).mockResolvedValue([{ path: '/library/bad', reason: 'x', timestamp: 1 }])
    await act(async () => {
      await useLibraryStore.getState().addRoot('/library')
    })
    expect(useLibraryStore.getState().results).toEqual([SONG])
    expect(useLibraryStore.getState().scanErrors).toEqual([{ path: '/library/bad', reason: 'x', timestamp: 1 }])
  })

  it('rescan refreshes search results after the scan completes', async () => {
    await act(async () => {
      await useLibraryStore.getState().rescan('/library')
    })
    expect(window.api!.library.search).toHaveBeenCalled()
    expect(useLibraryStore.getState().results).toEqual([SONG])
  })

  it('removeRoot updates roots after calling window.api.library.removeRoot', async () => {
    useLibraryStore.setState({ roots: [{ path: '/library', addedAt: 1 }] })
    vi.mocked(window.api!.library.listRoots).mockResolvedValue([])
    await act(async () => {
      await useLibraryStore.getState().removeRoot('/library')
    })
    expect(useLibraryStore.getState().roots).toEqual([])
  })

  describe('reindexStaleRoots', () => {
    const ROOT_A = { path: '/library/a', addedAt: 1 }
    const ROOT_B = { path: '/library/b', addedAt: 2 }

    it('rescans every root that has not been scanned this session, then refreshes results once for the whole batch', async () => {
      useLibraryStore.setState({ roots: [ROOT_A, ROOT_B] })

      await act(async () => {
        await useLibraryStore.getState().reindexStaleRoots()
      })

      expect(window.api!.library.rescan).toHaveBeenCalledWith('/library/a')
      expect(window.api!.library.rescan).toHaveBeenCalledWith('/library/b')
      // One search for two roots -- not one per root, which would make the grid
      // churn twice for a single refresh.
      expect(window.api!.library.search).toHaveBeenCalledTimes(1)
      expect(useLibraryStore.getState().results).toEqual([SONG])
    })

    // The party case: the host reopens the selector between every song. A song
    // is minutes long, so the cooldown has to outlast one, or every reopen pays
    // for a full filesystem walk.
    it('skips a root that was scanned inside the cooldown window', async () => {
      useLibraryStore.setState({ roots: [ROOT_A], lastScanAt: { '/library/a': Date.now() } })

      await act(async () => {
        await useLibraryStore.getState().reindexStaleRoots()
      })

      expect(window.api!.library.rescan).not.toHaveBeenCalled()
    })

    it('rescans again once a root has gone stale past the cooldown', async () => {
      useLibraryStore.setState({
        roots: [ROOT_A],
        lastScanAt: { '/library/a': Date.now() - REINDEX_COOLDOWN_MS - 1 },
      })

      await act(async () => {
        await useLibraryStore.getState().reindexStaleRoots()
      })

      expect(window.api!.library.rescan).toHaveBeenCalledWith('/library/a')
    })

    it('an explicit refresh (maxAge 0) rescans even a root scanned a moment ago', async () => {
      useLibraryStore.setState({ roots: [ROOT_A], lastScanAt: { '/library/a': Date.now() } })

      await act(async () => {
        await useLibraryStore.getState().reindexStaleRoots(0)
      })

      expect(window.api!.library.rescan).toHaveBeenCalledTimes(1)
    })

    // React runs mount effects twice under StrictMode, and the selector can be
    // reopened before the first walk finishes. Claiming the roots *before* the
    // first await is what stops two filesystem walks racing over one library.
    it('claims its roots synchronously, so a concurrent second call starts no duplicate walk', async () => {
      useLibraryStore.setState({ roots: [ROOT_A] })

      await act(async () => {
        const first = useLibraryStore.getState().reindexStaleRoots()
        const second = useLibraryStore.getState().reindexStaleRoots()
        await Promise.all([first, second])
      })

      expect(window.api!.library.rescan).toHaveBeenCalledTimes(1)
    })

    it('flags isReindexing while the walk runs and clears it when the walk settles', async () => {
      useLibraryStore.setState({ roots: [ROOT_A] })
      let releaseScan: () => void = () => {}
      vi.mocked(window.api!.library.rescan).mockReturnValue(
        new Promise<void>((resolve) => {
          releaseScan = resolve
        }),
      )

      let pending!: Promise<void>
      act(() => {
        pending = useLibraryStore.getState().reindexStaleRoots()
      })
      expect(useLibraryStore.getState().isReindexing).toBe(true)

      await act(async () => {
        releaseScan()
        await pending
      })
      expect(useLibraryStore.getState().isReindexing).toBe(false)
    })

    // The whole point of a background reindex: the grid the user is already
    // clicking through must survive it untouched until new rows actually land.
    it('leaves the existing results in place for the entire scan, never blanking them first', async () => {
      const existing = [{ ...SONG, path: '/library/old' }]
      useLibraryStore.setState({ roots: [ROOT_A], results: existing })
      let releaseScan: () => void = () => {}
      vi.mocked(window.api!.library.rescan).mockReturnValue(
        new Promise<void>((resolve) => {
          releaseScan = resolve
        }),
      )

      let pending!: Promise<void>
      act(() => {
        pending = useLibraryStore.getState().reindexStaleRoots()
      })
      expect(useLibraryStore.getState().results).toEqual(existing)

      await act(async () => {
        releaseScan()
        await pending
      })
      expect(useLibraryStore.getState().results).toEqual([SONG])
    })

    it('rejects nothing to its caller and releases the cooldown claim when a scan fails, so the next open retries', async () => {
      useLibraryStore.setState({ roots: [ROOT_A] })
      vi.mocked(window.api!.library.rescan).mockRejectedValueOnce(new Error('worker died'))
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        await act(async () => {
          await expect(useLibraryStore.getState().reindexStaleRoots()).resolves.toBeUndefined()
        })
        expect(useLibraryStore.getState().isReindexing).toBe(false)

        await act(async () => {
          await useLibraryStore.getState().reindexStaleRoots()
        })
        expect(window.api!.library.rescan).toHaveBeenCalledTimes(2)
      } finally {
        consoleError.mockRestore()
      }
    })

    it('does nothing at all when there are no roots yet', async () => {
      await act(async () => {
        await useLibraryStore.getState().reindexStaleRoots()
      })

      expect(window.api!.library.rescan).not.toHaveBeenCalled()
      expect(useLibraryStore.getState().isReindexing).toBe(false)
    })
  })

  it('subscribeToProgress updates scanProgress keyed by root path', () => {
    useLibraryStore.getState().subscribeToProgress()
    act(() => {
      ;(window as unknown as { __emitProgress: (p: unknown) => void }).__emitProgress({
        rootPath: '/library',
        songsFound: 5,
        songsParsed: 2,
        currentPath: '/library/x',
        done: false,
        errorCount: 0,
      })
    })
    expect(useLibraryStore.getState().scanProgress['/library']?.songsParsed).toBe(2)
  })

  describe('typing a search', () => {
    const OTHER = { ...SONG, path: '/library/other', artist: 'Kestrel Moss', title: 'Paper Orbit' }

    it('reads the library without the query and narrows it client-side, so typing never re-reads it', async () => {
      vi.mocked(window.api!.library.search).mockResolvedValue([SONG, OTHER])
      await act(async () => {
        await useLibraryStore.getState().search({ query: 'kestrel' })
        await useLibraryStore.getState().search({ query: 'nova' })
      })

      expect(window.api!.library.search).toHaveBeenCalledTimes(1)
      expect(window.api!.library.search).toHaveBeenCalledWith({})
      expect(useLibraryStore.getState().results).toEqual([SONG])
    })

    it('reads the library again when a filter other than the query changes', async () => {
      await act(async () => {
        await useLibraryStore.getState().search({ query: 'nova' })
        await useLibraryStore.getState().search({ query: 'nova', duetOnly: true })
      })

      expect(window.api!.library.search).toHaveBeenCalledTimes(2)
      expect(window.api!.library.search).toHaveBeenLastCalledWith({ duetOnly: true })
    })

    it('drops a slow answer that arrives after a newer search has already landed', async () => {
      let resolveSlow: (songs: (typeof SONG)[]) => void = () => {}
      vi.mocked(window.api!.library.search)
        .mockImplementationOnce(() => new Promise((resolve) => (resolveSlow = resolve)))
        .mockResolvedValueOnce([OTHER])

      let slow: Promise<void> = Promise.resolve()
      await act(async () => {
        slow = useLibraryStore.getState().search({ duetOnly: true })
        await useLibraryStore.getState().search({ hasVideoOnly: true })
      })
      await act(async () => {
        resolveSlow([SONG])
        await slow
      })

      expect(useLibraryStore.getState().results).toEqual([OTHER])
    })

    it('a library read still lands when the user typed (served from the old list) while it was in flight', async () => {
      vi.mocked(window.api!.library.search).mockResolvedValue([SONG])
      await act(async () => {
        await useLibraryStore.getState().search({})
      })

      let resolveRefresh: (songs: (typeof SONG)[]) => void = () => {}
      vi.mocked(window.api!.library.search).mockImplementationOnce(() => new Promise((resolve) => (resolveRefresh = resolve)))
      let refresh: Promise<void> = Promise.resolve()
      await act(async () => {
        refresh = useLibraryStore.getState().search()
        await useLibraryStore.getState().search({ query: 'kestrel' })
      })
      await act(async () => {
        resolveRefresh([SONG, OTHER])
        await refresh
      })

      expect(useLibraryStore.getState().results).toEqual([OTHER])
    })

    it('searchQuery() waits for typing to pause and runs one search for the burst', async () => {
      vi.useFakeTimers()
      try {
        vi.mocked(window.api!.library.search).mockResolvedValue([SONG, OTHER])
        useLibraryStore.getState().searchQuery('k')
        useLibraryStore.getState().searchQuery('ky')
        useLibraryStore.getState().searchQuery('kestrel')
        expect(window.api!.library.search).not.toHaveBeenCalled()

        await act(async () => {
          await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
        })

        expect(window.api!.library.search).toHaveBeenCalledTimes(1)
        expect(useLibraryStore.getState().filters.query).toBe('kestrel')
        expect(useLibraryStore.getState().results).toEqual([OTHER])
      } finally {
        vi.useRealTimers()
      }
    })
  })
})

describe('favourites', () => {
  const SONG: LibrarySong = {
    path: '/library/fav',
    artist: 'A',
    title: 'Fav',
    durationMs: 1,
    thumbnailPath: null,
    mp3Path: '/library/fav/a.mp3',
    videoPath: null,
    bpm: 1,
    gap: 0,
    hasVideo: false,
    hasCover: false,
    isDuet: false,
    isPlayable: true,
    addedAt: 1,
  }

  beforeEach(() => {
    useLibraryStore.setState({ favorites: new Set(), filters: {}, searchBase: null, results: [] })
    window.api = {
      library: {
        search: vi.fn().mockResolvedValue([SONG]),
        listFavorites: vi.fn().mockResolvedValue(['/library/fav']),
        setFavorite: vi.fn().mockResolvedValue(true),
      },
    } as unknown as Window['api']
  })

  it('loads the starred paths', async () => {
    await useLibraryStore.getState().loadFavorites()
    expect([...useLibraryStore.getState().favorites]).toEqual(['/library/fav'])
  })

  it('toggles a star at once and persists it', async () => {
    await useLibraryStore.getState().toggleFavorite('/library/x')
    expect(useLibraryStore.getState().favorites.has('/library/x')).toBe(true)
    expect(window.api!.library.setFavorite).toHaveBeenCalledWith('/library/x', true)

    await useLibraryStore.getState().toggleFavorite('/library/x')
    expect(useLibraryStore.getState().favorites.has('/library/x')).toBe(false)
    expect(window.api!.library.setFavorite).toHaveBeenLastCalledWith('/library/x', false)
  })

  it('re-reads the library when a star changes under the favourites filter', async () => {
    await useLibraryStore.getState().search({ favoritesOnly: true })
    vi.mocked(window.api!.library.search).mockClear()

    await useLibraryStore.getState().toggleFavorite('/library/fav')

    expect(window.api!.library.search).toHaveBeenCalledWith({ favoritesOnly: true })
  })

  it('treats the favourites filter as a different song list, not a cached one', async () => {
    await useLibraryStore.getState().search({})
    vi.mocked(window.api!.library.search).mockClear()
    await useLibraryStore.getState().search({ favoritesOnly: true })
    expect(window.api!.library.search).toHaveBeenCalledTimes(1)
  })

  it('degrades to no favourites without the bridge method', async () => {
    window.api = { library: {} } as unknown as Window['api']
    await useLibraryStore.getState().loadFavorites()
    expect(useLibraryStore.getState().favorites.size).toBe(0)
  })
})
