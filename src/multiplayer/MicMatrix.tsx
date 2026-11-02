import { useEffect, type CSSProperties } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { GlassButton } from '../design/primitives/GlassButton'
import { micColor, tokens } from '../design/tokens'
import { usePitchStore } from '../audio/pitchStore'
import { useT } from '../i18n'
import { useCalibrationStore } from '../calibration/calibrationStore'
import { useScene } from '../scenes/useScene'
import { du } from '../scenes/designUnits'
import { useMicSlotStore } from './store'
import { captureKeyOfSlot } from './captureKey'
import { channelLabels } from './channelLabels'
import { conflictsByMicNumber, micLabel } from './slots'
import { SlotLevelMeter } from './SlotLevelMeter'
import { TapToIdentifyButton } from './TapToIdentifyButton'
import type { AudioDevice } from '../audio/types'
import type { MicSlot } from './types'

/**
 * One column template for the header and every row, so the controls line up
 * down the matrix. In design units (`du`): the full-screen Mic Setup scales
 * with the display, while inside Settings `du()`'s 1px fallback keeps the
 * numbers unscaled -- one component, correct in both places.
 */
const COLUMNS = `minmax(${du(76)},0.5fr) minmax(${du(180)},1.6fr) minmax(${du(116)},0.8fr) minmax(${du(110)},1fr) auto`

/**
 * Every control is at least 44px tall: this matrix is driven from a sofa with a
 * gamepad. `max()` so design-unit scaling can only make the target bigger.
 */
const CONTROL_CLASS =
  'rounded-xl border border-line bg-surface-raised text-ink-primary disabled:text-ink-tertiary disabled:cursor-not-allowed'

const CONTROL_STYLE: CSSProperties = {
  minHeight: `max(44px, ${du(44)})`,
  paddingInline: du(12),
  fontSize: `max(0.875rem, ${du(14)})`,
}

const HEADER_CLASS = 'font-semibold text-ink-secondary'
const HEADER_STYLE: CSSProperties = { fontSize: `max(13px, ${du(14)})` }

const ROW_VARIANTS = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: tokens.spring.panelEnter },
}

interface MicSlotRowProps {
  slot: MicSlot
  devices: AudioDevice[]
  conflictsWith: number[]
  reduceMotion: boolean
}

function MicSlotRow({ slot, devices, conflictsWith, reduceMotion }: MicSlotRowProps) {
  const t = useT()
  const { navigate } = useScene()
  const label = micLabel(slot.slotNumber)
  const device = slot.deviceId === null ? undefined : devices.find((candidate) => candidate.id === slot.deviceId)
  // 0 for "no device chosen": distinct from a mono device's 1, so the channel
  // control shows a dash rather than claim a Mono input that isn't there.
  const channelCount = device?.channelCount ?? 0
  const labels = channelLabels(channelCount)

  return (
    <motion.li
      data-testid={`mic-slot-row-${slot.slotNumber}`}
      className="grid items-center rounded-2xl"
      style={{ gridTemplateColumns: COLUMNS, gap: du(12), paddingInline: du(12), paddingBlock: du(8) }}
      variants={reduceMotion ? undefined : ROW_VARIANTS}
      initial={reduceMotion ? false : 'hidden'}
      animate={reduceMotion ? undefined : 'visible'}
    >
      {/* The mic number is the identity, read as text. The mic's colour is a
          rule beside it and nothing more: it must never be the only thing
          telling two rows apart. */}
      <div className="flex min-w-0 items-center" style={{ gap: du(12) }}>
        <span
          aria-hidden
          className="shrink-0 rounded-full"
          style={{ height: du(36), width: du(5), background: micColor(slot.slotNumber) }}
        />
        <span
          className="font-semibold leading-none tabular-nums text-ink-primary"
          style={{ fontSize: `max(17px, ${du(18)})` }}
        >
          {label}
        </span>
      </div>

      <div className="flex min-w-0 flex-col" style={{ gap: du(4) }}>
        <select
          data-testid={`mic-device-select-${slot.slotNumber}`}
          aria-label={t('mic.matrix.device.label', { mic: label })}
          className={`${CONTROL_CLASS} w-full`}
          style={CONTROL_STYLE}
          value={slot.deviceId ?? ''}
          onChange={(event) => {
            const deviceId = event.target.value
            const count = devices.find((candidate) => candidate.id === deviceId)?.channelCount ?? 1
            useMicSlotStore.getState().setSlotDevice(slot.slotNumber, deviceId === '' ? null : deviceId, count)
          }}
        >
          <option value="">{t('mic.matrix.noInput')}</option>
          {devices.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
        {/* Two mics on one physical input hear each other. Say which mic, in
            words -- a tinted row would leave a colour-blind user with no way
            to know. */}
        {conflictsWith.length > 0 && (
          <span data-testid={`mic-conflict-${slot.slotNumber}`} style={{ color: tokens.accent.gold, fontSize: `max(13px, ${du(14)})` }}>
            {t('mic.matrix.conflict', { mics: conflictsWith.map(micLabel).join(', ') })}
          </span>
        )}
      </div>

      {/* Rendered on every row even when there is nothing to choose, so the
          column never collapses and the rows stay aligned. */}
      <select
        data-testid={`mic-channel-select-${slot.slotNumber}`}
        aria-label={t('mic.matrix.channel.label', { mic: label })}
        className={`${CONTROL_CLASS} w-full`}
        style={CONTROL_STYLE}
        disabled={labels.length < 2}
        value={slot.channelIndex}
        onChange={(event) => useMicSlotStore.getState().setSlotChannel(slot.slotNumber, Number(event.target.value))}
      >
        {labels.length === 0 ? (
          <option value={0}>–</option>
        ) : (
          labels.map((channelName, index) => (
            // Keyed by position: the names are translated (and can repeat), the index is the channel.
            <option key={index} value={index}>
              {channelName}
            </option>
          ))
        )}
      </select>

      <SlotLevelMeter deviceId={slot.deviceId} channelIndex={slot.channelIndex} label={label} />

      <div className="flex items-center" style={{ gap: du(8) }}>
        <TapToIdentifyButton
          candidateDeviceIds={devices.map((candidate) => candidate.id)}
          onIdentified={(deviceId) => {
            const count = devices.find((candidate) => candidate.id === deviceId)?.channelCount ?? 1
            useMicSlotStore.getState().setSlotDevice(slot.slotNumber, deviceId, count)
          }}
        />
        <GlassButton
          type="button"
          data-testid={`mic-calibrate-${slot.slotNumber}`}
          aria-label={t('mic.matrix.calibrate.label', { mic: label })}
          className="shrink-0"
          style={{
            minHeight: `max(44px, ${du(44)})`,
            paddingInline: du(16),
            paddingBlock: du(6),
            fontSize: `max(14px, ${du(14)})`,
          }}
          disabled={slot.deviceId === null}
          onClick={() => {
            const captureKey = captureKeyOfSlot(slot)
            if (captureKey === null) return
            // Calibration is stored per physical input, so a mic slot is
            // exactly the right thing to calibrate: the offset belongs to the
            // cable, not to whoever holds it, so no playerId is passed.
            useCalibrationStore.getState().setTarget({ playerId: '', deviceId: captureKey })
            navigate('calibration')
          }}
        >
          {t('mic.matrix.calibrate.action')}
        </GlassButton>
      </div>
    </motion.li>
  )
}

/**
 * The Mic 1..Mic 8 hardware matrix.
 *
 * Eight rows, always: these are the rig's physical inputs, and a row is present
 * whether or not anything is plugged into it. That is the whole point of the
 * screen -- a mic slot is a pre-calibrated input waiting to be claimed on the
 * Player Selection screen, not a statement about a person, so there is nothing
 * about the roster for the row count to depend on.
 *
 * Live meters run only while this component is mounted: it holds a named
 * capture claim on the store (see `acquireCaptures`) and drops it on unmount,
 * so leaving Settings does not leave eight native audio streams open for the
 * rest of the session.
 */
export function MicMatrix() {
  const t = useT()
  const slots = useMicSlotStore((state) => state.slots)
  const devices = usePitchStore((state) => state.devices)
  const reduceMotion = useReducedMotion() ?? false

  useEffect(() => {
    useMicSlotStore.getState().load()
  }, [])

  // Devices are hot-plugged right before a party starts, so re-enumerate on
  // arrival rather than trusting whatever Boot happened to see.
  useEffect(() => {
    const unsubscribe = usePitchStore.getState().subscribeToEvents()
    usePitchStore.getState().refreshDevices()
    return unsubscribe
  }, [])

  // A meter needs a running capture, and a running capture costs a native
  // thread -- so the claim is scoped to exactly the time this matrix is on
  // screen, and only the *configured* slots ever get one.
  useEffect(() => {
    const store = useMicSlotStore.getState()
    store.acquireCaptures('mic-matrix')
    return () => {
      store.releaseCaptures('mic-matrix')
    }
  }, [])

  const conflicts = conflictsByMicNumber(slots)

  return (
    <div className="flex w-full flex-col" style={{ gap: du(8) }} data-testid="mic-matrix">
      {devices.length === 0 && (
        <p
          className="leading-snug text-ink-secondary"
          style={{ paddingInline: du(12), paddingBottom: du(4), fontSize: `max(14px, ${du(15)})` }}
          data-testid="mic-matrix-no-devices"
        >
          {t('mic.matrix.noDevices')}
        </p>
      )}

      <div className="grid items-end" style={{ gridTemplateColumns: COLUMNS, gap: du(12), paddingInline: du(12) }}>
        <span className={HEADER_CLASS} style={HEADER_STYLE}>{t('mic.matrix.header.mic')}</span>
        <span className={HEADER_CLASS} style={HEADER_STYLE}>{t('mic.matrix.header.device')}</span>
        <span className={HEADER_CLASS} style={HEADER_STYLE}>{t('mic.matrix.header.channel')}</span>
        <span className={HEADER_CLASS} style={HEADER_STYLE}>{t('mic.matrix.header.level')}</span>
        <span className="sr-only">{t('mic.matrix.header.actions')}</span>
      </div>

      <ul className="m-0 flex list-none flex-col p-0" style={{ gap: du(8) }}>
        {slots.map((slot) => (
          <MicSlotRow
            key={slot.slotNumber}
            slot={slot}
            devices={devices}
            conflictsWith={conflicts[slot.slotNumber] ?? []}
            reduceMotion={reduceMotion}
          />
        ))}
      </ul>
    </div>
  )
}
