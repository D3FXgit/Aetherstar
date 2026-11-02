// /lab/gameplay: replays a recorded pitch trace against the fixture chart,
// deterministically and without a mic. The traces are bundled JSON imports,
// so nothing is fetched at runtime.
import { useEffect, useState } from 'react'
import { GlassButton } from '../design/primitives/GlassButton'
import { GlassPanel } from '../design/primitives/GlassPanel'
import { useSceneStore } from '../scenes/sceneStore'
import { useChartLoader } from '../stage/chart/useChartLoader'
import { replayPitchTrace, theoreticalMaxScore } from '../game/replayTrace'
import perfectTrace from '../../fixtures/gameplay-traces/perfect.json'
import silenceTrace from '../../fixtures/gameplay-traces/silence.json'
import type { PitchSample } from '../contracts/types'

const TRACES: Record<'perfect' | 'silence', PitchSample[]> = {
  perfect: perfectTrace as PitchSample[],
  silence: silenceTrace as PitchSample[],
}

export function LabGameplay() {
  const [fixturePath, setFixturePath] = useState<string | null>(null)
  const [selectedTrace, setSelectedTrace] = useState<'perfect' | 'silence'>('perfect')
  const [score, setScore] = useState<number | null>(null)

  useEffect(() => {
    window.api?.stage.getFixtureChartPath().then(setFixturePath)
  }, [])

  const { status, chart } = useChartLoader(fixturePath)

  function handleReplay() {
    if (!chart) return
    const result = replayPitchTrace(chart, TRACES[selectedTrace])
    setScore(Math.round((result.score / theoreticalMaxScore(result.notes)) * 100))
  }

  return (
    <GlassPanel className="p-8 m-auto max-w-lg flex flex-col gap-4" data-testid="lab-gameplay">
      <button type="button" className="text-sm text-ink-secondary self-start" onClick={() => useSceneStore.getState().navigate('lab')}>
        ← Back to Dev Lab
      </button>
      <h1 className="text-2xl font-semibold text-ink-primary">Gameplay lab</h1>

      <div className="flex gap-2">
        {(['perfect', 'silence'] as const).map((trace) => (
          <GlassButton
            key={trace}
            type="button"
            aria-pressed={selectedTrace === trace}
            className={`px-4 py-1.5 text-sm ${selectedTrace === trace ? 'ring-2 ring-white/40' : ''}`}
            onClick={() => setSelectedTrace(trace)}
          >
            {trace}
          </GlassButton>
        ))}
      </div>

      <GlassButton type="button" className="px-4 py-2 disabled:opacity-40" disabled={status !== 'ready'} onClick={handleReplay}>
        Replay
      </GlassButton>

      <p className="text-ink-secondary text-sm">
        Score: <span data-testid="lab-gameplay-score">{score === null ? 'Not replayed yet' : `${score}%`}</span>
      </p>
    </GlassPanel>
  )
}
