import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { easing } from '../tokens'

interface SceneTransitionProps {
  sceneKey: string
  children: ReactNode
}

/**
 * Leave and arrive durations in seconds. `mode="wait"` runs them back to back,
 * so their sum (400ms) is what a Back press feels like; exit is shorter
 * because nobody watches something go.
 */
const ENTER_SECONDS = 0.26
const EXIT_SECONDS = 0.14

/** A hint of direction under the cross-fade, not a slide. */
const ENTER_OFFSET_PX = 10
const EXIT_OFFSET_PX = 6

export function SceneTransition({ sceneKey, children }: SceneTransitionProps) {
  const reduceMotion = useReducedMotion()

  return (
    /*
     * `mode="wait"`: without it the incoming scene mounts while the outgoing one
     * is still in flow, and two full-screen scenes stack. `initial={false}`
     * skips the first mount, where Boot runs its own entrance.
     */
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={sceneKey}
        data-testid="scene-transition"
        // Reflected so tests can assert the Reduce Motion branch without waiting a frame.
        data-reduced-motion={String(Boolean(reduceMotion))}
        // A column flex child of the shell, so scenes using `m-auto`, `flex-1`
        // or percentage heights lay out as if this wrapper were not here.
        className="flex w-full flex-1 flex-col"
        initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: ENTER_OFFSET_PX }}
        animate={{ opacity: 1, y: 0 }}
        // Reduce Motion: no movement and no fade, the screen just changes.
        exit={
          reduceMotion
            ? { opacity: 0, transition: { duration: 0 } }
            : { opacity: 0, y: -EXIT_OFFSET_PX, transition: { duration: EXIT_SECONDS, ease: easing.exit } }
        }
        transition={
          reduceMotion ? { duration: 0 } : { duration: ENTER_SECONDS, ease: easing.emphasized }
        }
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
