import { describe, expect, it } from 'vitest'
import type { SongLine, SongPart } from '../../contracts/types'
import { flattenNotes } from '../../game/matching/flattenNotes'
import { audienceLaneHeightPx, buildAudienceLanes } from '../audienceLanes'
import { linesForLane, partForLaneIndex } from '../../multiplayer/laneParts'
import { laneGapPx, laneHeightForPlayerCount, MIN_LANE_HEIGHT_PX } from '../../game/lane/laneStack'
import type { AudienceSinger } from '../types'

function line(part: SongPart, startBeat: number): SongLine {
  return { part, notes: [{ kind: 'normal', startBeat, length: 2, pitch: 60, syllable: 'la' }] }
}

const DUET: SongLine[] = [line('p1', 0), line('solo', 4), line('p2', 8), line('p1', 12)]

function singer(micNumber: number, playerId: string | null = `p${micNumber}`): AudienceSinger {
  return { playerId, name: `Singer ${micNumber}`, micNumber, avatarUrl: '' }
}

/**
 * The audience's lanes have to be the *same* lanes the host is drawing, note
 * for note -- a broadcast judgement names a note by an id that only means
 * anything inside one lane's filtered chart. If these two derivations ever
 * disagree, a duet's clears land on the wrong pills, silently.
 */
describe('audience lanes reproduce the host lane split exactly', () => {
  it('alternates a duet\'s parts across the lanes, so a third singer joins a part instead of an empty lane', () => {
    expect([0, 1, 2, 3].map(partForLaneIndex)).toEqual(['p1', 'p2', 'p1', 'p2'])

    const lanes = buildAudienceLanes(DUET, [singer(1), singer(2), singer(3)], true)
    expect(lanes[2].notes.map((note) => note.startBeat)).toEqual(lanes[0].notes.map((note) => note.startBeat))
    expect(lanes[2].notes.length).toBeGreaterThan(0)
  })

  it('gives every lane the whole chart when the song is not a duet', () => {
    const solo: SongLine[] = [line('solo', 0), line('solo', 4)]
    const lanes = buildAudienceLanes(solo, [singer(1), singer(2), singer(3)], true)
    for (const lane of lanes) expect(lane.notes.map((note) => note.startBeat)).toEqual([0, 4])
  })

  it('numbers each lane\'s notes with the ids the host\'s own lanes produce', () => {
    const lanes = buildAudienceLanes(DUET, [singer(1), singer(2)], true)

    // The host's MultiplayerGameplay hands lane i `linesForLane(lines, i)` and
    // Gameplay flattens exactly that -- recomputed here from the shared helper.
    const hostLane0 = flattenNotes(linesForLane(DUET, 0))
    const hostLane1 = flattenNotes(linesForLane(DUET, 1))

    expect(lanes[0].notes.map((note) => note.noteId)).toEqual(hostLane0.map((note) => note.noteId))
    expect(lanes[0].notes.map((note) => note.startBeat)).toEqual([0, 4, 12])
    expect(lanes[1].notes.map((note) => note.noteId)).toEqual(hostLane1.map((note) => note.noteId))
    expect(lanes[1].notes.map((note) => note.startBeat)).toEqual([4, 8])
    expect(lanes[0].lines).toBe(linesForLane(DUET, 0))

    // The overlap is the point: `note-1` is a different note in each lane, and
    // is only ever resolved against the lane's own player.
    expect(lanes[0].notes[1].noteId).toBe(lanes[1].notes[1].noteId)
    expect(lanes[0].notes[1].startBeat).not.toBe(lanes[1].notes[1].startBeat)
  })

  it('sorts a duet part by when it is sung, on both screens alike', () => {
    const outOfOrder: SongLine[] = [line('p1', 12), line('p2', 8), line('solo', 4), line('p1', 0)]
    const [lane0] = buildAudienceLanes(outOfOrder, [singer(1)], true)
    expect(lane0.notes.map((note) => note.startBeat)).toEqual([0, 4, 12])
  })

  it('keys a lane by the host player id, and by its mic when a pick matched no profile', () => {
    const lanes = buildAudienceLanes(DUET, [singer(1, 'player-a'), singer(3, null)], true)
    expect(lanes[0].playerId).toBe('player-a')
    // A lane still has to be distinguishable from its neighbours even when the
    // line-up was mirrored by name -- otherwise two lanes share a React key.
    expect(lanes[1].playerId).toBe('audience-mic-3')
    expect(lanes[0].playerId).not.toBe(lanes[1].playerId)
  })

  it('takes the mic rim colour from the mic number, not from the pick order', () => {
    const [lane] = buildAudienceLanes(DUET, [singer(3)], true)
    const [sameMicElsewhere] = buildAudienceLanes(DUET, [singer(3, 'someone-else')], true)
    expect(lane.accentColor).toBe(sameMicElsewhere.accentColor)
    expect(lane.micNumber).toBe(3)
  })
})

describe('the lane stack shrinks to the space the audience screen gives it', () => {
  it('never draws a lane taller than the host does', () => {
    // The television's proportions are not the host's (a scaled-up lyric box, a
    // score strip), so the host's budget is a ceiling here, not a target.
    expect(audienceLaneHeightPx(2, 4000)).toBe(laneHeightForPlayerCount(2))
    expect(audienceLaneHeightPx(1, 4000)).toBe(laneHeightForPlayerCount(1))
  })

  it('divides a smaller box among the lanes rather than running out through the bottom', () => {
    const available = 300
    const height = audienceLaneHeightPx(4, available)
    expect(height * 4 + laneGapPx(4) * 3).toBeLessThanOrEqual(available)
    expect(height).toBeLessThan(laneHeightForPlayerCount(4))
  })

  it('holds the legibility floor even when the box is absurdly short', () => {
    expect(audienceLaneHeightPx(8, 40)).toBe(MIN_LANE_HEIGHT_PX)
  })

  it('falls back to the host height before it has been measured', () => {
    // jsdom, the first paint, and any browser without ResizeObserver.
    expect(audienceLaneHeightPx(3, 0)).toBe(laneHeightForPlayerCount(3))
  })
})

describe('buildAudienceLanes with no mic rig', () => {
  /**
   * The host draws a single fallback lane when no microphone has been set up
   * (MultiplayerGameplay's `hasHardware` branch), so the television has to draw
   * the same one -- otherwise a rig that was never configured shows a stack of
   * lanes on the TV and one on the host.
   */
  it('mirrors the host and draws one fallback lane when no mic is configured', () => {
    const lanes = buildAudienceLanes(DUET, [singer(1), singer(2)], false)

    expect(lanes).toHaveLength(1)
    expect(lanes[0].micNumber).toBe(1)
    // Lane 0's lines -- P1 (with the shared lines) in a duet, sorted.
    expect(lanes[0].notes.map((note) => note.startBeat)).toEqual([0, 4, 12])
  })

  it('draws nothing at all when no mic is configured and nobody has been picked', () => {
    expect(buildAudienceLanes(DUET, [], false)).toEqual([])
  })
})
