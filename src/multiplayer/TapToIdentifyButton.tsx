import { useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { GlassButton } from '../design/primitives/GlassButton'
import { NeonText } from '../design/primitives/NeonText'
import { tokens } from '../design/tokens'
import { du } from '../scenes/designUnits'
import { usePitchStore } from '../audio/pitchStore'
import { useT } from '../i18n'
// Despite its name, useTapToIdentify is a plain async function -- aliased so
// the hooks lint rule does not flag calling it from an event handler.
import { useTapToIdentify as startTapToIdentifyAttempt } from './useTapToIdentify'

/**
 * Metrics matched to the `Calibrate` button it sits beside in `MicMatrix`.
 *
 * Design units with a fixed floor (`du`'s own `1px` fallback keeps this exactly
 * today's size inside Settings, where nothing scales), so the pair stays one
 * size on a 4K panel instead of one of them doubling and the other not.
 */
const COMPACT_BUTTON_STYLE = {
  minHeight: `max(44px, ${du(44)})`,
  paddingInline: du(12),
  paddingBlock: du(4),
  fontSize: `max(12px, ${du(12)})`,
}

interface TapToIdentifyButtonProps {
  candidateDeviceIds: string[]
  onIdentified: (deviceId: string) => void
}

/**
 * Tap-to-identify with an explicit Cancel. The attempt's promise never times
 * out or rejects, so an attempt-id ref is how a resolution after Cancel is ignored.
 */
export function TapToIdentifyButton({ candidateDeviceIds, onIdentified }: TapToIdentifyButtonProps) {
  const t = useT()
  const [listening, setListening] = useState(false)
  const attemptIdRef = useRef(0)
  const reduceMotion = useReducedMotion()

  function handleStart() {
    const attemptId = ++attemptIdRef.current
    setListening(true)

    startTapToIdentifyAttempt(candidateDeviceIds).then((deviceId) => {
      if (attemptIdRef.current !== attemptId) return
      setListening(false)
      onIdentified(deviceId)
    })
  }

  function handleCancel() {
    attemptIdRef.current++
    for (const deviceId of candidateDeviceIds) {
      usePitchStore.getState().stopCapture(deviceId)
    }
    setListening(false)
  }

  if (listening) {
    return (
      <span
        className="flex items-center"
        style={{ gap: du(8), fontSize: `max(12px, ${du(12)})` }}
        data-testid="tap-to-identify"
      >
        {/* The waiting state has to look alive -- a static "Listening…" reads
            as a stuck UI while the user is deciding whether to tap the mic. */}
        <motion.span
          className="flex items-center gap-1.5"
          animate={reduceMotion ? undefined : { opacity: [1, 0.45, 1] }}
          transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}
        >
          <motion.span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: tokens.accent.cyan }}
            animate={reduceMotion ? undefined : { scale: [1, 1.6, 1] }}
            transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}
          />
          <NeonText accent="cyan">{t('mic.identify.listening')}</NeonText>
        </motion.span>
        <GlassButton type="button" onClick={handleCancel} className="shrink-0" style={COMPACT_BUTTON_STYLE}>
          {t('mic.identify.cancel')}
        </GlassButton>
      </span>
    )
  }

  return (
    <GlassButton
      type="button"
      onClick={handleStart}
      className="shrink-0"
      style={COMPACT_BUTTON_STYLE}
      data-testid="tap-to-identify"
    >
      {t('mic.identify.action')}
    </GlassButton>
  )
}
