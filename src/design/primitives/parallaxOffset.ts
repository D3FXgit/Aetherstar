/**
 * Pure geometry for the menu parallax. Kept apart from the hook because jsdom
 * has no layout, so the maths can only be tested with hand-made rectangles.
 */

export interface Bias {
  x: number
  y: number
}

export interface RectLike {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Peak translation in CSS px per depth plane at full deflection. Amplitude
 * falls toward the viewer on purpose: the background carries the depth cue
 * and the reading surface (title and buttons) barely moves.
 */
export const PARALLAX_PLANE_PX = {
  /** The colour wash, furthest back. */
  glow: 28,
  /** The stage lights, between the wash and the content. */
  lights: 16,
  /** Title, subtitle and buttons. */
  content: 4,
} as const

export type ParallaxPlane = keyof typeof PARALLAX_PLANE_PX

/**
 * Constrains a bias to the -1..1 envelope, collapsing NaN to a neutral 0.
 *
 * The NaN case is not theoretical: a pointer event can arrive before first
 * layout, when the container still measures 0x0, and a single NaN written to
 * a MotionValue poisons that layer's `transform` for the life of the scene.
 */
export function clampBias(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.max(-1, Math.min(1, value))
}

/** Normalises a viewport-space pointer position to -1..1 within `rect`. */
export function pointerBias(clientX: number, clientY: number, rect: RectLike): Bias {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  return {
    x: clampBias(((clientX - rect.left) / rect.width) * 2 - 1),
    y: clampBias(((clientY - rect.top) / rect.height) * 2 - 1),
  }
}

/**
 * Normalises a focused control's centre against the *span of the focusable
 * controls*, not against the whole screen.
 *
 * For gamepad input: buttons a few percent of the screen apart would barely
 * deflect against the screen, but against each other they swing the full range.
 */
export function spanBias(center: number, min: number, max: number): number {
  if (!(max > min)) return 0
  return clampBias(((center - min) / (max - min)) * 2 - 1)
}

/**
 * Converts a -1..1 bias into a plane's translation in px.
 *
 * Negative: layers slide *against* the input, the way a scene viewed through
 * a window slides opposite to the viewer's head. That is the cue that sells
 * "there is space behind this menu".
 */
export function planeShift(bias: number, plane: ParallaxPlane): number {
  const shift = -clampBias(bias) * PARALLAX_PLANE_PX[plane]
  // Normalise -0 to 0: it reaches a `transform` as "-0px", and it makes
  // "the plane is at rest" awkward to assert.
  return shift === 0 ? 0 : shift
}
