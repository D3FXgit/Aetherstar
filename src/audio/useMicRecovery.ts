import { useEffect } from 'react'
import { usePitchStore } from './pitchStore'
import { useMicRecoveryStore } from './micRecoveryStore'

/**
 * Watches for microphone disconnects for the whole life of the app.
 *
 * This has to be mounted by the shell rather than by a screen, because the one
 * moment a disconnect actually costs something -- mid-song -- is exactly the
 * moment when none of the screens that subscribe to audio events (Mic Check,
 * Hardware & Setup, Calibration, the mic lab) is mounted. Before this, an
 * unplugged mic during a song raised an event nothing in the renderer was
 * listening for.
 *
 * Device events only, deliberately: `subscribeToEvents` would also add a
 * pitch-batch listener, and a second one of those double-appends every sample
 * while one of those screens is open.
 *
 * `enabled` mirrors useCouchNavigation's: the audience window is a scoreboard
 * with no microphones and no overlay to show.
 */
export function useMicRecovery(enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const unsubscribeCaptures = usePitchStore.getState().subscribeToDeviceEvents()
    const unsubscribeRecovery = useMicRecoveryStore.getState().subscribeToDeviceChanges()
    return () => {
      unsubscribeCaptures()
      unsubscribeRecovery()
    }
  }, [enabled])
}
