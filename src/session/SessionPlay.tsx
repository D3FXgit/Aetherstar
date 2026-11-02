// The `play` phase: sings the selected song, reports live scores to the
// audience window, and records the result once the song ends.
import { useEffect, useMemo } from 'react'
import { logSongLoad } from '../diagnostics/log'
import { GlassPanel } from '../design/primitives/GlassPanel'
import { useT } from '../i18n'
import { Sing } from '../scenes/Sing'
import { usePauseStore } from '../stage/pause/pauseStore'
import { useChartLoader } from '../stage/chart/useChartLoader'
import { useSessionStore } from './sessionStore'
import { EMPTY_TALLIES, useSessionScoreReporting } from './useSessionScoreReporting'
import { useScoreStore } from '../game/state/useScoreStore'
import { EMPTY_LINE_TALLY } from '../game/types'
import { setGameplayActive } from '../library/api'
import type { SongLine } from '../contracts/types'

const NO_LINES: SongLine[] = []

export function SessionPlay() {
  const selectedSong = useSessionStore((state) => state.selectedSong)
  const assignedPlayerIds = useSessionStore((state) => state.assignedPlayerIds)
  const finishSong = useSessionStore((state) => state.finishSong)
  const restartToken = usePauseStore((state) => state.restartToken)
  const t = useT()

  // The same chart Sing loads (served from useChartLoader's cache); only its
  // lines are needed here, for the best-line tally.
  const { chart } = useChartLoader(selectedSong?.path ?? null)
  // Stable per chart, because useSessionScoreReporting resets its tallies
  // whenever `lines` changes identity -- which is exactly what a restart from
  // the pause menu wants, so the restart token mints a fresh array.
  const lines = useMemo(() => {
    const source = chart?.lines ?? NO_LINES
    return restartToken === 0 ? source : source.slice()
  }, [chart, restartToken])

  // The first step of the song-load trace: what the session actually handed
  // downstream. `selectedSong.path` is the song *folder*, not the .txt --
  // app-media:// resolves the chart inside it (electron/protocols.cjs).
  useEffect(() => {
    logSongLoad('session:play-mount', {
      selectedSongPath: selectedSong?.path ?? null,
      selectedSongTitle: selectedSong?.title ?? null,
      assignedPlayerIds,
      assignedPlayerCount: assignedPlayerIds.length,
    })
  }, [selectedSong, assignedPlayerIds])
  // The line-up is passed along because a singer's note ids are numbered
  // within their own lane's lines (see laneParts.ts), and their place in it is
  // their lane.
  const talliesByPlayer = useSessionScoreReporting(lines, assignedPlayerIds)

  // Background library work (scans, loudness analysis, device polling) waits
  // while a song is sung, so it cannot steal time from pitch detection or audio.
  useEffect(() => {
    setGameplayActive(true)
    return () => {
      setGameplayActive(false)
      // Leaving the song, however it happens, leaves nothing paused behind.
      usePauseStore.getState().reset()
    }
  }, [])

  function handleSongEnded() {
    if (assignedPlayerIds.length === 0) return
    const { players: scorePlayers, lineTallyByPlayerId } = useScoreStore.getState()
    const results = assignedPlayerIds.map((playerId) => {
      const score = scorePlayers.find((p) => p.playerId === playerId)?.score ?? 0
      const tallies = talliesByPlayer[playerId] ?? EMPTY_TALLIES
      return {
        playerId,
        score,
        epicCount: tallies.epicCount,
        goodCount: tallies.goodCount,
        awfulCount: tallies.awfulCount,
        // Nothing scored, nothing to quote.
        bestLine: score > 0 ? tallies.bestLine : null,
        lineCounts: lineTallyByPlayerId[playerId] ?? EMPTY_LINE_TALLY,
      }
    })
    finishSong(results)
  }

  if (!selectedSong) {
    return (
      <GlassPanel className="p-12 m-auto max-w-md text-center">
        <p className="text-ink-secondary">{t('sing.noSong')}</p>
      </GlassPanel>
    )
  }

  return <Sing chartPath={selectedSong.path} assignedPlayerIds={assignedPlayerIds} onSongEnded={handleSongEnded} />
}
