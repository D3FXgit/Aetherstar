// Changing the "Singers" count in Party mode resizes the drawn line-up -- it
// does not deal a new round.
//
// It used to re-deal everything: new singers in every slot *and* three new
// mystery songs, so every singer card and every song card was unmounted and a
// fresh set mounted. With AnimatePresence's popLayout the old cards faded out
// on top of the new ones as these staggered in, and the singers strip changed
// height mid-way -- the "layout jumps around before settling" report. Now the
// singers already drawn keep their slots (and their cards), the songs on offer
// stay exactly as they are, and only the slots that come or go animate.
import type { PlayerProfile } from '../../contracts/types'
import { drawFairSingers, type PartyRoundState, type Rng } from '../party/partyDrawLogic'

/**
 * The round with `count` singers.
 *
 * - Fewer: the trailing slots go. A fair draw lists the least-sung first, so
 *   it is the singers who have sung most who step back.
 * - More: the new slots are drawn fairly from the bench. Someone who passed
 *   this round is drawn only if nobody else is left, so the count asked for is
 *   still honoured.
 *
 * Songs, cursor and opt-outs are untouched. Returns `state` itself when the
 * line-up is already `count` long (or cannot grow).
 */
export function resizePartyLineup(
  state: PartyRoundState,
  count: number,
  allPlayers: readonly PlayerProfile[],
  rng: Rng = Math.random,
): PartyRoundState {
  const current = state.assignedPlayerIds
  const target = Math.max(1, Math.round(count))
  if (target === current.length) return state
  if (target < current.length) return { ...state, assignedPlayerIds: current.slice(0, target) }

  const needed = target - current.length
  const assigned = new Set(current)
  const passed = new Set(state.excludedThisRound)
  const bench = allPlayers.filter((p) => !assigned.has(p.id) && !passed.has(p.id))
  const drawn = drawFairSingers(bench, needed, state.sessionSingCounts, rng)
  if (drawn.length < needed) {
    const lastResort = allPlayers.filter((p) => !assigned.has(p.id) && passed.has(p.id))
    drawn.push(...drawFairSingers(lastResort, needed - drawn.length, state.sessionSingCounts, rng))
  }
  if (drawn.length === 0) return state
  return { ...state, assignedPlayerIds: [...current, ...drawn] }
}
