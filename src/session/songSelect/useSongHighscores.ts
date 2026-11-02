import { useEffect, useState } from 'react'
import { listSongHighscores } from '../api'
import type { LeaderboardEntry } from '../types'

/** The best score on each difficulty of one song; null path fetches nothing. */
export function useSongHighscores(songPath: string | null): LeaderboardEntry[] {
  const [loaded, setLoaded] = useState<{ songPath: string; entries: LeaderboardEntry[] } | null>(null)

  useEffect(() => {
    if (!songPath) return
    let cancelled = false
    void listSongHighscores({ songPath, limit: 1 }).then((entries) => {
      if (!cancelled) setLoaded({ songPath, entries })
    })
    return () => {
      cancelled = true
    }
  }, [songPath])

  // Scores fetched for a previous selection are never shown under this one.
  return loaded && loaded.songPath === songPath ? loaded.entries : []
}
