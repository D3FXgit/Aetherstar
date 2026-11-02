// Renderer cache of the live-monitoring ("karaoke effect") setting. The main
// process owns it (electron/audio/monitor-settings.cjs); every setter writes
// through IPC and adopts the value main actually stored (it may clamp).
import { create } from 'zustand'
import type { MicMonitorSettings } from './types'
import { DEFAULT_MIC_MONITOR_SETTINGS, getMicMonitor, setMicMonitor } from './api'

interface MicMonitorState extends MicMonitorSettings {
  /** False until `load()` has answered, so the UI can avoid flashing the default. */
  loaded: boolean
  load: () => Promise<void>
  setEnabled: (enabled: boolean) => Promise<void>
  setLevel: (level: number) => Promise<void>
}

export const useMicMonitorStore = create<MicMonitorState>((set, get) => {
  /**
   * Which write is the current one. A level drag fires many of these a second
   * and their replies can land out of order; adopting a superseded one would
   * yank the slider back to a position the user has already dragged past.
   */
  let latestWrite = 0

  /** Send one change, then adopt what the main process says it actually stored. */
  async function write(patch: Partial<MicMonitorSettings>): Promise<void> {
    const { enabled, level } = get()
    const next: MicMonitorSettings = { enabled, level, ...patch }
    // Optimistic, before the await: waiting a round trip to move the control
    // under the user's thumb would make the slider feel broken.
    set(next)

    const write = ++latestWrite
    const stored = await setMicMonitor(next)
    if (write !== latestWrite) return
    set(stored)
  }

  return {
    ...DEFAULT_MIC_MONITOR_SETTINGS,
    loaded: false,

    load: async () => {
      const settings = await getMicMonitor()
      set({ ...settings, loaded: true })
    },

    setEnabled: (enabled) => write({ enabled }),
    setLevel: (level) => write({ level }),
  }
})
