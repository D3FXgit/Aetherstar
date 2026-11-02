// Tuner for one device: note name, cents-off needle, level bar, scrolling pitch
// trace and mic delay readout. The needle, bar and trace are written straight
// from a store subscription (motion values and an SVG attribute) so the
// per-frame sweep never re-renders React; only the note name and delay text
// are state, and they change only when a new sample arrives.
import { useEffect, useRef, useState } from 'react'
import { motion, useMotionValue } from 'framer-motion'
import { GlassPanel } from '../design/primitives/GlassPanel'
import { tokens } from '../design/tokens'
import { STALE_PITCH_MS, freshLatestPitch, getCaptureStream, usePitchStore } from './pitchStore'
import { hzToNoteName } from './noteName'
import { useT } from '../i18n'
import type { AudioDevice } from './types'
import type { PitchSample } from '../contracts/types'

const TRACE_POINTS = 60
const HZ_MIN = 80
const HZ_MAX = 1100

/**
 * The pitch to show right now. `latest` is never cleared by silence (see
 * CaptureStream.latest), so reading it directly freezes the tuner on the last
 * note sung; the live stream says how old it is. A capture seeded by hand
 * (tests, labs) has no stream and falls back to its summary.
 */
function currentPitch(deviceId: string, summaryLatest: PitchSample | null | undefined): PitchSample | null {
  const stream = getCaptureStream(deviceId)
  return stream ? freshLatestPitch(stream, Date.now()) : (summaryLatest ?? null)
}

interface MicCheckTunerProps {
  device: AudioDevice
}

export function MicCheckTuner({ device }: MicCheckTunerProps) {
  const needleCents = useMotionValue(0)
  const vuLevel = useMotionValue(0)
  const traceRef = useRef<SVGPolylineElement | null>(null)
  const traceHzRef = useRef<number[]>([])

  const [noteName, setNoteName] = useState<string | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const t = useT()

  useEffect(() => {
    // Silence: let go of the last note instead of holding it on screen.
    const showSilence = () => {
      needleCents.set(0)
      vuLevel.set(0)
      setNoteName(null)
    }

    // Batches stop arriving altogether when the mic goes quiet at the driver
    // level or the capture ends, so staleness is also checked on a timer.
    const staleCheck = setInterval(() => {
      if (getCaptureStream(device.id) && !currentPitch(device.id, null)) showSilence()
    }, STALE_PITCH_MS)

    const unsubscribe = usePitchStore.subscribe((state) => {
      const capture = state.activeCaptures[device.id]
      if (!capture) return
      setLatencyMs(capture.latencyMs ?? null)
      const latest = currentPitch(device.id, capture.latest)
      if (!latest) {
        showSilence()
        return
      }

      const { name, cents } = hzToNoteName(latest.hz)
      needleCents.set(Math.max(-50, Math.min(50, cents)))
      vuLevel.set(Math.max(0, Math.min(1, latest.confidence)))

      traceHzRef.current = [...traceHzRef.current, latest.hz].slice(-TRACE_POINTS)
      const points = traceHzRef.current
        .map((hz, i) => {
          const x = (i / (TRACE_POINTS - 1)) * 100
          const y = 100 - Math.max(0, Math.min(100, ((hz - HZ_MIN) / (HZ_MAX - HZ_MIN)) * 100))
          return `${x},${y}`
        })
        .join(' ')
      traceRef.current?.setAttribute('points', points)

      setNoteName((prev) => (prev === name ? prev : name))
    })

    return () => {
      clearInterval(staleCheck)
      unsubscribe()
    }
  }, [device.id, needleCents, vuLevel])

  return (
    <GlassPanel className="p-4 flex flex-col gap-3 w-64" data-testid="mic-check-tuner">
      <span className="text-base font-semibold truncate text-ink-secondary">{device.name}</span>

      <div className="text-center">
        <span data-testid="tuner-note-name" className="text-4xl font-bold tabular-nums text-ink-primary">
          {noteName ?? '--'}
        </span>
      </div>

      <div className="relative h-16 flex items-end justify-center overflow-hidden" data-testid="tuner-needle">
        <motion.div
          className="w-1 h-14 rounded-full origin-bottom"
          style={{ backgroundColor: tokens.accent.gold, rotate: needleCents }}
        />
      </div>

      <div className="h-2 rounded-full bg-surface-hover overflow-hidden" data-testid="tuner-vu-meter">
        <motion.div
          className="h-full origin-left"
          style={{ backgroundColor: tokens.accent.cyan, scaleX: vuLevel }}
        />
      </div>

      <svg data-testid="tuner-pitch-trace" viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-16">
        <polyline ref={traceRef} points="" fill="none" stroke={tokens.accent.coral} strokeWidth="2" />
      </svg>

      <p className="flex justify-center gap-2 text-sm text-ink-tertiary">
        <span>{t('micCheck.tuner.delay.label')}</span>
        <span data-testid="tuner-latency" className="tabular-nums">
          {latencyMs !== null ? `${Math.round(latencyMs)} ms` : '-- ms'}
        </span>
      </p>
    </GlassPanel>
  )
}
