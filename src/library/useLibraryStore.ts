// Library state: roots, the current search, scan progress/errors and favourites.
import { create } from 'zustand'
import * as api from './api'
import { logCrash } from '../diagnostics/log'
import type { LibraryRoot, LibrarySearchFilters, LibrarySong, ScanErrorEntry, ScanProgress } from './types'
import { fuzzyFilter } from './fuzzySearch'

const NO_FAVORITES: ReadonlySet<string> = new Set()

/**
 * How stale a root's index may get before opening the selector re-walks it.
 * Longer than a song, so the between-songs reopen is free; session-scoped, so
 * a restart always rescans. "Refresh library" bypasses it.
 */
export const REINDEX_COOLDOWN_MS = 5 * 60_000

/** How long typing has to pause before the search runs (see `searchQuery`). */
export const SEARCH_DEBOUNCE_MS = 120

/**
 * The filters that decide *which* songs are in play, as one comparable key.
 * The free-text query is deliberately not part of it: the query only ranks and
 * narrows that list client-side, so typing never needs a new database read.
 */
function baseFilterKey(filters: LibrarySearchFilters): string {
  const { language, edition, duetOnly, hasVideoOnly, favoritesOnly, sort } = filters
  return JSON.stringify([
    language ?? null,
    edition ?? null,
    Boolean(duetOnly),
    Boolean(hasVideoOnly),
    Boolean(favoritesOnly),
    sort ?? null,
  ])
}

function withoutQuery(filters: LibrarySearchFilters): LibrarySearchFilters {
  const rest = { ...filters }
  delete rest.query
  return rest
}

function narrow(songs: LibrarySong[], query: string | undefined): LibrarySong[] {
  const trimmed = query?.trim()
  return trimmed ? fuzzyFilter(songs, trimmed) : songs
}

/** Bumped by every library read; a read that lands behind a newer one is dropped. */
let readSequence = 0
let queryTimer: ReturnType<typeof setTimeout> | null = null

interface LibraryStoreState {
  roots: LibraryRoot[]
  results: LibrarySong[]
  scanProgress: Record<string, ScanProgress>
  scanErrors: ScanErrorEntry[]
  filters: LibrarySearchFilters
  /** When each root was last handed to the scanner, by root path (see REINDEX_COOLDOWN_MS). */
  lastScanAt: Record<string, number>
  /** True while a background reindex is walking the disk -- drives the selector's progress readout. */
  isReindexing: boolean
  /**
   * The unqueried song list for the current filters, and which filters it was
   * read for. Typing a query reuses it (and its fuzzy index) instead of asking
   * the database again; any library change or explicit refresh replaces it.
   */
  searchBase: { key: string; songs: LibrarySong[] } | null
  /** Starred song paths. */
  favorites: ReadonlySet<string>
  loadRoots: () => Promise<void>
  addRoot: (rootPath: string) => Promise<void>
  removeRoot: (rootPath: string) => Promise<void>
  rescan: (rootPath: string) => Promise<void>
  reindexStaleRoots: (maxAgeMs?: number) => Promise<void>
  /**
   * Run a search. With `filters`, they become the active filters; without,
   * the active filters are re-run against a fresh read of the library.
   */
  search: (filters?: LibrarySearchFilters) => Promise<void>
  /** Change only the free-text query, debounced by SEARCH_DEBOUNCE_MS. */
  searchQuery: (query: string) => void
  setFilters: (filters: LibrarySearchFilters) => void
  refreshScanErrors: () => Promise<void>
  loadFavorites: () => Promise<void>
  /** Star or unstar a song; applied at once, persisted in the background. */
  toggleFavorite: (songPath: string) => Promise<void>
  subscribeToProgress: () => () => void
}

export const useLibraryStore = create<LibraryStoreState>((set, get) => ({
  roots: [],
  results: [],
  scanProgress: {},
  scanErrors: [],
  filters: {},
  lastScanAt: {},
  isReindexing: false,
  searchBase: null,
  favorites: NO_FAVORITES,

  // Roots are persisted in the main-process database; this re-reads them.
  loadRoots: async () => {
    set({ roots: await api.listRoots() })
  },

  addRoot: async (rootPath) => {
    await api.addRoot(rootPath)
    set({ roots: await api.listRoots() })
    await get().search()
    await get().refreshScanErrors()
  },

  removeRoot: async (rootPath) => {
    await api.removeRoot(rootPath)
    set({ roots: await api.listRoots() })
    await get().search()
  },

  rescan: async (rootPath) => {
    set((state) => ({ lastScanAt: { ...state.lastScanAt, [rootPath]: Date.now() } }))
    await api.rescan(rootPath)
    await get().search()
    await get().refreshScanErrors()
  },

  /**
   * Re-walk every root whose index is older than `maxAgeMs` and fold the
   * result back in. Pass `0` for an explicit, user-asked-for refresh.
   *
   * Three properties this has to hold, because it runs while someone is
   * already using the screen that called it:
   *  - it never touches `results` until the new rows are in hand, so the grid
   *    the user is clicking through is replaced, never blanked;
   *  - it resolves rather than rejects -- a background refresh must not take
   *    the screen down with it;
   *  - it claims its roots synchronously, before the first await, so React's
   *    double-invoked mount effect (or a fast reopen) cannot start a second
   *    walk over the same library.
   */
  reindexStaleRoots: async (maxAgeMs = REINDEX_COOLDOWN_MS) => {
    if (get().isReindexing) return
    const now = Date.now()
    const { roots, lastScanAt } = get()
    const stale = roots.filter((root) => now - (lastScanAt[root.path] ?? 0) >= maxAgeMs)
    if (stale.length === 0) return

    set((state) => ({
      lastScanAt: { ...state.lastScanAt, ...Object.fromEntries(stale.map((root) => [root.path, now])) },
      isReindexing: true,
    }))

    try {
      await Promise.all(stale.map((root) => api.rescan(root.path)))
      // One search for the whole batch, after the scans land: N roots must not
      // reorder the grid N times for a single refresh.
      await get().search()
      await get().refreshScanErrors()
    } catch (error) {
      logCrash('library:reindex', error, { roots: stale.map((root) => root.path) })
      // A failed walk must not buy itself five minutes of silence -- give the
      // claim back so the next open retries.
      set((state) => {
        const restored = { ...state.lastScanAt }
        for (const root of stale) {
          const previous = lastScanAt[root.path]
          if (previous === undefined) delete restored[root.path]
          else restored[root.path] = previous
        }
        return { lastScanAt: restored }
      })
    } finally {
      set({ isReindexing: false })
    }
  },

  search: async (filters) => {
    const activeFilters = filters ?? get().filters
    if (filters) set({ filters })

    const key = baseFilterKey(activeFilters)
    const cached = get().searchBase
    if (filters && cached && cached.key === key) {
      set({ results: narrow(cached.songs, activeFilters.query) })
      return
    }

    const sequence = ++readSequence
    const songs = await api.search(withoutQuery(activeFilters))
    // Filters change faster than the database answers; an older read landing
    // last must not overwrite a newer one.
    if (sequence !== readSequence) return
    set({ searchBase: { key, songs } })
    // Ranked against the query as it is *now*: someone may have kept typing
    // (served from the previous list) while this read was in flight.
    const current = get().filters
    if (baseFilterKey(current) === key) set({ results: narrow(songs, current.query) })
  },

  searchQuery: (query) => {
    if (queryTimer !== null) clearTimeout(queryTimer)
    queryTimer = setTimeout(() => {
      queryTimer = null
      void get().search({ ...get().filters, query })
    }, SEARCH_DEBOUNCE_MS)
  },

  setFilters: (filters) => {
    set({ filters })
  },

  refreshScanErrors: async () => {
    set({ scanErrors: await api.listScanErrors() })
  },

  loadFavorites: async () => {
    set({ favorites: new Set(await api.listFavorites()) })
  },

  toggleFavorite: async (songPath) => {
    const favorite = !get().favorites.has(songPath)
    set((state) => {
      const next = new Set(state.favorites)
      if (favorite) next.add(songPath)
      else next.delete(songPath)
      return { favorites: next }
    })
    try {
      await api.setFavorite(songPath, favorite)
    } catch (error) {
      logCrash('library:set-favorite', error, { songPath })
    }
    // The favourites filter is answered by the database, so it needs a fresh read.
    if (get().filters.favoritesOnly) await get().search()
  },

  subscribeToProgress: () => {
    return api.onScanProgress((progress) => {
      set((state) => ({ scanProgress: { ...state.scanProgress, [progress.rootPath]: progress } }))
    })
  },
}))
