// Thin window.api.library wrapper. Degrades to empty results / no-ops when the
// preload bridge is absent (renderer-only tests, the browser preview).
import type { LibraryRoot, LibrarySearchFilters, LibrarySong, ScanErrorEntry, ScanProgress } from './types'

function libraryApi() {
  return window.api?.library
}

export const addRoot = (rootPath: string): Promise<void> => libraryApi()?.addRoot(rootPath) ?? Promise.resolve()
export const removeRoot = (rootPath: string): Promise<void> => libraryApi()?.removeRoot(rootPath) ?? Promise.resolve()
export const listRoots = (): Promise<LibraryRoot[]> => libraryApi()?.listRoots() ?? Promise.resolve([])
export const rescan = (rootPath: string): Promise<void> => libraryApi()?.rescan(rootPath) ?? Promise.resolve()
export const search = (filters: LibrarySearchFilters): Promise<LibrarySong[]> =>
  libraryApi()?.search(filters) ?? Promise.resolve([])
export const getSong = (songPath: string): Promise<LibrarySong | null> => libraryApi()?.getSong(songPath) ?? Promise.resolve(null)
export const listScanErrors = (): Promise<ScanErrorEntry[]> => libraryApi()?.listScanErrors() ?? Promise.resolve([])
export const onScanProgress = (callback: (progress: ScanProgress) => void): (() => void) =>
  libraryApi()?.onScanProgress(callback) ?? (() => {})

/** Starred song paths; empty (never rejecting) when the bridge or the database is unavailable. */
export const listFavorites = (): Promise<string[]> => {
  const listing = libraryApi()?.listFavorites?.()
  return listing ? listing.then((paths) => paths ?? []).catch(() => []) : Promise.resolve([])
}

export const setFavorite = (songPath: string, favorite: boolean): Promise<void> => {
  const request = libraryApi()?.setFavorite?.(songPath, favorite)
  return request ? request.then(() => undefined) : Promise.resolve()
}

/** Count one play of a song. Fire-and-forget: history is never worth failing a song over. */
export function recordPlay(songPath: string, mode: string | null): void {
  try {
    void libraryApi()?.recordPlay?.(songPath, mode)?.catch(() => {})
  } catch {
    // An older preload without the method: nothing to record into.
  }
}

// The renderer's own copy of the same signal, for renderer-side background
// work that must also stand down while a song is sung (e.g. decoding a whole
// song to measure its loudness -- src/audio/songGain.ts).
let gameplayActive = false
let idleWaiters: (() => void)[] = []

/**
 * Tell the main process a song is (or is no longer) being sung, so library
 * scans, loudness analysis and device polling can stand down while it is.
 *
 * Optional on the bridge: an older preload (or a test stub) without the
 * method simply makes this a no-op.
 */
export function setGameplayActive(active: boolean): void {
  gameplayActive = active === true
  if (!gameplayActive) {
    const waiting = idleWaiters
    idleWaiters = []
    for (const resolve of waiting) resolve()
  }
  try {
    libraryApi()?.setGameplayActive?.(active)
  } catch {
    // Pausing background work is an optimisation; failing to is never fatal to the song.
  }
}

/** True while a song is being sung (between setGameplayActive(true) and (false)). */
export function isGameplayActive(): boolean {
  return gameplayActive
}

/** Resolves at once when no song is being sung, else as soon as the current one ends. */
export function whenGameplayIdle(): Promise<void> {
  if (!gameplayActive) return Promise.resolve()
  return new Promise((resolve) => idleWaiters.push(resolve))
}
