import { useEffect, useRef, type MutableRefObject } from 'react'
import { motion, useReducedMotion, type MotionValue } from 'framer-motion'
import { PLAYHEAD_OFFSET_PERCENT } from '../lane/LanePanel'
import { createSustainSparks, SUSTAIN_SPARK_COUNT } from './sustainSpark'

/**
 * The one thing the rest of the app is allowed to do to this layer.
 *
 * A *setter*, not a prop: this is written from Gameplay's `useAnimationFrame`
 * loop, and a prop would mean a React render on every frame the singer's pitch
 * moved -- on the most frame-critical subtree in the app, up to eight times
 * over. Passing `null` puts the spark out.
 */
export interface SustainHandle {
  /** Lane-local Y of the note being sung, or `null` when the singer is not on one. */
  set(noteY: number | null): void
}

interface LaneSustainFxProps {
  /** Filled in at mount with this layer's imperative handle. */
  handle: MutableRefObject<SustainHandle | null>
  /** The lane's mic-slot colour, used only for the outer halo -- the burst itself is gold. */
  color: string
  /** A paged lane's moving playhead, as a translate for a full-width layer (see LanePagingContext). Omitted: the fixed scrolling-lane playhead. */
  x?: MotionValue<string>
}

/**
 * The **golden starburst at the point where the playhead crosses a note the
 * singer is actually landing** -- the reference frame's single most
 * recognisable piece of feedback, and the only one that fires *while* a note is
 * being sung rather than after it has been judged.
 *
 * That distinction is the whole reason this is a separate layer from
 * `LaneHitFx`. A hit burst is an *event*: one note, judged at its end, fired
 * once. This is a *state*: "right now, at this exact pixel, the thing you are
 * doing is working." It has to be able to turn on and off many times inside a
 * single note, so it cannot be built out of one-shot bursts.
 *
 * ## What it costs
 *
 * Exactly the same three promises `LaneHitFx` makes, kept the same three ways:
 *
 *  1. **No React render.** The layer renders once, at mount. Everything after
 *     that arrives through the `SustainHandle` above and lands as two writes on
 *     one element -- a transform and one data attribute -- issued from the rAF
 *     loop that was already running.
 *  2. **No JavaScript per frame.** The pulse and the trailing sparks are CSS
 *     keyframes on `transform`/`opacity` only, and they are declared *inside*
 *     the `[data-on='true']` selector, so nothing is animating and nothing
 *     holds a compositor layer while the spark is off -- which is most of a
 *     song, on most lanes.
 *  3. **A fixed DOM.** One layer node, one core, and `SUSTAIN_SPARK_COUNT`
 *     trailing sparks, allocated at mount and reused forever:
 *     `2 + SUSTAIN_SPARK_COUNT` nodes per lane, whatever the singer does.
 *
 * The write is skipped when the value has not changed, so a singer holding one
 * steady note costs nothing at all after the first frame of it.
 */
export function LaneSustainFx({ handle, color, x }: LaneSustainFxProps) {
  const reduceMotion = useReducedMotion() ?? false
  const rootRef = useRef<HTMLDivElement | null>(null)
  /** Last value written, so an unchanged frame touches no DOM. */
  const lastRef = useRef<number | null>(null)

  useEffect(() => {
    const element = rootRef.current
    if (!element) return

    handle.current = {
      set(noteY) {
        if (noteY === lastRef.current) return
        lastRef.current = noteY
        if (noteY === null) {
          element.dataset.on = 'false'
          return
        }
        // `translate3d` rather than `top`: `top` is layout-affecting, and this
        // sits inside the lane alongside forty mounted note pills. Same rule,
        // and same reason, as PitchLine.
        element.style.transform = `translate3d(0, ${noteY}px, 0)`
        element.dataset.on = 'true'
      },
    }

    const ref = handle
    return () => {
      ref.current = null
      lastRef.current = null
    }
  }, [handle])

  const spark = (
    <div
      ref={rootRef}
      data-testid="lane-sustain-fx"
      data-on="false"
      data-static={reduceMotion ? 'true' : 'false'}
      aria-hidden="true"
      className="ae-sustain pointer-events-none absolute"
      style={{
        left: x ? 0 : `${PLAYHEAD_OFFSET_PERCENT}%`,
        top: 0,
        ['--ae-sustain-halo' as string]: color,
      }}
    >
      <span data-testid="lane-sustain-core" className="ae-sustain-core" />
      {createSustainSparks().map((spark) => (
        <span
          key={spark.id}
          data-testid="lane-sustain-spark"
          className="ae-sustain-spark"
          style={{
            width: `${spark.sizePx}px`,
            height: `${spark.sizePx}px`,
            margin: `${-spark.sizePx / 2}px`,
            animationDelay: `${spark.delayMs}ms`,
            ['--ae-sustain-dx' as string]: `${spark.dxPx}px`,
            ['--ae-sustain-dy' as string]: `${spark.dyPx}px`,
          }}
        />
      ))}
    </div>
  )

  if (!x) return spark

  // Paged: rides a full-width layer translated to the playhead, so the spark
  // stays where the playhead crosses the note however far across the line it is.
  return (
    <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ x }}>
      {spark}
    </motion.div>
  )
}

export { SUSTAIN_SPARK_COUNT }
