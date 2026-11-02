import { useEffect, useRef, type MutableRefObject } from 'react'
import { motion, type MotionValue } from 'framer-motion'
import { tokens } from '../../design/tokens'
import { forceCompositeLayer } from './forceCompositeLayer'
import { PLAYHEAD_OFFSET_PERCENT } from './LanePanel'

/**
 * The one thing the frame loop is allowed to tell this layer, beyond its Y.
 *
 * A setter and not a prop, for the same reason `LaneSustainFx` uses one: this
 * is decided inside `Gameplay`'s `useAnimationFrame`, and a prop would be a
 * React render of the most frame-critical subtree in the app every time a
 * singer crossed the tolerance band. The setter is a no-op when the value has
 * not changed, so a held note costs nothing after its first frame -- the write
 * happens a handful of times per note, not sixty times a second.
 */
export interface PitchLineHandle {
  /** True while the singer is inside the tolerance band on the note under the playhead. */
  setOnPitch(onPitch: boolean): void
}

interface PitchLineProps {
  /** Vertical (Y) position in px, updated imperatively every rAF frame -- never React state. */
  y: number | MotionValue<number>
  /** Defaults to the cyan accent (single-player behavior, unchanged); a per-player color for multiplayer. */
  color?: string
  /** Filled in at mount with this layer's imperative handle, when a caller wants to drive the on-pitch state. */
  handle?: MutableRefObject<PitchLineHandle | null>
  /**
   * A paged lane's moving playhead (see LanePagingContext's `playheadX`), as a
   * translate for a full-width layer. Given, the rule ends at the playhead
   * wherever it is across the lane; omitted, it ends at the fixed
   * PLAYHEAD_OFFSET_PERCENT of the scrolling lane, exactly as before.
   */
  x?: MotionValue<string>
}

/**
 * The live pitch indicator: a thin rule from the field's left edge to the
 * playhead, ending in an arrowhead, plus a short fading **lead** over the note
 * under the playhead -- a note is judged over its whole span, so "am I on
 * *this* pill?" is the one comparison the singer needs drawn. Short and fading:
 * an aim, not a claim.
 *
 * Its Y is written every frame as a compositor-only `transform` (never `top`,
 * which would dirty layout for every pill in the lane). The arrowhead and lead
 * ride the same layer; the on-pitch state is a data attribute written only when
 * it flips. `translateZ(0)`/`willChange` are spent only on this and NoteLane's
 * strip -- the two things that move every frame.
 */

/**
 * Line thickness. Thin enough to read as a rule, thick enough to survive a busy
 * video frame.
 *
 * Exported because the caller positions the rule by its *top* edge (it is a
 * `translateY`), and "dead-centre on the note bar" -- what the snap in
 * pitchSmoothing.ts promises -- is only true if the caller takes half of this
 * back off.
 */
export const PITCH_LINE_HEIGHT_PX = 2

/** Arrowhead half-height; its length is 1.5x this, which is the proportion the reference draws. */
const ARROW_HALF_PX = 6

/**
 * How far past the playhead the lead reaches, as a share of the rule's own
 * width (so ~12% of the lane).
 *
 * Sized off what it has to reach rather than by eye: at PX_PER_BEAT = 24 this
 * is roughly six beats of chart, which covers the remainder of the note under
 * the playhead for any note length a chart realistically uses, and stops well
 * before the next note but one.
 */
const LEAD_WIDTH_PERCENT = 34

export function PitchLine({ y, color = tokens.accent.cyan, handle, x }: PitchLineProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  /** Last value written, so an unchanged frame touches no DOM. */
  const lastRef = useRef<boolean | null>(null)

  useEffect(() => {
    if (!handle) return
    const element = rootRef.current
    if (!element) return

    handle.current = {
      setOnPitch(onPitch) {
        if (onPitch === lastRef.current) return
        lastRef.current = onPitch
        element.dataset.onPitch = onPitch ? 'true' : 'false'
      },
    }

    const ref = handle
    return () => {
      ref.current = null
      lastRef.current = null
    }
  }, [handle])

  // Paged: the rule is a whole lane wide and hangs off the left edge of a
  // full-width layer that rides the playhead, so it always ends at "now". The
  // lead keeps the same share of the *lane* it has on the scrolling lane.
  const leadWidthPercent = x ? (LEAD_WIDTH_PERCENT * PLAYHEAD_OFFSET_PERCENT) / 100 : LEAD_WIDTH_PERCENT

  const rule = (
    <motion.div
      ref={rootRef}
      data-testid="pitch-line"
      data-on-pitch="false"
      className="ae-pitch-line absolute rounded-full"
      transformTemplate={forceCompositeLayer}
      style={{
        left: x ? '-100%' : 0,
        top: 0,
        // Runs from the field's left edge up to the playhead. Past it, only the
        // short lead below -- which is a child, so it costs no second write.
        width: x ? '100%' : `${PLAYHEAD_OFFSET_PERCENT}%`,
        height: `${PITCH_LINE_HEIGHT_PX}px`,
        y,
        willChange: 'transform',
        background: color,
        ['--ae-pitch-color' as string]: color,
      }}
    >
      {/* The lead: the same rule, continuing over the pill under the playhead
          and fading out. Drawn *behind* the arrowhead so the tip still names
          "now" cleanly. */}
      <span
        data-testid="pitch-line-lead"
        aria-hidden
        className="ae-pitch-lead absolute"
        style={{ left: '100%', top: 0, width: `${leadWidthPercent}%`, height: '100%' }}
      />
      {/* The tip. A bordered zero-size box -- the cheapest triangle there is --
          parented to the line so it inherits the same single transform. */}
      <span
        data-testid="pitch-line-arrow"
        aria-hidden
        className="ae-pitch-arrow absolute block h-0 w-0"
        style={{
          left: '100%',
          top: '50%',
          marginTop: `${-ARROW_HALF_PX}px`,
          borderLeft: `${Math.round(ARROW_HALF_PX * 1.5)}px solid ${color}`,
          borderTop: `${ARROW_HALF_PX}px solid transparent`,
          borderBottom: `${ARROW_HALF_PX}px solid transparent`,
        }}
      />
    </motion.div>
  )

  if (!x) return rule

  return (
    <motion.div data-testid="pitch-line-track" aria-hidden className="pointer-events-none absolute inset-0" style={{ x }}>
      {rule}
    </motion.div>
  )
}
