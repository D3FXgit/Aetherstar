import { logCrash } from '../diagnostics/log'
import type { ConfiguredMicSlot, MicSlot } from './types'

function multiplayerApi() {
  return window.api?.multiplayer
}

/**
 * Run a bridge call, falling back to `fallback` if the bridge is absent *or*
 * the call rejects.
 *
 * The bridge is absent in browser preview; a call rejects when the main process
 * lacks a handler (it does not hot-reload) or a handler throws. Neither is
 * worth crashing for: an unknown mic configuration reads as "no mics configured
 * yet", which every screen already renders. The failure is still logged.
 */
async function callBridge<T>(
  channel: string,
  call: (() => Promise<T>) | undefined | null | false,
  fallback: T,
): Promise<T> {
  // No bridge at all is browser preview, which is expected and silent.
  if (!call) return fallback
  try {
    return await call()
  } catch (error) {
    logCrash(`multiplayer:${channel}`, error, { channel: `multiplayer:${channel}`, degradedTo: fallback })
    return fallback
  }
}

/** Every *configured* mic slot. Unconfigured mics simply have no stored row. */
export const listMicSlots = (): Promise<MicSlot[]> => {
  const bridge = multiplayerApi()
  return callBridge('list-mic-slots', bridge && (() => bridge.listMicSlots()), [])
}

export const saveMicSlot = (slot: ConfiguredMicSlot): Promise<void> => {
  const bridge = multiplayerApi()
  return callBridge('save-mic-slot', bridge && (() => bridge.saveMicSlot(slot)), undefined)
}

export const clearMicSlot = (slotNumber: number): Promise<void> => {
  const bridge = multiplayerApi()
  return callBridge('clear-mic-slot', bridge && (() => bridge.clearMicSlot(slotNumber)), undefined)
}

export const getCpuUsage = (): Promise<{ percent: number }> => {
  const bridge = multiplayerApi()
  return callBridge('get-cpu-usage', bridge && (() => bridge.getCpuUsage()), { percent: 0 })
}
