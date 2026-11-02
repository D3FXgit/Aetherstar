// The winner's crown: an image file (resultsAssets.ts) so the artwork can be
// replaced without touching code. The box is fixed because the landing is
// aimed at it; a replacement of another shape is fitted, not stretched.
import { motion } from 'framer-motion'
import { du } from '../../scenes/designUnits'
import { easing } from '../../design/tokens'
import { CROWN_BOX_UNITS, CROWN_IMAGE_URL } from '../resultsAssets'
import { BEAT_DURATIONS } from '../resultsChoreography'

function CrownImage() {
  return (
    <img
      src={CROWN_IMAGE_URL}
      alt=""
      aria-hidden="true"
      data-testid="results-crown-image"
      style={{
        width: du(CROWN_BOX_UNITS.width),
        height: du(CROWN_BOX_UNITS.height),
        objectFit: 'contain',
        display: 'block',
      }}
    />
  )
}

/** Falls onto the badge on the crown beat; under reduced motion it is simply there. */
export function Crown({ reduceMotion }: { reduceMotion: boolean }) {
  const position = 'pointer-events-none absolute left-1/2 z-10 -translate-x-1/2'
  if (reduceMotion) {
    return (
      <div data-testid="results-crown" aria-hidden className={position} style={{ top: du(-46) }}>
        <CrownImage />
      </div>
    )
  }
  return (
    <motion.div
      data-testid="results-crown"
      aria-hidden
      className={position}
      style={{ top: du(-46) }}
      initial={{ y: -170, opacity: 0, rotate: -22, scale: 0.85 }}
      animate={{ y: 0, opacity: 1, rotate: 0, scale: 1 }}
      // `emphasized`: almost all of the fall in the first ~120ms, then a settle -- a landing.
      transition={{ duration: BEAT_DURATIONS.crownFlightMs / 1000, ease: easing.emphasized }}
    >
      <CrownImage />
    </motion.div>
  )
}
