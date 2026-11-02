import { useEffect, useRef, useState } from 'react'
import { decayPeak, vuFraction } from './levelScale'
import { tokens } from '../../design/tokens'

interface VuMeterProps {
  /** Current RMS amplitude, 0..1. */
  rms: number
  /** Accessible description of what is being metered, e.g. "P3 input level". */
  label: string
  /** Rendered without the animated peak marker; the bar itself still tracks level. */
  reducedMotion?: boolean
}

/**
 * A live input-level meter for one capture.
 *
 * Purely presentational -- it takes an RMS value and draws it, so it can be
 * fed from the pitch stream, a fixture, or a test without knowing anything
 * about capture keys or devices.
 *
 * The bar is driven by a direct style write rather than an animation library:
 * this renders once per matrix row (up to eight at a time) and updates at the
 * pitch stream's rate, so per-frame spring machinery for eight bars would cost
 * far more than the widths are worth.
 */
export function VuMeter({ rms, label, reducedMotion = false }: VuMeterProps) {
  const fraction = vuFraction(rms)
  const [peak, setPeak] = useState(fraction)
  const peakRef = useRef(fraction)
  const lastPeakAtRef = useRef(0)

  useEffect(() => {
    const now = Date.now()
    if (fraction >= peakRef.current) {
      peakRef.current = fraction
      lastPeakAtRef.current = now
      setPeak(fraction)
      return
    }

    const next = decayPeak(peakRef.current, fraction, now - lastPeakAtRef.current)
    peakRef.current = next
    setPeak(next)
  }, [fraction])

  return (
    <div
      data-testid="vu-meter"
      data-level={fraction.toFixed(3)}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      className="relative h-2 w-full overflow-hidden rounded-full bg-surface-hover"
    >
      <div
        data-testid="vu-meter-fill"
        className="h-full rounded-full"
        style={{
          width: `${fraction * 100}%`,
          // Cyan, then gold, then coral at the top of the range, so a clipping
          // input shows by colour and not only by length: the bar is short and
          // read from across a room.
          background:
            fraction > 0.92 ? tokens.accent.coral : fraction > 0.75 ? tokens.accent.gold : tokens.accent.cyan,
        }}
      />
      {!reducedMotion && peak > 0 && (
        <div
          data-testid="vu-meter-peak"
          className="absolute top-0 h-full w-[2px] bg-ink-primary"
          style={{ left: `calc(${peak * 100}% - 1px)` }}
        />
      )}
    </div>
  )
}
