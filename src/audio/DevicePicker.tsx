import { GlassButton } from '../design/primitives/GlassButton'
import { GlassErrorState } from '../design/primitives/GlassErrorState'
import { GlassPanel } from '../design/primitives/GlassPanel'
import { usePitchStore } from './pitchStore'
import { useT } from '../i18n'

export function DevicePicker() {
  const devices = usePitchStore((state) => state.devices)
  const activeCaptures = usePitchStore((state) => state.activeCaptures)
  const startCapture = usePitchStore((state) => state.startCapture)
  const stopCapture = usePitchStore((state) => state.stopCapture)
  const refreshDevices = usePitchStore((state) => state.refreshDevices)
  const t = useT()

  return (
    <GlassPanel className="p-4 flex flex-col gap-2 min-w-[260px]" data-testid="device-picker">
      {devices.length === 0 && (
        <GlassErrorState
          title={t('audio.devices.empty.title')}
          message={t('audio.devices.empty.message')}
          retryLabel={t('audio.devices.rescan')}
          onRetry={() => refreshDevices()}
        />
      )}
      {devices.map((device) => {
        const isActive = device.id in activeCaptures
        return (
          <div key={device.id} className="flex items-center justify-between gap-3" data-testid="device-picker-row">
            <span className="text-base text-ink-secondary truncate">{device.name}</span>
            <GlassButton
              type="button"
              className="px-5 py-2 text-sm font-semibold"
              onClick={() => (isActive ? stopCapture(device.id) : startCapture(device.id))}
            >
              {isActive ? t('audio.devices.stop') : t('audio.devices.start')}
            </GlassButton>
          </div>
        )
      })}
    </GlassPanel>
  )
}
