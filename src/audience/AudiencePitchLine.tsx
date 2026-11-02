import { useEffect, useRef } from 'react'
import { useAnimationFrame, useMotionValue, type MotionValue } from 'framer-motion'
import { PitchLine, PITCH_LINE_HEIGHT_PX } from '../game/lane/PitchLine'
import { lerpTowards } from '../game/lane/pitchSmoothing'
import type { PitchRangeScale } from '../game/lane/pitchRangeScale'

/**
 * One singer's live pitch rule, on the television.
 *
 * The host's real `PitchLine`, not a lookalike -- the same rule, the same
 * arrowhead, the same lead over the pill under the playhead -- fed the same way
 * it is fed on the host: a MotionValue glided toward a target every animation
 * frame, so nothing here re-renders to move.
 *
 * The only difference is where the target comes from. On the host it is written
 * by the judging loop from a live microphone; here it arrives over the
 * broadcast as a semitone (see ./pitchMirror.ts) and is mapped through *this*
 * window's lane geometry -- every frame, so a paged lane's scale (whose window
 * changes when the page flips) moves the rule with the notes. The glide is the
 * host's own `lerpTowards`, which is what makes a target that updates about ten
 * times a second read as a rule moving continuously rather than stepping.
 *
 * `data-on-pitch` is deliberately never set. That state comes from a judgement
 * this window does not make, and a rule that hardened at the wrong moment would
 * be worse than one that never hardens.
 */
export function AudiencePitchLine({
  semitone,
  scale,
  trackHeightPx,
  noteHeightPx,
  color,
  x,
}: {
  /** The host's display semitone, or null when this singer is not making a pitch. */
  semitone: number | null
  scale: PitchRangeScale
  trackHeightPx: number
  noteHeightPx: number
  color: string
  /** A paged lane's moving playhead (see LanePagingContext). */
  x?: MotionValue<string>
}) {
  /**
   * Where a note of pitch `p` is drawn through its middle -- the identical
   * calculation `Gameplay` makes, because the rule has to sit on the centre
   * line of the pill it is being compared against, not on its top edge.
   */
  const centreY = (value: number) => scale.toY(value, trackHeightPx) + noteHeightPx / 2 - PITCH_LINE_HEIGHT_PX / 2

  const y = useMotionValue(centreY(semitone ?? scale.min))
  const lastFrameAtRef = useRef(0)
  /** Everything the frame loop maps through, kept current without re-subscribing it. */
  const latestRef = useRef({ semitone, centreY })
  useEffect(() => {
    latestRef.current = { semitone, centreY }
  })

  useAnimationFrame((now) => {
    const frameMs = lastFrameAtRef.current === 0 ? 0 : now - lastFrameAtRef.current
    lastFrameAtRef.current = now
    const { semitone: target, centreY: toY } = latestRef.current
    if (target === null) return
    // Frame-rate independent, exactly as on the host: a 60Hz television and a
    // 120Hz panel glide at the same speed in wall-clock terms.
    if (frameMs > 0) y.set(lerpTowards(y.get(), toY(target), frameMs))
  })

  // No pitch, no rule. Hiding it rather than parking it at the bottom of the
  // lane, which would read as someone singing very flat.
  if (semitone === null) return null

  return <PitchLine y={y} color={color} x={x} />
}
