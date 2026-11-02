/**
 * Where each singer's pitch indicator is, for the television.
 *
 * The audience window has no microphone, and a 34ms-coalesced channel cannot
 * carry a per-frame value. Both are met by sending less, not more:
 *
 *   - **A semitone, not a pixel.** The host's lanes and the television's are
 *     different heights (see audienceLanes.audienceLaneHeightPx), so a Y in
 *     host pixels would land on the wrong note. What is sent is the value the
 *     host has already decided to *draw* -- its snapped display semitone -- and
 *     each screen maps that through its own geometry.
 *   - **A target, not a position.** Exactly the trick the clock anchor uses
 *     (./useAudienceStageClock.ts): the audience is not told where the rule is
 *     sixty times a second, it is told where the rule is *heading*, and glides
 *     toward it on its own animation frame with the host's own easing. A target
 *     arriving ten times a second and a rule gliding at 60fps is a smooth rule
 *     that trails the singer by about a tenth of a second -- which is the same
 *     rule, slightly behind, rather than a stuttering one.
 *
 * A module registry and not a store, for the same reason ./stageClockMirror.ts
 * is a DOM reader: this value is written inside `Gameplay`'s
 * `useAnimationFrame`, and the whole point of that loop is that it does not
 * touch React. A zustand write per singer per frame would
 * re-render the most frame-critical subtree in the app sixty times a second --
 * which is precisely the cost the pitch line was built to avoid. A mutable map
 * costs a property write, and `composeAudienceState` reads it at publish time.
 */
import type { AudienceSingerPitch } from './types'

interface Entry {
  semitone: number
  /** When it was written, so a singer who stopped singing stops being drawn. */
  at: number
}

const latest = new Map<string, Entry>()

/**
 * How long a written pitch stays valid.
 *
 * The frame loop writes continuously while a song is on screen, so anything
 * older than a few frames means that lane's loop has stopped -- the song ended,
 * the scene changed, the singer's capture died. Drawing a stale rule would
 * leave a marker frozen mid-lane, which reads as a fault. 250 ms is many frames
 * at any refresh rate and still well under the time it takes anyone to notice
 * a rule that has stopped moving.
 */
export const SINGER_PITCH_STALE_MS = 250

/**
 * Record where one singer's indicator is heading, in semitones on the chart's
 * own scale. `null` means "not singing anything right now" and removes the
 * marker rather than freezing it.
 *
 * Called from an animation frame: it must stay a map write and nothing else.
 */
export function publishSingerPitch(playerId: string, semitone: number | null, now: number = Date.now()): void {
  if (semitone === null || !Number.isFinite(semitone)) {
    latest.delete(playerId)
    return
  }
  latest.set(playerId, { semitone, at: now })
}

/** Every singer whose indicator is currently live, for the broadcast payload. */
export function readSingerPitches(now: number = Date.now()): AudienceSingerPitch[] {
  const pitches: AudienceSingerPitch[] = []
  for (const [playerId, entry] of latest) {
    if (now - entry.at > SINGER_PITCH_STALE_MS) {
      latest.delete(playerId)
      continue
    }
    pitches.push({ playerId, semitone: entry.semitone })
  }
  return pitches
}

/** Drop everything -- leaving a song must not leave its rules behind for the next one. */
export function clearSingerPitches(): void {
  latest.clear()
}
