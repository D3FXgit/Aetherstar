// The 'calibration' scene: glue between the device and player stores, the
// bundled fixture chart's pitch range, a real AudioContext with a synthesized
// click, and the wizard.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { GlassPanel } from '../design/primitives/GlassPanel'
import { SceneTitleBar } from '../scenes/SceneHeader'
import { designUnitRootStyle, du } from '../scenes/designUnits'
import { tokens } from '../design/tokens'
import { useT } from '../i18n'
import { DevicePicker } from '../audio/DevicePicker'
import { usePitchStore } from '../audio/pitchStore'
import { usePlayersStore } from '../players/store'
import { useChartLoader } from '../stage/chart/useChartLoader'
import { flattenNotes } from '../game/matching/flattenNotes'
import { CalibrationWizard } from './CalibrationWizard'
import { useCalibrationStore } from './calibrationStore'
import type { AudioContextLike } from '../fx/audio/sfxEngine'

const CLICK_DURATION_SEC = 0.05
const CLICK_FREQUENCY_HZ = 1000
const CLICK_DECAY_RATE = 40

function createClickBuffer(audioContext: AudioContext): AudioBuffer {
  const sampleRate = audioContext.sampleRate
  const length = Math.floor(CLICK_DURATION_SEC * sampleRate)
  const buffer = audioContext.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    data[i] = Math.sin(2 * Math.PI * CLICK_FREQUENCY_HZ * t) * Math.exp(-t * CLICK_DECAY_RATE)
  }
  return buffer
}

export function CalibrationScene() {
  const devices = usePitchStore((state) => state.devices)
  const activeCaptures = usePitchStore((state) => state.activeCaptures)
  const players = usePlayersStore((state) => state.players)
  const reduceMotion = useReducedMotion()
  const t = useT()

  useEffect(() => {
    const unsubscribe = usePitchStore.getState().subscribeToEvents()
    usePitchStore
      .getState()
      .requestPermission()
      .then(() => usePitchStore.getState().refreshDevices())
    usePlayersStore.getState().load()
    return unsubscribe
  }, [])

  const [fixturePath, setFixturePath] = useState<string | null>(null)
  useEffect(() => {
    window.api?.stage.getFixtureChartPath().then(setFixturePath)
  }, [])
  const { chart } = useChartLoader(fixturePath)
  const fixtureNotePitches = useMemo(() => (chart ? flattenNotes(chart.lines).map((note) => note.pitch) : []), [chart])

  const realAudioContext = useMemo(() => new AudioContext(), [])
  const clickBuffer = useMemo(() => createClickBuffer(realAudioContext), [realAudioContext])
  // AudioContextLike's property-typed `connect` methods are checked contravariantly
  // (strictFunctionTypes), so a real AudioContext's more-specific DOM signatures
  // never structurally satisfy it. It is satisfied at runtime, just not provably
  // so for a deliberately minimal, test-friendly interface.
  const audioContext = realAudioContext as unknown as AudioContextLike

  // A caller (the Mic 1..8 matrix) can name exactly which input to calibrate;
  // with no target the scene falls back to the first running capture and the
  // first player.
  const target = useCalibrationStore((state) => state.target)
  const deviceId = target?.deviceId ?? Object.keys(activeCaptures)[0]
  const player = players.find((p) => p.id === target?.playerId) ?? players[0]

  // The input-latency step listens on activeCaptures[deviceId], so a targeted
  // input has to be running before the wizard can hear anything -- arriving
  // from the matrix must not require the user to also go start the capture.
  useEffect(() => {
    if (target && !activeCaptures[target.deviceId]) {
      usePitchStore.getState().startCapture(target.deviceId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the target itself changes; activeCaptures churns every batch
  }, [target])

  // Both branches share the same screen frame, so Back is always part of the
  // screen. That matters most on the setup branch, which can be reached with
  // no mic and no player, i.e. with nothing else on it to press.
  const screen = (children: ReactNode) => (
    <motion.div
      className="flex min-h-full w-full flex-col"
      data-testid="calibration-scene"
      style={{ ...designUnitRootStyle(), padding: `${du(52)} ${du(64)} ${du(48)}`, gap: du(40) }}
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={tokens.spring.panelEnter}
    >
      <SceneTitleBar title={t('calibration.title')} subtitle={t('calibration.description')} />
      <div className="flex flex-1 items-center justify-center">{children}</div>
    </motion.div>
  )

  if (!deviceId || !player || fixtureNotePitches.length === 0) {
    return screen(
      <GlassPanel
        className="flex flex-col text-center"
        style={{ padding: du(32), maxWidth: du(520), gap: du(16) }}
        data-testid="calibration-scene-setup"
      >
        <p className="text-base text-ink-secondary">{t('calibration.setup.description')}</p>
        <DevicePicker />
        {devices.length === 0 && <p className="text-sm text-ink-tertiary">{t('calibration.setup.noMics')}</p>}
        {players.length === 0 && <p className="text-sm text-ink-tertiary">{t('calibration.setup.noPlayers')}</p>}
      </GlassPanel>,
    )
  }

  return screen(
    <CalibrationWizard
      audioContext={audioContext}
      clickBuffer={clickBuffer}
      deviceId={deviceId}
      playerId={player.id}
      fixtureNotePitches={fixtureNotePitches}
    />,
  )
}
