import { useReducedMotion } from 'framer-motion'
import { VuMeter } from '../audio/vu/VuMeter'
import { useCaptureLevel } from '../audio/vu/useCaptureLevel'
import { useT } from '../i18n'

interface SlotLevelMeterProps {
  /** The mic slot's device, or null for a mic with no input configured. */
  deviceId: string | null
  channelIndex: number
  /** The microphone's name, used to name the meter: "Mic 3 input level". */
  label: string
}

/**
 * One row's live input meter.
 *
 * This exists as its own component purely to own the subscription. A live
 * capture pushes a level tens of times a second, and a full matrix has eight
 * of them: if `useCaptureLevel` were called from MicMatrix, every frame of
 * every input would re-render all eight rows, their sixteen `<select>`s and
 * their buttons. Called from here, a level change re-renders one meter and
 * nothing above it -- so the cost stays proportional to what actually moved.
 *
 * The meter itself is the shared DOM `VuMeter`: a single `<div>` whose width is
 * written directly (no animation library), which is cheaper per update than a
 * canvas would be here -- eight canvases means eight 2D contexts and a
 * per-frame clear-and-repaint each, to draw a rectangle CSS already draws for
 * free, and it would lose the meter's `role="meter"` semantics to a bitmap.
 *
 * Keep the `useCaptureLevel` call in this file. Hoisting it into the matrix is
 * the regression `MicMatrix.test.tsx`'s render-count test guards.
 */
export function SlotLevelMeter({ deviceId, channelIndex, label }: SlotLevelMeterProps) {
  const t = useT()
  const rms = useCaptureLevel(deviceId, channelIndex)
  const reduceMotion = useReducedMotion()

  return <VuMeter rms={rms} label={t('mic.matrix.level.label', { mic: label })} reducedMotion={reduceMotion ?? false} />
}
