import { useEffect, useRef, useState } from 'react'
import type { MotionValue } from 'framer-motion'
import { LanePanel, PLAYHEAD_OFFSET_PERCENT } from '../game/lane/LanePanel'
import { LanePagingContext, useLanePagingValue } from '../game/lane/LanePagingContext'
import { NoteLane } from '../game/lane/NoteLane'
import { laneGapPx, noteHeightForLaneHeight } from '../game/lane/laneStack'
import { audienceLaneHeightPx, type AudienceLane } from './audienceLanes'
import { AudiencePitchLine } from './AudiencePitchLine'
import type { AudienceSingerPitch } from './types'

/**
 * The note lanes, on the television.
 *
 * ---------------------------------------------------------------------------
 * What is mirrored
 *
 * The real `LanePanel` and the real `NoteLane`, not lookalikes -- the same rim
 * in the same mic colour, the same numbered chip, the same pill geometry, the
 * same guide hairlines, and the same note-clearing (the fill sweeping to the
 * credit the singer actually earned, the swell, the flash, the note staying
 * lit). Anything drawn twice drifts; these are drawn once.
 *
 * They are fed from two places, both of which are cheap:
 *
 *   - **positions** from the chart, which this window already loads for the
 *     lyric box, filtered per lane exactly as the host filters it (see
 *     ./audienceLanes.ts) so a duet's note ids line up;
 *   - **motion** from one MotionValue driven by the broadcast clock anchor (see
 *     ./useAudienceStageClock.ts). The lanes page line by line exactly as the
 *     host's do (one line at a time, a playhead sweeping across it -- see
 *     game/lane/linePaging.ts), from the same lines, so a page flips on both
 *     screens at the same beat; the playhead is a compositor transform and the
 *     lane re-renders only when its page flips.
 *
 * ---------------------------------------------------------------------------
 * The pitch line, and why it is here after all
 *
 * What an audience watches is the singer chasing the note, so the rule is drawn
 * here too -- but there is no microphone in this window (`usePitchCapture` is
 * gated off and must stay off), and `AUDIENCE_SCORE_STATE` is coalesced to one
 * send per 34 ms, so no per-frame value can cross it.
 *
 * So what crosses the channel is not a position but a *target*, and not a pixel
 * but a semitone: the host's already-snapped display value, mapped through this
 * window's own lane geometry and glided toward on this window's own animation
 * frame with the host's own easing. It is the same trick the scroll clock uses
 * (./useAudienceStageClock.ts), and it turns a ten-per-second channel into a
 * rule that moves continuously, about a tenth of a second behind the singer.
 * See ./pitchMirror.ts and ./AudiencePitchLine.tsx.
 *
 * The `LanePanel` playhead hairline stays, because "now" is what makes a
 * scrolling field legible at all, and the notes clearing as they cross it is
 * exactly the event the room is watching for.
 */

interface AudienceNoteLanesProps {
  lanes: AudienceLane[]
  /** Each singer's live pitch target, as broadcast. A lane with no entry draws no rule. */
  pitches: AudienceSingerPitch[]
  /** The song's `#BPM`, which the pages' flip lead is timed in. */
  bpm: number
  /** Per-frame beat position. Never React state -- see ./useAudienceStageClock.ts. */
  beatPosition: MotionValue<number>
}

export function AudienceNoteLanes({ lanes, pitches, bpm, beatPosition }: AudienceNoteLanesProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [availableHeightPx, setAvailableHeightPx] = useState(0)

  // One measurement per resize, never per frame. jsdom and any browser without
  // ResizeObserver simply keep the host's own lane height, which is the correct
  // fallback rather than a broken one.
  useEffect(() => {
    const element = containerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height ?? 0
      setAvailableHeightPx((previous) => (Math.abs(previous - height) < 1 ? previous : height))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  if (lanes.length === 0) return null

  const laneHeightPx = audienceLaneHeightPx(lanes.length, availableHeightPx)
  const noteHeightPx = noteHeightForLaneHeight(laneHeightPx)
  // The pitch range is mapped onto slightly less than the lane box so the lowest
  // note still fits inside it instead of starting on the bottom edge -- the same
  // reservation Gameplay makes.
  const trackHeightPx = laneHeightPx - noteHeightPx
  const semitoneByPlayerId = new Map(pitches.map((pitch) => [pitch.playerId, pitch.semitone]))

  return (
    <div ref={containerRef} className="flex min-h-0 w-full flex-1 items-center justify-center">
      <div
        data-testid="audience-lane-stack"
        data-lane-count={lanes.length}
        className="flex w-full flex-col"
        style={{ gap: `${laneGapPx(lanes.length)}px` }}
      >
        {lanes.map((lane) => (
          <AudienceLaneView
            key={lane.playerId}
            lane={lane}
            bpm={bpm}
            beatPosition={beatPosition}
            laneHeightPx={laneHeightPx}
            trackHeightPx={trackHeightPx}
            noteHeightPx={noteHeightPx}
            semitone={semitoneByPlayerId.get(lane.playerId) ?? null}
          />
        ))}
      </div>
    </div>
  )
}

/** One mirrored lane, with its own line paging built from the same lines as the host's. */
function AudienceLaneView({
  lane,
  bpm,
  beatPosition,
  laneHeightPx,
  trackHeightPx,
  noteHeightPx,
  semitone,
}: {
  lane: AudienceLane
  bpm: number
  beatPosition: MotionValue<number>
  laneHeightPx: number
  trackHeightPx: number
  noteHeightPx: number
  semitone: number | null
}) {
  const paging = useLanePagingValue(lane.lines, bpm, beatPosition)

  return (
    <div data-testid={`audience-lane-${lane.playerId}`} data-mic-number={lane.micNumber} data-player-color={lane.accentColor}>
      <LanePagingContext.Provider value={paging}>
        <LanePanel slotNumber={lane.micNumber} singerName={lane.name} accentColor={lane.accentColor} laneHeightPx={laneHeightPx}>
          {/* `playerId` is passed explicitly rather than left to the
              `[data-player-id]` ancestor lookup: there is no `Gameplay`
              root in this window to carry one, and without an owner the
              lane would clear on *any* singer's judgement -- eight lanes
              all lighting up together. */}
          <NoteLane
            notes={lane.notes}
            playerId={lane.playerId}
            beatPosition={beatPosition}
            laneHeightPx={laneHeightPx}
            trackHeightPx={trackHeightPx}
            noteHeightPx={noteHeightPx}
            scale={paging.liveScale}
            accentColor={lane.accentColor}
            contentOffsetPercent={PLAYHEAD_OFFSET_PERCENT}
          />
          {/* Over the notes, as on the host: the rule is the thing being
              compared against them, so it may never be occluded by one. */}
          <AudiencePitchLine
            semitone={semitone}
            scale={paging.liveScale}
            trackHeightPx={trackHeightPx}
            noteHeightPx={noteHeightPx}
            color={lane.accentColor}
            x={paging.playheadX}
          />
        </LanePanel>
      </LanePagingContext.Provider>
    </div>
  )
}
