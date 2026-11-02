import { useEffect, useMemo, useState } from 'react'
import { logSongLoad, logSongLoadError } from '../diagnostics/log'
import { GlassErrorState } from '../design/primitives/GlassErrorState'
import { useT } from '../i18n'
import { SongLoadingScreen } from '../session/SongLoadingScreen'
import { resolveMediaPath } from '../stage/media/resolveMediaPath'
import { Stage } from '../stage/Stage'
import { usePauseStore } from '../stage/pause/pauseStore'
import { useChartLoader } from '../stage/chart/useChartLoader'
import { MultiplayerGameplay } from '../multiplayer/MultiplayerGameplay'
import { useCalibrationStore } from '../calibration/calibrationStore'
import { clampCalibrationOffsetMs } from '../calibration/offsets'

interface SingProps {
  /** The song to load. Omitted, the bundled fixture chart is used (Dev Lab). */
  chartPath?: string
  assignedPlayerIds?: string[]
  onSongEnded?: () => void
}

export function Sing({ chartPath, assignedPlayerIds, onSongEnded }: SingProps = {}) {
  const t = useT()
  const [fixturePath, setFixturePath] = useState<string | null>(null)
  // Restart from the pause menu remounts the stage: fresh media, clock and lanes.
  const restartToken = usePauseStore((state) => state.restartToken)

  useEffect(() => {
    logSongLoad('sing:mount', { chartPath: chartPath ?? null, assignedPlayerIds: assignedPlayerIds ?? null })
  }, [chartPath, assignedPlayerIds])

  useEffect(() => {
    if (chartPath) return
    // Both a missing preload surface and a rejected request are contained here
    // rather than escaping as an unhandled rejection no boundary can see.
    const request = window.api?.stage?.getFixtureChartPath?.()
    if (!request) {
      logSongLoadError('sing:fixture-path', new Error('window.api.stage.getFixtureChartPath is unavailable'))
      return
    }
    request.then(setFixturePath).catch((error: unknown) => {
      logSongLoadError('sing:fixture-path', error)
    })
  }, [chartPath])

  const { status, chart: loadedChart, sourceDir, error } = useChartLoader(chartPath ?? fixturePath)
  // Clamped again where applied: a corrupt or legacy value must never move
  // #GAP by more than the calibration bound (offsets.ts).
  const outputOffsetMs = useCalibrationStore((state) => clampCalibrationOffsetMs(state.settings.outputOffsetMs))

  // The output-latency offset is folded into #GAP once, here, so the stage
  // clock and the judging clock (the same beat position) both pick it up.
  const chart = useMemo(() => {
    if (!loadedChart) return loadedChart
    if (outputOffsetMs === 0) return loadedChart
    return { ...loadedChart, meta: { ...loadedChart.meta, gap: loadedChart.meta.gap + outputOffsetMs } }
  }, [loadedChart, outputOffsetMs])

  // Logged from an effect so the trace has one line per real state change.
  useEffect(() => {
    if (status === 'error') {
      logSongLoadError('sing:chart-load', new Error(error ?? 'unknown'), { chartPath: chartPath ?? fixturePath })
      return
    }
    logSongLoad('sing:chart-status', {
      status,
      sourceDir,
      outputOffsetMs,
      title: chart?.meta.title ?? null,
      lineCount: chart?.lines.length ?? null,
    })
  }, [status, error, sourceDir, chart, outputOffsetMs, chartPath, fixturePath])

  if (status === 'ready' && chart && sourceDir) {
    return (
      <Stage
        key={restartToken}
        chart={chart}
        sourceDir={sourceDir}
        onEnded={onSongEnded}
        // Always mounted: gameplay starts the captures its lanes read and
        // reports mic health in each singer's own lane.
        overlay={(clock) => (
          <MultiplayerGameplay
            meta={chart.meta}
            lines={chart.lines}
            beatPosition={clock.beatPosition}
            assignedPlayerIds={assignedPlayerIds}
          />
        )}
      />
    )
  }

  if (status === 'error') {
    return (
      <GlassErrorState
        title={t('sing.loadError.title')}
        message={t('sing.loadError.message', { error: error ?? '' })}
        actionLabel={onSongEnded ? t('sing.loadError.action') : undefined}
        onAction={onSongEnded}
      />
    )
  }

  return (
    <SongLoadingScreen
      title={chart?.meta.title ?? t('sing.loading.title')}
      artist={chart?.meta.artist}
      coverUrl={chart?.meta.coverPath && sourceDir ? resolveMediaPath(sourceDir, chart.meta.coverPath) ?? undefined : undefined}
    />
  )
}
