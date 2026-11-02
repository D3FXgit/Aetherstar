import { useMicHealthStore } from '../../game/state/useMicHealthStore'
import { useSessionStore } from '../../session/sessionStore'

/**
 * Leaves the song from the pause menu without recording a score.
 *
 * Classic and battle nights go back to the song list (`playAgain`). A party
 * night ends the session, and so does anything that is not a running song, so
 * the machine is never left parked on `play`.
 */
export function quitSong(): void {
  const session = useSessionStore.getState()
  if (session.mode === 'party' || session.phase !== 'play') {
    session.endSession()
    return
  }
  // endSession clears this itself; playAgain does not, and a lane that never
  // mounted would otherwise carry its warning into the next song.
  const health = useMicHealthStore.getState()
  if (Object.keys(health.byPlayerId).length > 0) health.reset()
  session.playAgain()
}
