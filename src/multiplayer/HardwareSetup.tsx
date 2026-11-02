import { motion, useReducedMotion } from 'framer-motion'
import { GlassPanel } from '../design/primitives/GlassPanel'
import { SceneTitleBar } from '../scenes/SceneHeader'
import { designUnitRootStyle, du } from '../scenes/designUnits'
import { tokens } from '../design/tokens'
import { useT } from '../i18n'
import { MicMatrix } from './MicMatrix'

/**
 * The full-screen Mic Setup scene: the same Mic 1..8 matrix Settings shows,
 * with room to breathe. A scene of its own so the mic-disconnect overlay and
 * the Dev Lab can route straight here without going through Settings.
 */
export function HardwareSetup() {
  const t = useT()
  const reduceMotion = useReducedMotion()

  return (
    // The header row leads with Back, on the same gutter as the matrix below.
    <motion.div
      className="mx-auto flex w-full flex-col"
      data-testid="hardware-setup"
      style={{ ...designUnitRootStyle(), maxWidth: du(1320), padding: `${du(52)} ${du(64)} ${du(48)}`, gap: du(32) }}
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={tokens.spring.panelEnter}
    >
      <SceneTitleBar
        title={t('mic.setup.title')}
        subtitle={
          <>
            <span className="block">{t('mic.setup.description')}</span>
            {/* The model, said once: these numbers are the hardware. Nobody owns
                Mic 3 until they pick it up at song select. */}
            <span className="mt-1 block text-ink-secondary" style={{ fontSize: `max(0.875rem, ${du(15)})` }}>
              {t('mic.setup.hint')}
            </span>
          </>
        }
      />

      <GlassPanel style={{ padding: du(16) }}>
        <MicMatrix />
      </GlassPanel>
    </motion.div>
  )
}
