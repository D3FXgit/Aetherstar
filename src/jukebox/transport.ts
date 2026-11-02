// The jukebox's transport actions, shared by the on-screen bar, the keyboard and
// the gamepad. Pause and resume go through the song's pause store, so the
// stage's own pause control freezes audio, stem, video and the lyric clock
// together -- the jukebox just skips the singer's 3-2-1 on the way back.
import type { RefObject } from 'react'
import { usePauseStore } from '../stage/pause/pauseStore'
import type { StageControl } from '../stage/Stage'
import { useSessionStore } from '../session/sessionStore'
import { useAppPreferencesStore } from '../settings/appPreferencesStore'

/** How far ←/→ (and the gamepad triggers) jump. */
export const SEEK_STEP_SEC = 10

/** One step of the music volume, for the gamepad, which cannot drag a slider. */
export const VOLUME_STEP = 0.05

/** Move the mixer's music channel (clamped by the store). */
export function nudgeMusicVolume(delta: number): void {
  const preferences = useAppPreferencesStore.getState()
  preferences.setMixerVolume('music', Math.round((preferences.mixer.music + delta) * 100) / 100)
}

export function isJukeboxPaused(): boolean {
  return usePauseStore.getState().phase !== 'running'
}

export function pauseJukebox(): void {
  usePauseStore.getState().pause()
}

/**
 * Straight back to playing, with no lead-in: nobody is waiting to sing. A
 * `resume` transition is what tells the stage to restart its media from the
 * clock (useStagePauseControl), all in the same task.
 */
export function resumeJukebox(): void {
  if (usePauseStore.getState().phase === 'running') return
  usePauseStore.setState({ phase: 'running', resumeCountdown: null, lastTransition: 'resume' })
}

export function togglePlayback(): void {
  if (isJukeboxPaused()) resumeJukebox()
  else pauseJukebox()
}

/** Seconds into the song proper (after `#START`). */
export function elapsedSeconds(control: StageControl | null): number {
  if (!control) return 0
  return Math.max(0, control.getTime() - control.getStartTime())
}

export interface JukeboxTransport {
  togglePlay: () => void
  next: () => void
  /** Restart the song past its first few seconds, else the song before it. */
  previous: () => void
  seekBy: (deltaSec: number) => void
  seekTo: (seconds: number) => void
}

export function createTransport(controlRef: RefObject<StageControl | null>): JukeboxTransport {
  return {
    togglePlay: togglePlayback,
    next: () => useSessionStore.getState().nextJukeboxSong(),
    previous: () => {
      const control = controlRef.current
      if (useSessionStore.getState().previousJukeboxSong(elapsedSeconds(control)) === 'restart' && control) {
        control.seek(control.getStartTime())
      }
    },
    seekBy: (deltaSec) => {
      const control = controlRef.current
      if (control) control.seek(control.getTime() + deltaSec)
    },
    seekTo: (seconds) => controlRef.current?.seek(seconds),
  }
}
