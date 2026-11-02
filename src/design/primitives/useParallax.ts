import { useEffect, useRef, type RefObject } from 'react'
import { useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from 'framer-motion'
import { springTransition } from '../tokens'
import { planeShift, pointerBias, spanBias, type ParallaxPlane, type RectLike } from './parallaxOffset'

export interface Parallax {
  /** Attach to the element whose bounds define the parallax stage. */
  ref: RefObject<HTMLDivElement | null>
  /** Raw, unsmoothed -1..1 bias. Written synchronously by the input handlers. */
  biasX: MotionValue<number>
  biasY: MotionValue<number>
  /** Spring-smoothed bias — what the depth planes consume. */
  x: MotionValue<number>
  y: MotionValue<number>
  reduceMotion: boolean
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Two-input parallax for a menu driven from a sofa: the pointer, and focus
 * moving between buttons (a gamepad sends no pointer events, so the stage
 * leans toward whatever was just focused). Writes MotionValues only, so it
 * never re-renders React. Under Reduce Motion nothing is attached and every
 * value stays at 0.
 */
export function useParallax(): Parallax {
  const reduceMotion = useReducedMotion() ?? false
  const ref = useRef<HTMLDivElement | null>(null)
  const rectRef = useRef<RectLike | null>(null)

  const biasX = useMotionValue(0)
  const biasY = useMotionValue(0)
  const x = useSpring(biasX, springTransition('tvOS', reduceMotion))
  const y = useSpring(biasY, springTransition('tvOS', reduceMotion))

  useEffect(() => {
    if (reduceMotion) return
    const stage = ref.current
    if (!stage) return

    const stageRect = (): RectLike => {
      if (!rectRef.current) {
        const { left, top, width, height } = stage.getBoundingClientRect()
        rectRef.current = { left, top, width, height }
      }
      return rectRef.current
    }

    const onPointerMove = (event: PointerEvent) => {
      const bias = pointerBias(event.clientX, event.clientY, stageRect())
      biasX.set(bias.x)
      biasY.set(bias.y)
    }

    const recentre = () => {
      biasX.set(0)
      biasY.set(0)
    }

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return

      const candidates = [...stage.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (candidates.length < 2) return recentre()

      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const candidate of candidates) {
        const rect = candidate.getBoundingClientRect()
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        minX = Math.min(minX, cx)
        maxX = Math.max(maxX, cx)
        minY = Math.min(minY, cy)
        maxY = Math.max(maxY, cy)
      }

      // Every candidate sits on the same (uniformly translated) content
      // plane, so the plane's own parallax offset cancels out of the span --
      // the lean cannot feed back into itself.
      const rect = target.getBoundingClientRect()
      biasX.set(spanBias(rect.left + rect.width / 2, minX, maxX))
      biasY.set(spanBias(rect.top + rect.height / 2, minY, maxY))
    }

    const invalidateRect = () => {
      rectRef.current = null
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('resize', invalidateRect, { passive: true })
    stage.addEventListener('pointerleave', recentre)
    stage.addEventListener('focusin', onFocusIn)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('resize', invalidateRect)
      stage.removeEventListener('pointerleave', recentre)
      stage.removeEventListener('focusin', onFocusIn)
    }
  }, [reduceMotion, biasX, biasY])

  return { ref, biasX, biasY, x, y, reduceMotion }
}

/** Derives one depth plane's px translation from a `Parallax`. Free: pure `useTransform`, no subscription of ours. */
export function useParallaxPlane(parallax: Parallax, plane: ParallaxPlane) {
  const x = useTransform(parallax.x, (bias) => planeShift(bias, plane))
  const y = useTransform(parallax.y, (bias) => planeShift(bias, plane))
  return { x, y }
}
