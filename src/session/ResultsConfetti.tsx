// Beat 2 of the results choreography: the celebratory burst that fires the
// instant the crown lands.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useReducedMotion } from 'framer-motion'
import { CONFETTI_COUNT, createConfetti, type ConfettiPiece } from './confetti'
import { BEAT_DURATIONS } from './resultsChoreography'

interface ResultsConfettiProps {
  /** Armed by the crown landing. Going false tears the burst down immediately (see the skip path). */
  active: boolean
  /** Overridable for tests and for a denser/sparser burst; never scales with score or player count. */
  count?: number
  /** One design unit in px. The piece count is a hard cap; only each piece's size and travel scale with the screen. */
  scale?: number
}

/**
 * A one-shot burst driven by one shared CSS keyframe (`aeConfetti`, src/index.css):
 * no canvas, no rAF loop, nothing on the main thread, which carries the audio
 * engine. It unmounts itself once the last piece has fallen, or at once on skip,
 * so a results screen left open all night holds no confetti layers.
 */
export function ResultsConfetti({ active, count = CONFETTI_COUNT, scale = 1 }: ResultsConfettiProps) {
  const reduceMotion = useReducedMotion()
  const [spent, setSpent] = useState(false)
  const pieces = useMemo(() => createConfetti(count), [count])

  const running = active && !spent && !reduceMotion

  useEffect(() => {
    if (!running) return
    const timer = setTimeout(() => setSpent(true), BEAT_DURATIONS.confettiLifetimeMs)
    return () => clearTimeout(timer)
  }, [running])

  if (!running) return null

  return (
    <div
      data-testid="results-confetti"
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0 overflow-visible"
    >
      {pieces.map((piece) => (
        <span key={piece.id} style={pieceStyle(piece, scale)} />
      ))}
    </div>
  )
}

function pieceStyle(p: ConfettiPiece, scale: number): CSSProperties {
  return {
    position: 'absolute',
    left: `${p.xPercent}%`,
    top: `${p.yPercent}%`,
    width: `${p.widthPx * scale}px`,
    height: `${p.heightPx * scale}px`,
    // A 2px radius rather than a circle: rectangles read as paper, and the
    // rotation in the keyframe is only legible on a shape that has an
    // orientation to begin with.
    borderRadius: '2px',
    background: `oklch(0.80 0.19 ${p.hue})`,
    willChange: 'transform, opacity',
    animationName: 'aeConfetti',
    animationDuration: `${p.durationSec}s`,
    animationDelay: `${p.delaySec}s`,
    // Decelerating: the pieces are thrown, then gravity and air take over.
    animationTimingFunction: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
    animationIterationCount: 1,
    animationFillMode: 'forwards',
    ['--ae-confetti-x' as string]: `${p.driftXPx * scale}px`,
    ['--ae-confetti-y' as string]: `${p.fallYPx * scale}px`,
    ['--ae-confetti-spin' as string]: `${p.spinDeg}deg`,
  }
}
