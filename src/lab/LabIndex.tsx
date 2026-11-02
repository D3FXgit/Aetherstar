import { useEffect } from 'react'
import { GlassPanel } from '../design/primitives/GlassPanel'
import { useHitStore, usePitchStore, useScoreStore } from '../contracts/mocks/stores'
import { useSceneStore } from '../scenes/sceneStore'

const DEMO_DEVICE_ID = 'lab-mock-mic'
const DEMO_PLAYER_ID = 'lab-mock-player'
const DEMO_SCORE_SEED = {
  players: [{ playerId: DEMO_PLAYER_ID, name: 'Lab Player', score: 0, combo: 0, rank: 1 }],
  combo: 0,
  rank: [DEMO_PLAYER_ID],
}

// The Dev Lab index: live output of the mock streams, plus a link to every lab.
export function LabIndex() {
  const pitch = usePitchStore((state) => state.latest)
  const hit = useHitStore((state) => state.latest)
  const score = useScoreStore((state) => state.players[0] ?? null)

  useEffect(() => {
    usePitchStore.getState().start(DEMO_DEVICE_ID)
    useHitStore.getState().start(DEMO_PLAYER_ID)
    useScoreStore.getState().start(DEMO_SCORE_SEED)
    return () => {
      usePitchStore.getState().stop()
      useHitStore.getState().stop()
      useScoreStore.getState().stop()
    }
  }, [])

  return (
    <GlassPanel className="p-8 m-auto max-w-lg">
      <h1 className="text-2xl font-semibold text-ink-primary">Dev Lab</h1>
      <ul data-testid="lab-route-list" className="mt-4 flex flex-col gap-2 text-sm text-ink-secondary">
        <li>
          Mock pitch stream: <span data-testid="lab-pitch-value">{pitch ? `${pitch.hz.toFixed(1)} Hz` : 'waiting for data'}</span>
        </li>
        <li>
          Mock hit stream: <span data-testid="lab-hit-value">{hit ? hit.tier : 'waiting for data'}</span>
        </li>
        <li>
          Mock score state: <span data-testid="lab-score-value">{score ? `${score.name}: ${score.score}` : 'waiting for data'}</span>
        </li>
      </ul>
      <nav className="mt-4 flex flex-col gap-1" data-testid="lab-entries">
        <button
          type="button"
          className="text-left text-sm text-ink-secondary underline"
          onClick={() => useSceneStore.getState().navigate('lab-library')}
        >
          Library scan lab →
        </button>
        <button
          type="button"
          className="text-left text-sm text-ink-secondary underline"
          onClick={() => useSceneStore.getState().navigate('lab-stage')}
        >
          Stage lab →
        </button>
        <button
          type="button"
          className="text-left text-sm text-ink-secondary underline"
          onClick={() => useSceneStore.getState().navigate('lab-mic')}
        >
          Mic lab →
        </button>
        <button
          type="button"
          className="text-left text-sm text-ink-secondary underline"
          onClick={() => useSceneStore.getState().navigate('lab-audience')}
        >
          Audience lab →
        </button>
        <button
          type="button"
          className="text-left text-sm text-ink-secondary underline"
          onClick={() => useSceneStore.getState().navigate('lab-gameplay')}
        >
          Gameplay lab →
        </button>
        <button
          type="button"
          className="text-left text-sm text-ink-secondary underline"
          onClick={() => useSceneStore.getState().navigate('lab-fx')}
        >
          FX lab →
        </button>
        <button
          type="button"
          className="text-left text-sm text-ink-secondary underline"
          onClick={() => useSceneStore.getState().navigate('lab-session')}
        >
          Session lab →
        </button>
        <button
          type="button"
          className="text-left text-sm text-ink-secondary underline"
          onClick={() => useSceneStore.getState().navigate('lab-multiplayer')}
        >
          Multiplayer lab →
        </button>
        <button
          type="button"
          className="text-left text-sm text-ink-secondary underline"
          onClick={() => useSceneStore.getState().navigate('lab-calibration')}
        >
          Calibration lab →
        </button>
      </nav>
    </GlassPanel>
  )
}
