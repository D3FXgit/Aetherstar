import { create } from 'zustand'
import { useHitStore } from '../../game/state/useHitStore'
import { useScoreStore } from '../../game/state/useScoreStore'

/**
 * The song's pause state.
 *
 * `running` -- singing. `menu` -- the pause menu is up and everything is frozen.
 * `resuming` -- the 3-2-1 lead-in after Resume; still frozen until it ends.
 *
 * The stage (useStagePauseControl) is what actually stops and starts the media;
 * this store only says what the player asked for, so the menu still works when
 * no stage is mounted (a song still loading, a crashed scene).
 */
export type PausePhase = 'running' | 'menu' | 'resuming'

/** Length of the lead-in after Resume, in whole seconds. */
export const RESUME_LEAD_IN_SECONDS = 3

const RESUME_TICK_MS = 1000

/**
 * How the store last left (or entered) a phase. The stage only restarts its
 * media after a finished `resume`; a `reset` is a song being left, and a
 * `restart` remounts the stage instead.
 */
export type PauseTransition = 'pause' | 'resume' | 'restart' | 'reset'

interface PauseStoreState {
  phase: PausePhase
  /** 3, 2, 1 during the resume lead-in; null otherwise. */
  resumeCountdown: number | null
  /**
   * Bumped by `restart()`. The song screen keys its stage on it, so a restart
   * is a clean remount. Never reset, so a key is never reused.
   */
  restartToken: number
  lastTransition: PauseTransition
  pause: () => void
  resume: () => void
  /** Back / Start: opens the menu while singing, resumes from it, re-opens it during the lead-in. */
  toggle: () => void
  /** Zeroes the scores and restarts the song from the top. */
  restart: () => void
  /** Back to `running` with no lead-in, e.g. when the song screen is left. */
  reset: () => void
}

let resumeTimer: ReturnType<typeof setTimeout> | null = null

function clearResumeTimer() {
  if (resumeTimer !== null) clearTimeout(resumeTimer)
  resumeTimer = null
}

export const usePauseStore = create<PauseStoreState>((set, get) => {
  const tick = () => {
    resumeTimer = null
    const { phase, resumeCountdown } = get()
    if (phase !== 'resuming' || resumeCountdown === null) return
    if (resumeCountdown <= 1) {
      set({ phase: 'running', resumeCountdown: null, lastTransition: 'resume' })
      return
    }
    set({ resumeCountdown: resumeCountdown - 1 })
    resumeTimer = setTimeout(tick, RESUME_TICK_MS)
  }

  return {
    phase: 'running',
    resumeCountdown: null,
    restartToken: 0,
    lastTransition: 'reset',

    pause: () => {
      if (get().phase === 'menu') return
      clearResumeTimer()
      set({ phase: 'menu', resumeCountdown: null, lastTransition: 'pause' })
    },

    resume: () => {
      if (get().phase !== 'menu') return
      clearResumeTimer()
      set({ phase: 'resuming', resumeCountdown: RESUME_LEAD_IN_SECONDS })
      resumeTimer = setTimeout(tick, RESUME_TICK_MS)
    },

    toggle: () => {
      if (get().phase === 'menu') get().resume()
      else get().pause()
    },

    restart: () => {
      clearResumeTimer()
      useHitStore.getState().reset()
      const score = useScoreStore.getState()
      score.reset({
        players: score.players.map((player) => ({ ...player, score: 0, combo: 0 })),
        combo: 0,
        rank: score.rank,
      })
      set((state) => ({
        phase: 'running',
        resumeCountdown: null,
        restartToken: state.restartToken + 1,
        lastTransition: 'restart',
      }))
    },

    reset: () => {
      clearResumeTimer()
      const { phase, resumeCountdown } = get()
      if (phase !== 'running' || resumeCountdown !== null) {
        set({ phase: 'running', resumeCountdown: null, lastTransition: 'reset' })
      }
    },
  }
})

/** True while the song is frozen (menu up, or counting back in). */
export function isSongPaused(): boolean {
  return usePauseStore.getState().phase !== 'running'
}
