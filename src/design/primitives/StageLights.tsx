import type { CSSProperties } from 'react'
import { useReducedMotion } from 'framer-motion'
import { tokens } from '../tokens'

interface Beam {
  /** Horizontal anchor along the top edge, in % of the container. */
  left: number
  color: string
  /** Sway range and period; staggered so the beams never line up. */
  from: number
  to: number
  durationS: number
  delayS: number
  opacity: number
}

const BEAMS: readonly Beam[] = [
  { left: 18, color: tokens.accent.magenta, from: -14, to: 6, durationS: 17, delayS: 0, opacity: 0.22 },
  { left: 52, color: tokens.accent.cyan, from: 9, to: -9, durationS: 23, delayS: -6, opacity: 0.16 },
  { left: 84, color: tokens.accent.coral, from: 12, to: -6, durationS: 19, delayS: -11, opacity: 0.2 },
]

/**
 * The menu's ambient backdrop: three soft stage-light beams swaying slowly
 * from the top edge. Pure CSS (src/styles/animations.css); each beam is
 * painted once and only its transform animates. Under Reduce Motion the beams
 * stay, still, at the middle of their swing.
 */
export function StageLights({ className = '' }: { className?: string }) {
  const reduceMotion = useReducedMotion() ?? false

  return (
    <div
      aria-hidden="true"
      data-testid="stage-lights"
      data-animated={String(!reduceMotion)}
      className={`ae-stage-lights pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {BEAMS.map((beam) => (
        <div
          key={beam.left}
          className="ae-stage-beam"
          style={
            {
              left: `${beam.left}%`,
              opacity: beam.opacity,
              background: `radial-gradient(50% 100% at 50% 0%, ${beam.color} 0%, transparent 72%)`,
              '--ae-beam-from': `${beam.from}deg`,
              '--ae-beam-to': `${beam.to}deg`,
              '--ae-beam-rest': `${(beam.from + beam.to) / 2}deg`,
              '--ae-beam-duration': `${beam.durationS}s`,
              '--ae-beam-delay': `${beam.delayS}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}
