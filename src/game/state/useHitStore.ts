import { create } from 'zustand'
import type { JudgedHit } from '../types'

// The live hit store, in the shape of src/contracts/mocks/stores.ts's mock.
/**
 * How many recent hits are retained. Nothing reads more than the recent tail,
 * and a bounded window keeps the cost per hit flat on a 3,000-note duet.
 */
export const MAX_RETAINED_HITS = 256

/**
 * Events are `JudgedHit`, which is a `HitEvent` plus this game's optional
 * partial-credit figure -- so every existing producer (labs, previews, the
 * session tests) still records a plain `HitEvent`, and every existing consumer
 * (the stem mixer, the session summary) still reads one.
 */
interface HitStoreState {
  latest: JudgedHit | null
  /** The newest `MAX_RETAINED_HITS` hits, oldest first. */
  events: JudgedHit[]
  /**
   * How many hits were recorded since the last `reset` -- including the ones
   * `events` has since dropped. Monotonic between resets, so a consumer that
   * needs *every* hit (the session's tallies) reads the newest
   * `total - alreadyConsumed` entries off the end of `events` rather than
   * indexing into a window that stops growing at 256.
   */
  total: number
  /**
   * Bumped by every `reset`: identifies one run of judgements, so a reader can
   * tell "the store was cleared and refilled" from "the same run grew".
   */
  epoch: number
  recordHit: (event: JudgedHit) => void
  /**
   * Record a whole batch as ONE store write.
   *
   * The judging loop can have a backlog to clear in a single animation frame --
   * the clock starts ahead, or a stall drops a run of frames. Writing per note
   * meant hundreds of synchronous notifications inside one frame, which React
   * aborts with "Maximum update depth exceeded".
   */
  recordHits: (events: JudgedHit[]) => void
  reset: () => void
}

function appendBounded(existing: JudgedHit[], incoming: JudgedHit[]): JudgedHit[] {
  const combined = existing.length === 0 ? incoming : [...existing, ...incoming]
  return combined.length <= MAX_RETAINED_HITS ? combined : combined.slice(combined.length - MAX_RETAINED_HITS)
}

export const useHitStore = create<HitStoreState>((set) => ({
  latest: null,
  events: [],
  total: 0,
  epoch: 0,
  recordHit: (event) =>
    set((state) => ({ latest: event, events: appendBounded(state.events, [event]), total: state.total + 1 })),
  recordHits: (events) =>
    set((state) =>
      events.length === 0
        ? state
        : {
            latest: events[events.length - 1],
            events: appendBounded(state.events, events),
            total: state.total + events.length,
          },
    ),
  reset: () => set((state) => ({ latest: null, events: [], total: 0, epoch: state.epoch + 1 })),
}))
