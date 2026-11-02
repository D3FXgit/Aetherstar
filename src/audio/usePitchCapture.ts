import { useEffect } from 'react'
import { usePitchStore } from './pitchStore'

/**
 * Keeps live pitch flowing into `usePitchStore` for the whole life of the app.
 *
 * Every screen that subscribed to pitch batches did so from its own mount --
 * Mic Check, Hardware Setup, Calibration, the Dev Lab -- and **none of them is
 * mounted during a song**. `session-play` renders Sing/Gameplay, which only
 * *read* the store. So during the one activity the app exists for, no listener
 * was attached: `activeCaptures[...].latest` stayed null and `samples` stayed
 * empty, and the matcher had nothing to score against.
 *
 * The subscription is shared by reference count inside the store, so holding
 * one here for the app's lifetime costs a single native listener and does not
 * double-count samples for the screens that still subscribe on their own.
 *
 * Not mounted in the audience window: it renders a scoreboard from relayed
 * state and has no microphone of its own.
 */
export function usePitchCapture(enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    return usePitchStore.getState().subscribeToEvents()
  }, [enabled])
}
