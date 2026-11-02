// /lab/calibration: runs the full Calibration Wizard with a fake AudioContext,
// a mock device and player, and the fixture chart's pitch range.
import { useEffect, useMemo, useState } from 'react'
import { GlassPanel } from '../design/primitives/GlassPanel'
import { useSceneStore } from '../scenes/sceneStore'
import { useChartLoader } from '../stage/chart/useChartLoader'
import { flattenNotes } from '../game/matching/flattenNotes'
import { CalibrationWizard } from '../calibration/CalibrationWizard'
import type { AudioContextLike } from '../fx/audio/sfxEngine'

const LAB_DEVICE_ID = 'lab-mock-mic'
const LAB_PLAYER_ID = 'lab-mock-player'
const LAB_BEAT_COUNT = 2
// Comfortably wider than detectTapTimestamps' default 200ms refractory window,
// so two lab-driven taps in quick succession don't collide.
const LAB_INTERVAL_SEC = 0.3

function createFakeAudioContext(): AudioContextLike {
  return {
    currentTime: 0,
    createBufferSource: () => ({ buffer: null, connect: () => {}, start: () => {} }),
    createGain: () => ({ gain: { value: 1 }, connect: () => {} }),
    decodeAudioData: () => Promise.resolve({}),
    destination: {},
  }
}

export function LabCalibration() {
  const [fixturePath, setFixturePath] = useState<string | null>(null)

  useEffect(() => {
    window.api?.stage.getFixtureChartPath().then(setFixturePath)
  }, [])

  const { chart } = useChartLoader(fixturePath)
  const fixtureNotePitches = useMemo(() => (chart ? flattenNotes(chart.lines).map((note) => note.pitch) : []), [chart])
  const audioContext = useMemo(() => createFakeAudioContext(), [])

  return (
    <GlassPanel className="p-8 m-auto max-w-lg flex flex-col gap-4" data-testid="lab-calibration">
      <button
        type="button"
        className="text-sm text-ink-secondary self-start"
        onClick={() => useSceneStore.getState().navigate('lab')}
      >
        ← Back to Dev Lab
      </button>
      <h1 className="text-2xl font-semibold text-ink-primary">Calibration lab</h1>
      {fixtureNotePitches.length === 0 && (
        <p className="text-ink-tertiary text-xs">
          Fixture chart still loading, so the key suggestion is off until it arrives. Speaker and mic delay work
          regardless.
        </p>
      )}
      <CalibrationWizard
        audioContext={audioContext}
        clickBuffer={{}}
        deviceId={LAB_DEVICE_ID}
        playerId={LAB_PLAYER_ID}
        fixtureNotePitches={fixtureNotePitches}
        beatCount={LAB_BEAT_COUNT}
        intervalSec={LAB_INTERVAL_SEC}
      />
    </GlassPanel>
  )
}
