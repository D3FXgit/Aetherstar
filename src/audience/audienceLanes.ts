import type { SongLine } from '../contracts/types'
import type { NoteWithId } from '../game/types'
import { flattenNotes } from '../game/matching/flattenNotes'
import { linesForLane } from '../multiplayer/laneParts'
import { computePitchRangeScale, type PitchRangeScale } from '../game/lane/pitchRangeScale'
import {
  laneGapPx,
  laneHeightForPlayerCount,
  MIN_LANE_HEIGHT_PX,
  SOLO_LANE_HEIGHT_PX,
} from '../game/lane/laneStack'
import { micRimColor } from '../design/tokens'
import type { AudienceSinger } from './types'

/**
 * Turning the broadcast line-up into the same lanes the host is drawing.
 *
 * The audience window loads the song's chart itself (it already does, for the
 * lyric box), so every note's *position* is free here -- what has to be got
 * exactly right is that a lane on the television is the same lane, with the same
 * notes under the same ids, as the one on the host's screen. Otherwise a
 * broadcast judgement clears the wrong pill.
 *
 * Three things have to line up, and all three are derived here rather than sent:
 *
 * 1. **Lane order.** `MultiplayerGameplay` builds one lane per entry of
 *    `assignedPlayerIds`, in pick order; `audienceBroadcast.singersFromAssignment`
 *    maps the same array in the same order, so `singers[i]` is lane `i`.
 * 2. **Which lines a lane sings.** A duet's lanes see different charts.
 * 3. **Note ids.** `flattenNotes` numbers `note-0, note-1, ...` across whatever
 *    array it is handed -- so the ids only match if the lines *and their order*
 *    match.
 *
 * 2 and 3 are not re-derived here: both screens call the same
 * `linesForLane` (src/multiplayer/laneParts.ts), so they cannot disagree.
 */

/** One singer's lane on the television: who it belongs to, and exactly the lines and notes the host is drawing for them. */
export interface AudienceLane {
  /** The host's own player id -- the key a broadcast judgement is matched against. */
  playerId: string
  micNumber: number
  name: string
  /** That mic's rim colour. Reinforcement for the number, never a replacement for it. */
  accentColor: string
  /** The lane's lines, exactly as the host's lane has them -- what its line pages are built from. */
  lines: SongLine[]
  notes: NoteWithId[]
}

/**
 * A stable identity for a singer whose pick never matched a stored profile.
 *
 * `AudienceSinger.playerId` is nullable (the line-up screen mirrors picks by
 * name), and a lane still has to be told apart from its neighbours. During a
 * song the id always arrives -- the committed assignment is a list of real
 * player ids -- so this only ever stands in for a lane whose clears could not
 * have been matched anyway.
 */
function laneIdFor(singer: AudienceSinger): string {
  return singer.playerId ?? `audience-mic-${singer.micNumber}`
}

/**
 * @param micRigConfigured whether the host has any microphone slot configured.
 *
 * With none, `MultiplayerGameplay` deliberately does *not* draw one lane per
 * singer: it collapses to a single fallback lane -- the first assigned player,
 * Mic 1 -- singing lane 0's lines (the whole chart, or P1 in a duet). That is
 * the shape of every rig that has not been to Hardware Setup, so the television
 * has to collapse the same way or it shows four lanes beside the host's one.
 */
export function buildAudienceLanes(
  lines: SongLine[],
  singers: AudienceSinger[],
  micRigConfigured: boolean,
): AudienceLane[] {
  if (!micRigConfigured) {
    const singer = singers[0]
    if (!singer) return []
    const laneLines = linesForLane(lines, 0)
    return [
      {
        playerId: laneIdFor(singer),
        // Mic 1, as the host's fallback lane names itself -- and with nothing
        // configured `claimableMicNumbers` offers all eight in order, so the
        // first singer holds Mic 1 anyway.
        micNumber: 1,
        name: singer.name,
        accentColor: micRimColor(0),
        lines: laneLines,
        notes: flattenNotes(laneLines),
      },
    ]
  }

  return singers.map((singer, index) => {
    const laneLines = linesForLane(lines, index)
    return {
      playerId: laneIdFor(singer),
      micNumber: singer.micNumber,
      name: singer.name,
      accentColor: micRimColor(singer.micNumber - 1),
      lines: laneLines,
      notes: flattenNotes(laneLines),
    }
  })
}

/**
 * One scale for the whole chart, shared by every lane -- the same call
 * `MultiplayerGameplay` makes, and for the same reason: two singers on the same
 * note must draw it at the same height, or no one can compare two lanes.
 */
export function audiencePitchScale(lines: SongLine[]): PitchRangeScale {
  return computePitchRangeScale(lines)
}

/**
 * Lane height that fits the space this stack was actually given.
 *
 * `laneHeightForPlayerCount` divides the *host's* budget, which is what is left
 * of the singer view once its song card and lyric box have taken their clamps.
 * The audience screen's proportions are not the host's -- its lyric box is
 * scaled up for television distance and there is a score strip along the bottom
 * -- so eight host-sized lanes would have run out through the bottom of it. This
 * takes the host's answer as the ceiling and shrinks to fit from there, so a
 * lane is never *larger* than the one the singer is reading and never clipped.
 */
export function audienceLaneHeightPx(laneCount: number, availableHeightPx: number): number {
  const hostHeight = laneHeightForPlayerCount(laneCount)
  if (!Number.isFinite(availableHeightPx) || availableHeightPx <= 0) return hostHeight

  const lanes = Math.max(1, laneCount)
  const gaps = (lanes - 1) * laneGapPx(lanes)
  const share = Math.floor((availableHeightPx - gaps) / lanes)
  return Math.min(SOLO_LANE_HEIGHT_PX, hostHeight, Math.max(MIN_LANE_HEIGHT_PX, share))
}
