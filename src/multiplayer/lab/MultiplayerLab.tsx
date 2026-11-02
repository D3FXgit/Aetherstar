import { useEffect, useState } from 'react'
import { useMotionValue } from 'framer-motion'
import { GlassPanel } from '../../design/primitives/GlassPanel'
import { useSceneStore } from '../../scenes/sceneStore'
import { useChartLoader } from '../../stage/chart/useChartLoader'
import { MicMatrix } from '../MicMatrix'
import { MultiplayerGameplay } from '../MultiplayerGameplay'
import * as api from '../api'

const CPU_POLL_INTERVAL_MS = 1000

/**
 * `/lab/multiplayer`: the routing matrix and a live composed gameplay preview
 * against the fixture chart, plus the main process's CPU-headroom readout
 *.
 */
export function MultiplayerLab() {
  const [fixturePath, setFixturePath] = useState<string | null>(null)
  const [cpuPercent, setCpuPercent] = useState<number | null>(null)
  const beatPosition = useMotionValue(0)

  useEffect(() => {
    window.api?.stage.getFixtureChartPath().then(setFixturePath)
  }, [])

  useEffect(() => {
    let cancelled = false
    function poll() {
      api.getCpuUsage().then((result) => {
        if (!cancelled) setCpuPercent(result.percent)
      })
    }
    poll()
    const interval = setInterval(poll, CPU_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const { status, chart } = useChartLoader(fixturePath)

  return (
    <GlassPanel className="p-8 m-auto max-w-4xl flex flex-col gap-4" data-testid="multiplayer-lab">
      <button
        type="button"
        className="text-sm text-white/60 self-start"
        onClick={() => useSceneStore.getState().navigate('lab')}
      >
        ← Back to Dev Lab
      </button>
      <h1 className="text-2xl font-semibold text-white">Multiplayer Lab</h1>

      <p className="text-white/70 text-sm">
        CPU headroom: <span data-testid="cpu-usage">{cpuPercent === null ? '—' : `${Math.round(cpuPercent)}%`}</span>
      </p>

      <MicMatrix />

      {status === 'ready' && chart && (
        // Tall enough for the real singer-view layout (lane + score cards +
        // status row) to lay itself out inside the lab panel.
        <div className="relative mt-8 min-h-[640px]">
          <MultiplayerGameplay meta={chart.meta} lines={chart.lines} beatPosition={beatPosition} />
        </div>
      )}
    </GlassPanel>
  )
}
