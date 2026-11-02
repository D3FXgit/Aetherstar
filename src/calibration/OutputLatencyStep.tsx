import { useCallback, useEffect, useRef, useState } from 'react'
import { GlassButton } from '../design/primitives/GlassButton'
import { GlassPanel } from '../design/primitives/GlassPanel'
import type { AudioContextLike } from '../fx/audio/sfxEngine'
import { scheduleClicks, type CalibrationClocks } from './clickScheduler'
import { averageOffsetMs } from './measureLatency'
import { useT } from '../i18n'

const DEFAULT_BEAT_COUNT = 8
const DEFAULT_INTERVAL_SEC = 0.5

interface OutputLatencyStepProps {
  audioContext: AudioContextLike
  clickBuffer: unknown
  onComplete: (outputOffsetMs: number) => void
  beatCount?: number
  intervalSec?: number
  /** Injectable clock for tap timestamps. Defaults to performance.now(). Click
   * times are converted onto this same timeline by scheduleClicks (the
   * AudioContext clock has its own origin, at context creation). */
  now?: () => number
  /** Injectable clocks for scheduleClicks; tests pass these with `now`. */
  clocks?: CalibrationClocks
}

/**
 * Measures speaker delay (output latency) with a tap-along test: the player
 * taps a key on each of `beatCount` scheduled clicks, and the mean offset
 * between each click's commanded time and its paired tap is the estimate.
 */
export function OutputLatencyStep({
  audioContext,
  clickBuffer,
  onComplete,
  beatCount = DEFAULT_BEAT_COUNT,
  intervalSec = DEFAULT_INTERVAL_SEC,
  now = () => performance.now(),
  clocks,
}: OutputLatencyStepProps) {
  const [running, setRunning] = useState(false)
  const [tapsCollected, setTapsCollected] = useState(0)
  const commandedTimesRef = useRef<number[]>([])
  const tapTimesRef = useRef<number[]>([])
  const t = useT()

  const handleKeyDown = useCallback(() => {
    tapTimesRef.current.push(now())
    setTapsCollected(tapTimesRef.current.length)
  }, [now])

  useEffect(() => {
    if (!running) return
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [running, handleKeyDown])

  useEffect(() => {
    if (!running || tapsCollected < beatCount) return
    const offset = averageOffsetMs(commandedTimesRef.current, tapTimesRef.current)
    setRunning(false)
    onComplete(offset)
  }, [running, tapsCollected, beatCount, onComplete])

  function handleStart() {
    tapTimesRef.current = []
    setTapsCollected(0)
    commandedTimesRef.current = scheduleClicks({ audioContext, clickBuffer, count: beatCount, intervalSec, clocks }).perfMs
    setRunning(true)
  }

  return (
    <GlassPanel className="p-8 flex flex-col gap-4 items-center" data-testid="output-latency-step">
      <h2 className="text-2xl font-semibold text-ink-primary">{t('calibration.output.title')}</h2>
      <p className="text-base text-ink-secondary text-center">{t('calibration.output.description')}</p>
      <GlassButton type="button" variant="primary" onClick={handleStart} disabled={running}>
        {t('calibration.start')}
      </GlassButton>
      <p className="text-sm tabular-nums text-ink-tertiary" data-testid="output-latency-progress">
        {t('calibration.progress', { done: tapsCollected, total: beatCount })}
      </p>
    </GlassPanel>
  )
}
