// How many singers each mode takes on the "Who's singing?" screen.
//
// - Solo/Duet (`classic`): one singer up to as many as there are mics to hand
//   out (eight on an unconfigured rig, see multiplayer/slots.ts).
// - Versus (`battle`): a duel -- exactly two, never more, never fewer.
// - Party picks its singers on its own screen (PartyControls), so it never
//   reaches this screen; it shares Solo/Duet's rule if it ever does.
import type { SessionMode } from './types'

/** Versus is one against one. */
export const VERSUS_SINGER_COUNT = 2

/** The most singers `mode` lets this screen pick, given how many mics can be claimed. */
export function maxSingersFor(mode: SessionMode, claimableMicCount: number): number {
  const mics = Math.max(0, claimableMicCount)
  return mode === 'battle' ? Math.min(VERSUS_SINGER_COUNT, mics) : mics
}

/** The fewest singers `mode` can start a song with. */
export function minSingersFor(mode: SessionMode): number {
  return mode === 'battle' ? VERSUS_SINGER_COUNT : 1
}

/** Whether a line-up of `count` singers may start a song in `mode`. */
export function canStartWith(mode: SessionMode, count: number): boolean {
  if (mode === 'battle') return count === VERSUS_SINGER_COUNT
  return count >= minSingersFor(mode)
}

/**
 * The line-up trimmed to what `mode` allows. Pick order is mic order, so the
 * earliest picks -- who already hold mics 1 and 2 -- are the ones kept.
 * Returns the same array when nothing has to go, so callers can bail out of a
 * state update.
 */
export function clampLineupForMode(playerIds: string[], mode: SessionMode): string[] {
  if (mode !== 'battle' || playerIds.length <= VERSUS_SINGER_COUNT) return playerIds
  return playerIds.slice(0, VERSUS_SINGER_COUNT)
}
