import { useReducedMotion } from 'framer-motion'
import { tokens } from './tokens'

/**
 * The one press/hover feel for every pressable thing in the app: a barely
 * visible lift on hover, a firm dip on press. Focus is shown by the outline
 * ring (src/styles/base.css), not by motion.
 */
export const PRESS_SCALE = { hover: 1.02, tap: 0.97 } as const

/** framer-motion props for a `motion.button` (or any motion element) that should feel pressable. */
export const pressMotion = {
  whileHover: { scale: PRESS_SCALE.hover },
  whileTap: { scale: PRESS_SCALE.tap },
  transition: { type: 'spring', ...tokens.spring.press },
} as const

/** `pressMotion`, or nothing at all when the viewer asked for reduced motion. Spread onto a motion element. */
export function usePressMotion(): Partial<typeof pressMotion> {
  const reduceMotion = useReducedMotion()
  return reduceMotion ? {} : pressMotion
}

/**
 * The same feel for plain elements, in CSS: hover lift, press dip, colour
 * transitions. `motion-reduce:` drops the scale but keeps the colour change.
 */
export const PRESS_CLASS =
  'transition-[scale,background-color,border-color,color] duration-150 ease-out hover:scale-[1.02] active:scale-[0.97] motion-reduce:hover:scale-100 motion-reduce:active:scale-100'
