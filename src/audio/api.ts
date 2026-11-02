// Thin window.api.audio.* wrapper. Degrades to empty/no-op without
// window.api, like src/library/api.ts.
import type {
  AudioDevice,
  DeviceListChangedPayload,
  MicMonitorSettings,
  MicPermissionStatus,
  PitchBatchPayload,
  RawScopeChunkPayload,
} from './types'

/**
 * What the renderer falls back to with no `window.api` -- a jsdom test, or the
 * app running in a plain browser. Identical to the main process's own default,
 * and off, so nothing in the UI can imply monitoring is running when there is
 * no native layer behind it.
 */
export const DEFAULT_MIC_MONITOR_SETTINGS: MicMonitorSettings = { enabled: false, level: 0.5 }

function audioApi() {
  return window.api?.audio
}

export const listDevices = (): Promise<AudioDevice[]> => audioApi()?.listDevices() ?? Promise.resolve([])
export const requestPermission = (): Promise<MicPermissionStatus> =>
  audioApi()?.requestPermission() ?? Promise.resolve('not-determined')
export const getPermissionStatus = (): Promise<MicPermissionStatus> =>
  audioApi()?.getPermissionStatus() ?? Promise.resolve('not-determined')
export const startCapture = (deviceId: string): Promise<void> => audioApi()?.startCapture(deviceId) ?? Promise.resolve()
export const stopCapture = (deviceId: string): Promise<void> => audioApi()?.stopCapture(deviceId) ?? Promise.resolve()
export const startRawScope = (deviceId: string): Promise<void> => audioApi()?.startRawScope(deviceId) ?? Promise.resolve()
export const stopRawScope = (deviceId: string): Promise<void> => audioApi()?.stopRawScope(deviceId) ?? Promise.resolve()

export const getMicMonitor = (): Promise<MicMonitorSettings> =>
  audioApi()?.getMicMonitor?.() ?? Promise.resolve({ ...DEFAULT_MIC_MONITOR_SETTINGS })
/** Resolves with the setting the main process actually stored, which may be clamped. */
export const setMicMonitor = (settings: MicMonitorSettings): Promise<MicMonitorSettings> =>
  audioApi()?.setMicMonitor?.(settings) ?? Promise.resolve(settings)

export const onPitchBatch = (callback: (payload: PitchBatchPayload) => void): (() => void) =>
  audioApi()?.onPitchBatch(callback) ?? (() => {})
export const onDeviceListChanged = (callback: (payload: DeviceListChangedPayload) => void): (() => void) =>
  audioApi()?.onDeviceListChanged(callback) ?? (() => {})
export const onRawScopeChunk = (callback: (payload: RawScopeChunkPayload) => void): (() => void) =>
  audioApi()?.onRawScopeChunk(callback) ?? (() => {})
