// The results screen's side effects: file each singer's score, update their
// player stats, and find out who just set a song record.
import { useEffect, useRef, useState } from 'react'
import { difficultyForPlayer, useCalibrationStore } from '../../calibration/calibrationStore'
import type { Difficulty } from '../../calibration/types'
import type { LibrarySong } from '../../library/types'
import * as playersApi from '../../players/api'
import { usePlayersStore } from '../../players/store'
import * as sessionApi from '../api'
import { newHighscoreHolders } from '../highscores'
import type { SessionSongResult } from '../types'

const NO_HOLDERS: ReadonlySet<string> = new Set()

/**
 * Fires once, on mount, independent of the celebration: skipping it or
 * leaving on the first frame must neither replay nor drop the song just sung.
 * Returns the singers who beat this song's record on their difficulty.
 */
export function useResultsWriteBack(
  lastResult: SessionSongResult[] | null,
  selectedSong: LibrarySong | null,
  sessionId: string | null,
): ReadonlySet<string> {
  const recordedRef = useRef(false)
  const [newHighscores, setNewHighscores] = useState<ReadonlySet<string>>(NO_HOLDERS)

  useEffect(() => {
    if (!lastResult || lastResult.length === 0 || !selectedSong || !sessionId || recordedRef.current) return
    recordedRef.current = true

    // Each singer's score is filed under the difficulty they sang it on.
    const calibration = useCalibrationStore.getState().settings
    const withDifficulty = lastResult.map((result) => ({
      ...result,
      difficulty: difficultyForPlayer(calibration, result.playerId),
    }))

    // Entries from this very song are excluded, so the record to beat can
    // never be the score being written now.
    const recordedFrom = Date.now()
    void sessionApi.listSongHighscores({ songPath: selectedSong.path, limit: 3 }).then((entries) => {
      const previousBest: Partial<Record<Difficulty, number>> = {}
      for (const entry of entries) {
        if (entry.sessionId === sessionId && entry.playedAt >= recordedFrom) continue
        const difficulty = entry.difficulty ?? 'normal'
        previousBest[difficulty] = Math.max(previousBest[difficulty] ?? 0, entry.score)
      }
      setNewHighscores(newHighscoreHolders(withDifficulty, previousBest))
    })

    for (const result of withDifficulty) {
      void sessionApi.recordEntry({
        sessionId,
        songPath: selectedSong.path,
        playerId: result.playerId,
        score: result.score,
        epicCount: result.epicCount,
        goodCount: result.goodCount,
        awfulCount: result.awfulCount,
        difficulty: result.difficulty,
      })

      const player = usePlayersStore.getState().players.find((p) => p.id === result.playerId)
      void playersApi
        .update({
          id: result.playerId,
          songsSung: (player?.songsSung ?? 0) + 1,
          bestScore: Math.max(player?.bestScore ?? 0, result.score),
        })
        .then(() => {
          void usePlayersStore.getState().load()
        })
    }
  }, [lastResult, selectedSong, sessionId])

  return newHighscores
}
