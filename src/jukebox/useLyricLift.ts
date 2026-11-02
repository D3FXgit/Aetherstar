// Keeps the lyrics clear of the transport bar: while the bar is up, the stage's
// song card + lyrics layer is lifted by exactly as much as the two would
// overlap (published as a CSS variable the stage's `chromeStyle` reads), and
// drops back when it hides. Measured, not guessed, so it holds from a small
// window to a 4K television, and for one-box and duet lyrics alike.
import { useEffect, type CSSProperties, type RefObject } from 'react'

export const LYRIC_LIFT_VAR = '--jukebox-lyric-lift'

/** Space kept between the bottom of the lyrics and the top of the bar. */
export const LYRIC_CLEARANCE_PX = 16

/** How often the overlap is re-measured while the bar is up (lines change, songs load). */
const MEASURE_INTERVAL_MS = 500

const LYRICS_SELECTOR = '[data-testid="lyric-box"], [data-testid="clock-lyrics"]'
const TRANSPORT_SELECTOR = '[data-testid="jukebox-transport"]'

/** Lift the stage's chrome layer by the variable, eased; instant under reduced motion. */
export function lyricLiftStyle(reducedMotion: boolean): CSSProperties {
  return {
    translate: `0 calc(-1 * var(${LYRIC_LIFT_VAR}, 0px))`,
    transition: reducedMotion ? undefined : 'translate 420ms cubic-bezier(0.16, 1, 0.3, 1)',
  }
}

/**
 * How far to lift the lyrics so their bottom sits `LYRIC_CLEARANCE_PX` above
 * the bar. Positions are in the scene's own coordinates, before any lift.
 */
export function lyricLiftPx({
  lyricsBottom,
  sceneHeight,
  transportHeight,
}: {
  lyricsBottom: number
  sceneHeight: number
  transportHeight: number
}): number {
  const transportTop = sceneHeight - transportHeight
  return Math.max(0, Math.ceil(lyricsBottom + LYRIC_CLEARANCE_PX - transportTop))
}

/**
 * Bottom edge of `element` in `ancestor`'s coordinates, from offsets -- which
 * ignore transforms, so the lift being applied (or mid-animation) never feeds
 * back into its own measurement.
 */
function untransformedBottom(element: HTMLElement, ancestor: HTMLElement): number {
  let top = 0
  let node: HTMLElement | null = element
  while (node && node !== ancestor) {
    top += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  return top + element.offsetHeight
}

export function useLyricLift(sceneRef: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const apply = (px: number) => {
      const value = `${px}px`
      if (scene.style.getPropertyValue(LYRIC_LIFT_VAR) !== value) scene.style.setProperty(LYRIC_LIFT_VAR, value)
    }
    if (!active) {
      apply(0)
      return
    }

    const measure = () => {
      const transport = scene.querySelector<HTMLElement>(TRANSPORT_SELECTOR)
      const lyrics = Array.from(scene.querySelectorAll<HTMLElement>(LYRICS_SELECTOR))
      if (!transport || lyrics.length === 0) {
        apply(0)
        return
      }
      const lyricsBottom = Math.max(...lyrics.map((element) => untransformedBottom(element, scene)))
      apply(lyricLiftPx({ lyricsBottom, sceneHeight: scene.clientHeight, transportHeight: transport.offsetHeight }))
    }

    measure()
    const interval = setInterval(measure, MEASURE_INTERVAL_MS)
    window.addEventListener('resize', measure)
    return () => {
      clearInterval(interval)
      window.removeEventListener('resize', measure)
    }
  }, [sceneRef, active])
}
