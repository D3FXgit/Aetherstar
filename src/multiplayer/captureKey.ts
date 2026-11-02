import { isConfigured, type MicSlot } from './types'

export function formatCaptureKey(deviceId: string, channelIndex: number): string {
  return channelIndex === 0 ? deviceId : `${deviceId}#${channelIndex}`
}

/**
 * The device half of a capture key -- the renderer's counterpart to
 * `parseCaptureKey` in electron/audio/captureKey.cjs, and deliberately the same
 * `indexOf('#')` split so the two never disagree about which physical device a
 * running capture belongs to.
 *
 * This exists for disconnect handling: `activeCaptures` is keyed by capture key
 * while `AUDIO_DEVICE_LIST_CHANGED` reports device *ids*, so answering "did the
 * hardware behind this capture just vanish?" needs the mapping back.
 */
export function deviceIdOfCaptureKey(captureKey: string): string {
  const separatorIndex = captureKey.indexOf('#')
  // `<= 0` rather than `=== -1`: a key that is nothing but a suffix has no
  // device half to return, and an empty string would match no device and so
  // silently mark the capture as lost.
  if (separatorIndex <= 0) return captureKey
  return captureKey.slice(0, separatorIndex)
}

/**
 * The capture key of one mic slot, or null when the mic has no input configured.
 *
 * The single place a mic number becomes something the audio layer can open.
 */
export function captureKeyOfSlot(slot: MicSlot): string | null {
  return isConfigured(slot) ? formatCaptureKey(slot.deviceId, slot.channelIndex) : null
}

/**
 * The distinct capture keys a set of mic slots needs running.
 *
 * De-duplicated on purpose: two mics pointed at the same device *and* channel
 * are one physical input, and the native layer opens one stream for it.
 */
export function captureKeysForSlots(slots: MicSlot[]): string[] {
  const keys = new Set<string>()
  for (const slot of slots) {
    const key = captureKeyOfSlot(slot)
    if (key !== null) keys.add(key)
  }
  return [...keys]
}

/**
 * What to start and what to stop to get from one set of running captures to another.
 *
 * Takes plain key arrays rather than any domain object: the only question here
 * is set difference, and keeping it that way is what lets both the mic-slot
 * store and a caller holding an arbitrary key list share one implementation.
 */
export function diffCaptureKeys(oldKeys: string[], newKeys: string[]): { toStart: string[]; toStop: string[] } {
  const before = new Set(oldKeys)
  const after = new Set(newKeys)

  return {
    toStart: [...after].filter((key) => !before.has(key)),
    toStop: [...before].filter((key) => !after.has(key)),
  }
}
