import { useEffect } from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { EMPTY_AUDIENCE_STATE, type AudienceState } from './types'

/**
 * Fill in anything a narrower sender left out.
 *
 * The channel carries a superset of `ScoreState`, and some senders send only
 * the scores (the Dev Lab's mock store, a host with no scene). A payload with
 * no `view` is read as a bare scoreboard when there are scores and the attract
 * screen when there are not, rather than a blank idle screen.
 *
 * `previous` is only consulted for the host's delta encoding: a payload that
 * marks `clearsUnchanged` (see audienceBroadcast.ts) keeps the clears already
 * held rather than wiping them.
 */
export function normalizeAudienceState(
  payload: Partial<AudienceState> | null | undefined,
  previous?: AudienceState,
): AudienceState {
  const players = payload?.players ?? []
  const view = payload?.view ?? (players.length > 0 ? 'scoreboard' : 'idle')
  const keepClears = payload?.clearsUnchanged === true && previous !== undefined && previous.view === view
  const normalized: AudienceState = {
    ...EMPTY_AUDIENCE_STATE,
    ...payload,
    players,
    combo: payload?.combo ?? 0,
    rank: payload?.rank ?? [],
    singers: payload?.singers ?? [],
    results: payload?.results ?? [],
    song: payload?.song ?? null,
    lyrics: payload?.lyrics ?? null,
    playback: payload?.playback ?? null,
    micRigConfigured: payload?.micRigConfigured ?? false,
    clears: keepClears ? previous.clears : (payload?.clears ?? []),
    pitches: payload?.pitches ?? [],
    view,
  }
  // A wire-format marker, not state: nothing downstream should ever see it.
  delete normalized.clearsUnchanged
  return normalized
}

// --- Structural sharing -------------------------------------------------------

/**
 * Deep equality for the plain JSON-ish data that crosses the IPC channel
 * (objects, arrays, primitives -- structured clone delivers nothing else).
 */
function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let index = 0; index < a.length; index++) {
      if (!sameData(a[index], b[index])) return false
    }
    return true
  }
  if (Array.isArray(b)) return false
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!sameData((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false
  }
  return true
}

/**
 * For a changed array, keep the previous element object wherever that element
 * did not change, so a row component memo'd on its item (one singer's score
 * card, one scoreboard row) re-renders only for the singer whose score moved.
 */
function shareElements(before: unknown, after: unknown): unknown {
  if (!Array.isArray(before) || !Array.isArray(after)) return after
  return after.map((item: unknown, index) => (index < before.length && sameData(before[index], item) ? before[index] : item))
}

/**
 * Every IPC message arrives as a brand-new object graph, so without this
 * every field of every message would look "changed" to React. Keeping the
 * previous reference for each top-level field whose content did not change is
 * what lets a selector (and a `memo`'d component) skip the ~30 messages a
 * second that only move the clock anchor or a pitch.
 *
 * @returns `previous` itself when nothing changed at all.
 */
export function shareAudienceState(previous: AudienceState, next: AudienceState): AudienceState {
  const before = previous as unknown as Record<string, unknown>
  const after = next as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  let changed = false
  const shared: Record<string, unknown> = {}
  for (const key of keys) {
    if (sameData(before[key], after[key])) {
      if (key in after) shared[key] = before[key]
    } else {
      changed = true
      if (key in after) shared[key] = shareElements(before[key], after[key])
    }
  }
  return changed ? (shared as unknown as AudienceState) : previous
}

// --- The store ----------------------------------------------------------------

/**
 * The audience window's copy of the host's screen.
 *
 * A zustand store rather than one `useState` at the top of the tree, so each
 * consumer selects the slice it draws and unchanged slices keep their identity
 * (see `shareAudienceState`): a message re-renders only what it changed, not
 * the whole view (video and all) ~30 times a second.
 */
export const useAudienceStore = create<AudienceState>(() => EMPTY_AUDIENCE_STATE)

/** Apply one payload from the channel. Exported for the Dev Lab and tests. */
export function ingestAudiencePayload(payload: Partial<AudienceState> | null | undefined): void {
  const previous = useAudienceStore.getState()
  const next = shareAudienceState(previous, normalizeAudienceState(payload, previous))
  if (next !== previous) useAudienceStore.setState(next, true)
}

let feedRefs = 0
let feedUnsubscribe: (() => void) | undefined

/**
 * Reference-counted subscription to the channel: however many components ask
 * for the feed, the window listens once. The first subscriber starts from an
 * empty screen, so a fresh audience view never flashes stale state.
 */
function retainAudienceFeed(): () => void {
  if (feedRefs === 0) {
    useAudienceStore.setState(EMPTY_AUDIENCE_STATE, true)
    feedUnsubscribe = window.api?.audience?.onScoreState((payload) => ingestAudiencePayload(payload))
  }
  feedRefs += 1
  let released = false
  return () => {
    if (released) return
    released = true
    feedRefs -= 1
    if (feedRefs === 0) {
      feedUnsubscribe?.()
      feedUnsubscribe = undefined
    }
  }
}

/** Keep the audience store fed from main's throttled broadcast while mounted. */
export function useAudienceFeed(): void {
  useEffect(() => retainAudienceFeed(), [])
}

/**
 * The whole audience state (audience window only). Re-renders on any change to
 * any field; prefer `useAudienceSlice` / `useAudienceStore` with a selector in
 * anything that redraws often.
 */
export function useAudienceState(): AudienceState {
  useAudienceFeed()
  return useAudienceStore((state) => state)
}

/**
 * A shallow-compared slice of the audience state: re-renders only when one of
 * the named fields changes identity (which, thanks to structural sharing,
 * means its content changed).
 *
 * Does *not* subscribe to the channel by itself; something above it (the
 * audience root, `AudienceScoreboard`) must call `useAudienceFeed()`.
 */
export function useAudienceSlice<K extends keyof AudienceState>(...keys: K[]): Pick<AudienceState, K> {
  return useAudienceStore(
    useShallow((state: AudienceState) => {
      const slice = {} as Pick<AudienceState, K>
      for (const key of keys) slice[key] = state[key]
      return slice
    }),
  )
}

/** Which screen the audience window is showing. */
export function useAudienceView(): AudienceState['view'] {
  return useAudienceStore((state) => state.view)
}

/** Test-only: drop the feed and return the store to the empty screen. */
export function resetAudienceStoreForTests(): void {
  feedUnsubscribe?.()
  feedUnsubscribe = undefined
  feedRefs = 0
  useAudienceStore.setState(EMPTY_AUDIENCE_STATE, true)
}
