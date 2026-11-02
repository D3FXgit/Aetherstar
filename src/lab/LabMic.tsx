// /lab/mic: device picker, live tuner and raw-buffer scope, without the Mic Check scene.
import { useEffect } from 'react'
import { GlassButton } from '../design/primitives/GlassButton'
import { GlassPanel } from '../design/primitives/GlassPanel'
import { useSceneStore } from '../scenes/sceneStore'
import { DevicePicker } from '../audio/DevicePicker'
import { MicCheckTuner } from '../audio/MicCheckTuner'
import { usePitchStore } from '../audio/pitchStore'
import { useRawScopeStore } from '../audio/rawScopeStore'
import { RawBufferScope } from './RawBufferScope'

export function LabMic() {
  const devices = usePitchStore((state) => state.devices)
  const activeCaptures = usePitchStore((state) => state.activeCaptures)
  const scopeDeviceId = useRawScopeStore((state) => state.activeDeviceId)
  const startScope = useRawScopeStore((state) => state.startScope)
  const stopScope = useRawScopeStore((state) => state.stopScope)

  useEffect(() => {
    const unsubscribePitch = usePitchStore.getState().subscribeToEvents()
    const unsubscribeScope = useRawScopeStore.getState().subscribeToChunks()
    usePitchStore
      .getState()
      .requestPermission()
      .then(() => usePitchStore.getState().refreshDevices())
    return () => {
      unsubscribePitch()
      unsubscribeScope()
    }
  }, [])

  const firstActiveDeviceId = Object.keys(activeCaptures)[0]
  const firstActiveDevice = devices.find((d) => d.id === firstActiveDeviceId)

  return (
    <GlassPanel className="p-8 m-auto max-w-2xl flex flex-col gap-4" data-testid="lab-mic">
      <button
        type="button"
        className="text-sm text-ink-secondary self-start"
        onClick={() => useSceneStore.getState().navigate('lab')}
      >
        ← Back to Dev Lab
      </button>
      <h1 className="text-2xl font-semibold text-ink-primary">Mic lab</h1>

      <DevicePicker />

      {firstActiveDevice && <MicCheckTuner device={firstActiveDevice} />}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-secondary">Raw buffer scope</span>
          <GlassButton
            type="button"
            className="px-4 py-1.5 text-xs disabled:opacity-40"
            disabled={!firstActiveDeviceId}
            onClick={() => (scopeDeviceId ? stopScope() : firstActiveDeviceId && startScope(firstActiveDeviceId))}
          >
            {scopeDeviceId ? 'Stop scope' : 'Start scope'}
          </GlassButton>
        </div>
        <RawBufferScope />
      </div>
    </GlassPanel>
  )
}
