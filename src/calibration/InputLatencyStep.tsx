import { useEffect, useRef, useState } from 'react'
import { GlassButton } from '../design/primitives/GlassButton'
import { GlassPanel } from '../design/primitives/GlassPanel'
import type { AudioContextLike } from '../fx/audio/sfxEngine'
import { usePitchStore } from '../audio/pitchStore'
import { useT } from '../i18n'
import { scheduleClicks, type CalibrationClocks } from './clickScheduler'
import { detectTapTimestamps } from './detectTapTimestamps'
import { averageOffsetMs } from './measureLatency'

const DEFAULT_BEAT_COUNT = 8
const DEFAULT_INTERVAL_SEC = 0.5

interface InputLatencyStepProps {
  audioContext: AudioContextLike
  clickBuffer: unknown
  deviceId: string
  onComplete: (inputOffsetMs: number) => void
  beatCount?: number
  intervalSec?: number
  /** Injectable clocks for scheduleClicks (tests). */
  clocks?: CalibrationClocks
}

/**
 * Measures mic delay (the capture chain's latency): plays a click track and
 * asks the player to say "tap" into their mic on each click. Taps are read
 * from the existing PitchSample stream.
 */
export function InputLatencyStep({
  audioContext,
  clickBuffer,
  deviceId,
  onComplete,
  beatCount = DEFAULT_BEAT_COUNT,
  intervalSec = DEFAULT_INTERVAL_SEC,
  clocks,
}: InputLatencyStepProps) {
  const [running, setRunning] = useState(false)
  const [tapsDetected, setTapsDetected] = useState(0)
  const commandedTimesRef = useRef<number[]>([])
  const startedAtRef = useRef(0)
  const t = useT()

  useEffect(() => {
    if (!running) return

    return usePitchStore.subscribe((state) => {
      const capture = state.activeCaptures[deviceId]
      if (!capture) return

      // PitchSample.t is the frame's window-centre capture time in epoch ms,
      // and the capture buffer still holds whatever the mic heard before
      // Start was pressed; only what follows the first click can be a tap.
      const startedAt = startedAtRef.current
      const taps = detectTapTimestamps(capture.samples.filter((sample) => sample.t >= startedAt))
      setTapsDetected(taps.length)

      if (taps.length >= beatCount) {
        const offset = averageOffsetMs(commandedTimesRef.current, taps.slice(0, beatCount))
        setRunning(false)
        onComplete(offset)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-subscribe only on running/deviceId/beatCount changes, onComplete identity doesn't matter here
  }, [running, deviceId, beatCount])

  function handleStart() {
    setTapsDetected(0)
    const clicks = scheduleClicks({ audioContext, clickBuffer, count: beatCount, intervalSec, clocks })
    commandedTimesRef.current = clicks.wallMs
    startedAtRef.current = clicks.wallStartMs
    setRunning(true)
  }

  return (
    <GlassPanel className="p-8 flex flex-col gap-4 items-center" data-testid="input-latency-step">
      <h2 className="text-2xl font-semibold text-ink-primary">{t('calibration.input.title')}</h2>
      <p className="text-base text-ink-secondary text-center">{t('calibration.input.description')}</p>
      <GlassButton type="button" variant="primary" onClick={handleStart} disabled={running}>
        {t('calibration.start')}
      </GlassButton>
      <p className="text-sm tabular-nums text-ink-tertiary" data-testid="input-latency-progress">
        {t('calibration.progress', { done: tapsDetected, total: beatCount })}
      </p>
    </GlassPanel>
  )
}
