import { useEffect, useState, type CSSProperties } from 'react'

/**
 * The design unit full-screen surfaces are measured in. Layouts are drawn at
 * 1920x1080; `--u` is 1px there and scales with the more constrained axis, so
 * a 4K television gets the same proportions instead of a small stamp in the
 * middle. Clamped so a small window stays legible and 8K is not a poster.
 */
export const SCENE_DESIGN_UNIT = 'clamp(0.62px, min(100vw / 1920, 100vh / 1080), 2.4px)'

const DESIGN_UNIT_MIN_PX = 0.62
const DESIGN_UNIT_MAX_PX = 2.4
const DESIGN_WIDTH = 1920
const DESIGN_HEIGHT = 1080

/**
 * `n` 1080p pixels, in design units. The `1px` fallback matters: without it
 * a missing `--u` makes the declaration invalid and it is silently dropped.
 */
export function du(n: number): string {
  return `calc(${n} * var(--u, 1px))`
}

/** The style that defines `--u` on a screen's root; `du()` below it needs this. */
export function designUnitRootStyle(): CSSProperties {
  return { ['--u' as string]: SCENE_DESIGN_UNIT }
}

/**
 * One design unit in px for a viewport: `SCENE_DESIGN_UNIT` evaluated in JS,
 * for sizes that must be numbers. Kept beside the CSS so a test can compare them.
 */
export function designUnitScale(viewportWidth: number, viewportHeight: number): number {
  const fitted = Math.min(viewportWidth / DESIGN_WIDTH, viewportHeight / DESIGN_HEIGHT)
  return Math.min(Math.max(fitted, DESIGN_UNIT_MIN_PX), DESIGN_UNIT_MAX_PX)
}

/** `designUnitScale` for the live window, recomputed on resize (never per frame). Prefer `--u` in CSS. */
export function useDesignScale(): number {
  const [scale, setScale] = useState(() => currentScale())

  useEffect(() => {
    const onResize = () => setScale(currentScale())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return scale
}

function currentScale(): number {
  if (typeof window === 'undefined') return 1
  return designUnitScale(window.innerWidth, window.innerHeight)
}

/**
 * Back, sized in design units for a scaling screen. Each `max()` keeps it at
 * least 3.5rem tall (above the 44pt minimum) in a small window.
 */
export const SCENE_BACK_BUTTON_STYLE: CSSProperties = {
  height: `max(3.5rem, ${du(56)})`,
  paddingInline: `max(1.5rem, ${du(24)})`,
  fontSize: `max(1rem, ${du(17)})`,
  gap: `max(0.5rem, ${du(8)})`,
}
