// The record on each offered mystery song, for the gallery cards. Read-only.
import { useEffect, useState } from 'react'
import { listSongHighscores } from '../api'
import type { LeaderboardEntry } from '../types'

/** The single best entry across every difficulty ladder, or null when nobody has sung it. */
export function bestOf(entries: readonly LeaderboardEntry[]): LeaderboardEntry | null {
  let best: LeaderboardEntry | null = null
  for (const entry of entries) {
    if (entry.score > 0 && (!best || entry.score > best.score)) best = entry
  }
  return best
}

/**
 * Best entry per song path. A path missing from the map is still loading (or
 * has no record); results for a previous deal are never shown under a new one.
 */
export function useSongBests(songPaths: readonly string[]): Record<string, LeaderboardEntry | null> {
  const key = songPaths.join('\n')
  const [loaded, setLoaded] = useState<{ key: string; bests: Record<string, LeaderboardEntry | null> } | null>(null)

  useEffect(() => {
    if (!key) return
    const paths = key.split('\n')
    let cancelled = false
    void Promise.all(paths.map((songPath) => listSongHighscores({ songPath, limit: 1 }))).then((lists) => {
      if (cancelled) return
      const bests: Record<string, LeaderboardEntry | null> = {}
      paths.forEach((path, index) => {
        bests[path] = bestOf(lists[index] ?? [])
      })
      setLoaded({ key, bests })
    })
    return () => {
      cancelled = true
    }
  }, [key])

  return loaded && loaded.key === key ? loaded.bests : {}
}
