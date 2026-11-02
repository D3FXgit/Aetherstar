import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { GlassButton } from '../design/primitives/GlassButton'
import { GlassPanel } from '../design/primitives/GlassPanel'
import { GlassDial } from '../design/primitives/GlassDial'
import { tokens } from '../design/tokens'
import { useT } from '../i18n'
import type { AudioContextLike } from '../fx/audio/sfxEngine'
import { OutputLatencyStep } from './OutputLatencyStep'
import { InputLatencyStep } from './InputLatencyStep'
import { DifficultyStep } from './DifficultyStep'
import { TranspositionStep } from './TranspositionStep'
import { useCalibrationStore } from './calibrationStore'
import type { Difficulty } from './types'
import type { CalibrationClocks } from './clickScheduler'
import { clampCalibrationOffsetMs, micOffsetFromMeasurement } from './offsets'

type WizardPhase = 'output' | 'input' | 'difficulty' | 'transposition' | 'done'

interface CalibrationWizardProps {
  audioContext: AudioContextLike
  clickBuffer: unknown
  deviceId: string
  playerId: string
  fixtureNotePitches: number[]
  beatCount?: number
  intervalSec?: number
  /** Injectable clocks for the latency steps (tests). */
  clocks?: CalibrationClocks
}

/**
 * The guided flow: speaker delay, mic delay, difficulty, vocal range. The
 * assembled result is saved through calibrationStore's per-device and
 * per-player setters.
 */
export function CalibrationWizard({
  audioContext,
  clickBuffer,
  deviceId,
  playerId,
  fixtureNotePitches,
  beatCount,
  intervalSec,
  clocks,
}: CalibrationWizardProps) {
  const [phase, setPhase] = useState<WizardPhase>('output')
  const [outputOffsetMs, setOutputOffsetMs] = useState<number | null>(null)
  const [inputOffsetMs, setInputOffsetMs] = useState<number | null>(null)
  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const [transpositionSemitones, setTranspositionSemitones] = useState(0)
  const reduceMotion = useReducedMotion()
  const t = useT()

  const setOutputOffset = useCalibrationStore((state) => state.setOutputOffset)
  const setInputDeviceOffset = useCalibrationStore((state) => state.setInputDeviceOffset)
  const setPlayerCalibration = useCalibrationStore((state) => state.setPlayerCalibration)

  async function handleApply() {
    if (outputOffsetMs !== null) await setOutputOffset(outputOffsetMs)
    if (inputOffsetMs !== null) await setInputDeviceOffset(deviceId, inputOffsetMs)
    await setPlayerCalibration(playerId, { difficulty, transpositionSemitones })
    setPhase('done')
  }

  function handleRerun() {
    setOutputOffsetMs(null)
    setInputOffsetMs(null)
    setPhase('output')
  }

  async function handleReset() {
    await setInputDeviceOffset(deviceId, 0)
    await setPlayerCalibration(playerId, { difficulty: 'normal', transpositionSemitones: 0 })
    await setOutputOffset(0)
    setOutputOffsetMs(null)
    setInputOffsetMs(null)
    setDifficulty('normal')
    setTranspositionSemitones(0)
    setPhase('output')
  }

  return (
    <GlassPanel className="p-8 flex flex-col gap-4" data-testid="calibration-wizard">
      {outputOffsetMs !== null && inputOffsetMs !== null && (
        <motion.div
          className="flex gap-4 justify-center"
          data-testid="calibration-dials"
          initial={reduceMotion ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={tokens.spring.panelEnter}
        >
          <GlassDial label={t('calibration.output.title')} value={outputOffsetMs} min={0} max={300} unit="ms" />
          <GlassDial label={t('calibration.input.title')} value={inputOffsetMs} min={0} max={300} unit="ms" />
        </motion.div>
      )}

      {/* One keyed wrapper per phase, so advancing the wizard slides the new
          step in instead of hard-cutting. Deliberately not AnimatePresence:
          the outgoing step must unmount at once, or two steps' controls
          (two "Start" buttons) would be addressable at the same time. */}
      <motion.div
        key={phase}
        className="flex flex-col gap-4"
        initial={reduceMotion ? false : { opacity: 0, x: 18 }}
        animate={{ opacity: 1, x: 0 }}
        transition={tokens.spring.sceneTransition}
      >
      {phase === 'output' && (
        <OutputLatencyStep
          audioContext={audioContext}
          clickBuffer={clickBuffer}
          beatCount={beatCount}
          intervalSec={intervalSec}
          clocks={clocks}
          onComplete={(ms) => {
            setOutputOffsetMs(clampCalibrationOffsetMs(ms))
            setPhase('input')
          }}
        />
      )}

      {phase === 'input' && (
        <InputLatencyStep
          audioContext={audioContext}
          clickBuffer={clickBuffer}
          deviceId={deviceId}
          beatCount={beatCount}
          intervalSec={intervalSec}
          clocks={clocks}
          onComplete={(ms) => {
            setInputOffsetMs(micOffsetFromMeasurement(ms, outputOffsetMs ?? 0))
            setPhase('difficulty')
          }}
        />
      )}

      {phase === 'difficulty' && (
        <>
          <DifficultyStep value={difficulty} onChange={setDifficulty} />
          <GlassButton type="button" variant="primary" onClick={() => setPhase('transposition')}>
            {t('calibration.next')}
          </GlassButton>
        </>
      )}

      {phase === 'transposition' && (
        <>
          <TranspositionStep
            deviceId={deviceId}
            fixtureNotePitches={fixtureNotePitches}
            value={transpositionSemitones}
            onChange={setTranspositionSemitones}
          />
          <GlassButton type="button" variant="primary" sfx="confirm" onClick={handleApply}>
            {t('calibration.apply')}
          </GlassButton>
        </>
      )}

      {phase === 'done' && (
        <div className="flex flex-col gap-3 items-center" data-testid="calibration-wizard-done">
          <p className="text-lg text-ink-primary">{t('calibration.done')}</p>
          <div className="flex gap-3">
            <GlassButton type="button" onClick={handleRerun}>
              {t('calibration.rerun')}
            </GlassButton>
            <GlassButton type="button" onClick={handleReset}>
              {t('calibration.reset')}
            </GlassButton>
          </div>
        </div>
      )}
      </motion.div>
    </GlassPanel>
  )
}
