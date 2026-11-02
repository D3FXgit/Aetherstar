// What is open over the jukebox's video, and whether the transport bar is up.
// Screen state only: the play order lives in sessionStore, pause in pauseStore.
import { create } from 'zustand'

/** The transport bar hides after this long without input, unless something holds it up. */
export const TRANSPORT_HIDE_DELAY_MS = 3000

interface JukeboxUiState {
  /** The "Up next" queue panel. */
  queueOpen: boolean
  /** The in-place song browser, over the queue panel. */
  addSongsOpen: boolean
  transportVisible: boolean
  /** Bumped by every input that should keep the bar up; restarts the hide timer. */
  activity: number
  /** Bumped to ask the transport bar to put focus on Play/Pause (the first arrow press). */
  focusRequest: number
  setQueueOpen: (open: boolean) => void
  toggleQueue: () => void
  setAddSongsOpen: (open: boolean) => void
  /** Show the bar (if hidden) and restart its hide timer. */
  reveal: () => void
  hideTransport: () => void
  /** Show the bar and focus Play/Pause. */
  focusTransport: () => void
  /**
   * Back, overlays first: the song browser, then the queue panel. Returns
   * whether it closed something (the session machine's interceptor contract).
   */
  closeTopOverlay: () => boolean
  reset: () => void
}

const INITIAL = {
  queueOpen: false,
  addSongsOpen: false,
  transportVisible: true,
  activity: 0,
  focusRequest: 0,
}

export const useJukeboxUiStore = create<JukeboxUiState>((set, get) => ({
  ...INITIAL,

  setQueueOpen: (open) => {
    if (get().queueOpen !== open) set({ queueOpen: open, addSongsOpen: open ? get().addSongsOpen : false })
  },

  toggleQueue: () => get().setQueueOpen(!get().queueOpen),

  setAddSongsOpen: (open) => {
    if (get().addSongsOpen !== open) set({ addSongsOpen: open })
  },

  reveal: () => set((state) => ({ transportVisible: true, activity: state.activity + 1 })),

  hideTransport: () => {
    if (get().transportVisible) set({ transportVisible: false })
  },

  focusTransport: () =>
    set((state) => ({ transportVisible: true, activity: state.activity + 1, focusRequest: state.focusRequest + 1 })),

  closeTopOverlay: () => {
    const { addSongsOpen, queueOpen } = get()
    if (addSongsOpen) {
      set({ addSongsOpen: false })
      return true
    }
    if (queueOpen) {
      set({ queueOpen: false })
      return true
    }
    return false
  },

  reset: () => set({ ...INITIAL }),
}))
