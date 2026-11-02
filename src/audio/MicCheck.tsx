import { useEffect, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { DevicePicker } from './DevicePicker'
import { MicCheckTuner } from './MicCheckTuner'
import { PermissionErrorState } from './PermissionErrorState'
import { usePitchStore } from './pitchStore'
import { SceneTitleBar } from '../scenes/SceneHeader'
import { designUnitRootStyle, du } from '../scenes/designUnits'
import { tokens } from '../design/tokens'
import { useT } from '../i18n'

const CONTAINER_VARIANTS = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.04 } },
}

const ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: tokens.spring.panelEnter },
}

/**
 * The screen frame, shared by both branches below, so Back is part of the
 * screen even when mic access is denied and there is nothing else to press.
 */
function MicCheckScreen({ children }: { children: ReactNode }) {
  const t = useT()
  return (
    <motion.div
      className="flex min-h-full w-full flex-col"
      data-testid="mic-check-scene"
      style={{ ...designUnitRootStyle(), padding: `${du(52)} ${du(64)} ${du(48)}`, gap: du(40) }}
      variants={CONTAINER_VARIANTS}
      initial="hidden"
      animate="visible"
    >
      <SceneTitleBar title={t('micCheck.title')} subtitle={t('micCheck.description')} />
      {children}
    </motion.div>
  )
}

export function MicCheck() {
  const permissionStatus = usePitchStore((state) => state.permissionStatus)
  const devices = usePitchStore((state) => state.devices)
  const activeCaptures = usePitchStore((state) => state.activeCaptures)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    const unsubscribe = usePitchStore.getState().subscribeToEvents()
    usePitchStore
      .getState()
      .requestPermission()
      .then(() => usePitchStore.getState().refreshDevices())
    return unsubscribe
  }, [])

  if (permissionStatus === 'denied' || permissionStatus === 'restricted') {
    return (
      <MicCheckScreen>
        <div className="flex flex-1 items-center justify-center">
          <PermissionErrorState />
        </div>
      </MicCheckScreen>
    )
  }

  const activeDeviceIds = Object.keys(activeCaptures)

  return (
    // Entrance only. The tuners are driven by live pitch data, and animating
    // their contents would fight that readout.
    <MicCheckScreen>
      <div className="flex flex-1 flex-col items-center justify-center" style={{ gap: du(28) }}>
        <motion.div variants={reduceMotion ? undefined : ITEM_VARIANTS}>
          <DevicePicker />
        </motion.div>
        {activeDeviceIds.length > 0 && (
          <motion.div
            className="flex flex-wrap justify-center"
            style={{ gap: du(20) }}
            data-testid="mic-check-tuners"
            variants={reduceMotion ? undefined : ITEM_VARIANTS}
          >
            {activeDeviceIds.map((deviceId) => {
              const device = devices.find((d) => d.id === deviceId)
              if (!device) return null
              return <MicCheckTuner key={deviceId} device={device} />
            })}
          </motion.div>
        )}
      </div>
    </MicCheckScreen>
  )
}
