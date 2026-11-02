import { NOTE_HEIGHT_PX } from './NoteBlock'

/**
 * Geometry for the singer view's **stack of pitch lanes**.
 *
 * Every singer gets their own lane, and all of them stack in the one shared
 * lane cell in the middle of the stage (see stage/layout.ts's
 * `STAGE_LANE_CELL`). The screen does not grow when a fifth person picks up a
 * microphone, so what is divided here is a fixed budget rather than a per-lane
 * height: adding a singer makes everyone's lane shorter, and never pushes the
 * stack out through the song card above it or the lyric box below it.
 *
 * Everything here is pure pixel maths so it can be asserted directly, in the
 * same spirit as pitchRangeScale.ts.
 */

/** A single singer keeps the full-height lane exactly as the solo layout had it. */
export const SOLO_LANE_HEIGHT_PX = 320

/**
 * The vertical space the whole stack is allowed to divide.
 *
 * Sized against the singer view's grid: the lane row is what is left of the
 * frame once the song-card row and the lyric-box row have taken their clamps,
 * which at 1080p is a little over 500px. 460 is that with a margin.
 */
export const LANE_STACK_BUDGET_PX = 460

/**
 * The floor a lane may not go below.
 *
 * A lane is only useful if the pitch line's travel is legible across the room.
 * At the party cap of eight the divided budget lands under this, so the floor
 * genuinely binds -- eight lanes are 64px each and the stack is allowed to be
 * slightly taller than its budget rather than illegible.
 */
export const MIN_LANE_HEIGHT_PX = 64

/**
 * Space between two lanes in the stack.
 *
 * Tightens as lanes are added: with two the gap is what separates them, with
 * eight the lanes' own rims and number badges already do the separating, and
 * every pixel is worth more inside a lane than between two.
 */
export function laneGapPx(laneCount: number): number {
  if (laneCount <= 2) return 16
  return 12
}

/**
 * Lane height for a party of `count` singers.
 *
 * Every lane in the stack is the same height, always: two lanes of different
 * heights map the same pitch range onto different numbers of pixels, so the
 * same note would be drawn at two different places on the screen and no two
 * singers could compare their lines.
 */
export function laneHeightForPlayerCount(count: number): number {
  const lanes = Math.max(1, count)
  if (lanes === 1) return SOLO_LANE_HEIGHT_PX
  const gaps = (lanes - 1) * laneGapPx(lanes)
  const share = Math.floor((LANE_STACK_BUDGET_PX - gaps) / lanes)
  return Math.min(SOLO_LANE_HEIGHT_PX, Math.max(MIN_LANE_HEIGHT_PX, share))
}

/** Total height of the rendered stack for a party of `count`, gaps included. */
export function laneStackHeightPx(count: number): number {
  const lanes = Math.max(1, count)
  return lanes * laneHeightForPlayerCount(lanes) + (lanes - 1) * laneGapPx(lanes)
}

/**
 * Note pill thickness for a given lane height.
 *
 * The pills are noticeably thicker than a hairline -- they are the thing you
 * aim at -- while still leaving the *track* (the part that carries pitch
 * information) dominant at every size.
 */
export function noteHeightForLaneHeight(laneHeightPx: number): number {
  const scaled = Math.round(laneHeightPx * 0.0625)
  return Math.min(NOTE_HEIGHT_PX, Math.max(8, scaled))
}

/**
 * Guide lines for a lane of this height.
 *
 * A small number of very faint hairlines, as the one concession to reading
 * pitch distance in a lane with no notes on screen yet -- nine of them across a
 * short lane is a hatch pattern, not a guide, and every one is a line drawn
 * over the video for no information gain.
 */
export function guideLineCount(laneHeightPx: number): number {
  if (laneHeightPx >= 240) return 5
  if (laneHeightPx >= 130) return 3
  return 1
}
