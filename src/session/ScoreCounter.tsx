// Beat 5 of the results choreography: the score rolling from a zero-padded
// zero up to the real final score.
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { animate, useMotionValue } from 'framer-motion'
import { easing } from '../design/tokens'
import { countDurationMs, formatRollingScore, scorePadWidth, shouldTick } from './resultsChoreography'

interface ScoreCounterProps {
  /** The real final score. Never recomputed here -- this component only displays it. */
  score: number
  /** Beat 5 has been reached. */
  rolling: boolean
  /** Reduced motion, or the sequence was skipped: show the final number now, animate nothing. */
  immediate?: boolean
  /** One step of the roll, already throttled. Wired to the `scoreTick` one-shot by SessionResults. */
  onTick?: () => void
  /** Overridable so tests don't wait out a real roll. */
  durationMs?: number
  /**
   * Size, weight and colour from the screen that composes it (the results
   * screen sizes everything in design units). The tabular-figure settings are
   * applied regardless: they are what stop the digits shivering.
   */
  style?: CSSProperties
  /** Test id of the readout; each singer's counter on the results screen has its own. */
  testId?: string
}

/**
 * The rolling score readout.
 *
 * Driven by a framer-motion `MotionValue`, never by React state: a counter
 * updated with `setState` per frame would re-render this subtree ~60 times a
 * second for the length of the roll, on the same thread as the audio engine.
 * Instead `animate()` drives one MotionValue and a `.on('change')` subscription
 * writes the formatted string straight to the span's `textContent`. React
 * renders this component once and never again for the whole roll.
 *
 * `easing.emphasized` is the curve: it covers ~93% of the distance in the first
 * 30% of the time and then settles, which is exactly the shape of a good score
 * roll -- a burst of digits, then the last few hundred points ticking into
 * place where you can read them.
 */
export function ScoreCounter({
  score,
  rolling,
  immediate = false,
  onTick,
  durationMs,
  style,
  testId = 'results-score',
}: ScoreCounterProps) {
  const padWidth = scorePadWidth(score)
  const value = useMotionValue(0)
  const digitsRef = useRef<HTMLSpanElement>(null)
  // Held in refs, not state: the throttle must not cause a render, which is the
  // whole point of driving this off a MotionValue.
  const lastTickRef = useRef(-Infinity)
  const lastTextRef = useRef(formatRollingScore(0, padWidth))
  const onTickRef = useRef(onTick)
  onTickRef.current = onTick

  // The final value is always in the DOM as `data-final-score`, whatever the
  // animation is doing, so nothing has to wait out a roll to read the score.
  const settledText = formatRollingScore(score, padWidth)

  /**
   * The digits are written here and nowhere else.
   *
   * React must never render text into this span. The parent re-renders on every
   * beat of the celebration, and a JSX child would reset the span's textContent
   * on each of those commits -- silently wiping whatever the roll had counted
   * up to. Owning the node's text from one layout effect plus the MotionValue
   * subscription means the two never fight over it, and it is set before paint
   * so there is no frame with an empty readout.
   */
  useLayoutEffect(() => {
    const node = digitsRef.current
    if (!node) return
    lastTextRef.current = immediate ? settledText : formatRollingScore(0, padWidth)
    node.textContent = lastTextRef.current
  }, [immediate, settledText, padWidth])

  useEffect(() => {
    if (!rolling || immediate) return

    const node = digitsRef.current
    if (!node) return

    lastTickRef.current = -Infinity
    lastTextRef.current = formatRollingScore(0, padWidth)

    const unsubscribe = value.on('change', (current) => {
      const text = formatRollingScore(current, padWidth)
      if (text === lastTextRef.current) return

      const now = performance.now()
      if (shouldTick(now, lastTickRef.current, text, lastTextRef.current)) {
        lastTickRef.current = now
        onTickRef.current?.()
      }
      lastTextRef.current = text
      node.textContent = text
    })

    const controls = animate(value, score, {
      duration: (durationMs ?? countDurationMs(score)) / 1000,
      ease: easing.emphasized,
    })

    return () => {
      unsubscribe()
      controls.stop()
      value.set(0)
    }
  }, [rolling, immediate, score, padWidth, durationMs, value])

  return (
    <p
      data-testid={testId}
      data-final-score={score}
      // The digits are decoration for assistive tech: a number that changes
      // twenty times a second is noise, not information. SessionResults
      // announces the real result once, in words, in its own live region.
      aria-hidden="true"
      className="relative text-6xl font-bold leading-none text-white"
      style={{ ...style, ...TABULAR }}
    >
      {/* Deliberately childless in JSX -- see the layout effect above. */}
      <span ref={digitsRef} />
    </p>
  )
}

/**
 * Tabular figures. Proportional numerals give "1" a narrower advance width than
 * "8", so a counter running through every digit visibly shivers; `tabular-nums`
 * fixes every glyph to the same box, which is what makes a rolling readout look
 * machined rather than nervous.
 */
const TABULAR: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum"',
}
