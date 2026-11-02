import { freshLatestPitch, getCaptureStream, usePitchStore } from '../audio/pitchStore'

const CONFIDENCE_THRESHOLD = 0.5

/** Briefly captures every candidate device at once; the first to cross the confidence threshold wins. */
export function useTapToIdentify(deviceIds: string[], threshold = CONFIDENCE_THRESHOLD): Promise<string> {
  return new Promise((resolve) => {
    for (const deviceId of deviceIds) {
      usePitchStore.getState().startCapture(deviceId)
    }

    const unsubscribe = usePitchStore.subscribe((state) => {
      const now = Date.now()
      const winner = deviceIds.find((deviceId) => {
        const capture = state.activeCaptures[deviceId]
        if (!capture) return false
        // `latest` is never cleared by silence, so a device that was already
        // capturing would otherwise "win" on a note sung long before the tap.
        // Only a pitch from the last moment counts (a hand-seeded capture with
        // no live stream falls back to its summary).
        const stream = getCaptureStream(deviceId)
        const latest = stream ? freshLatestPitch(stream, now) : capture.latest
        return latest !== null && latest.confidence >= threshold
      })
      if (!winner) return

      unsubscribe()
      for (const deviceId of deviceIds) {
        if (deviceId !== winner) {
          usePitchStore.getState().stopCapture(deviceId)
        }
      }
      resolve(winner)
    })
  })
}
