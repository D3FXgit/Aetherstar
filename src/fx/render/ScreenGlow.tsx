import { AnimatePresence, motion } from 'framer-motion'

interface ScreenGlowProps {
  active: boolean
  color: string
}

/**
 * Screen-edge glow burst in CSS rather than a WebGL post-process pass, so it
 * costs nothing against the particle-rendering budget.
 */
export function ScreenGlow({ active, color }: ScreenGlowProps) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          data-testid="screen-glow"
          className="absolute inset-0 pointer-events-none"
          style={{ boxShadow: `inset 0 0 180px 40px ${color}` }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          exit={{ opacity: 0 }}
        />
      )}
    </AnimatePresence>
  )
}
