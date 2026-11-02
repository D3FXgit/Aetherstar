// The jukebox's play order, as pure functions: what plays after this song, what
// Previous goes back to, and how the queue is edited. sessionStore holds the
// state and calls these; nothing here touches a store or the media.
import type { LibrarySong } from '../library/types'

export type JukeboxRepeat = 'off' | 'all' | 'one'

/** Off -> all -> one -> off: the order the Repeat button steps through. */
export const REPEAT_ORDER: readonly JukeboxRepeat[] = ['off', 'all', 'one']

/** Previous within this many seconds of the start goes to the song before; later, it restarts this one. */
export const PREVIOUS_RESTART_THRESHOLD_SEC = 3

/** How many played songs Previous can walk back through. */
export const HISTORY_LIMIT = 100

/** Autoplay avoids repeating any of the last this-many songs while the library has others. */
export const AUTOPLAY_RECENT_LIMIT = 20

export interface JukeboxPlayOrder {
  /** The song playing now, or null (nothing yet, or the queue ran out). */
  current: LibrarySong | null
  /** Up next, in play order. */
  queue: readonly LibrarySong[]
  /** Songs played before `current`, oldest first. */
  history: readonly LibrarySong[]
  /** Every distinct song played since the last repeat-all loop, `current` included: what Repeat all plays again. */
  cycle: readonly LibrarySong[]
  shuffle: boolean
  repeat: JukeboxRepeat
  autoplay: boolean
}

export type NextStep =
  | {
      kind: 'play'
      song: LibrarySong
      queue: LibrarySong[]
      cycle: LibrarySong[]
      /** True when this is `current` again (Repeat one): it is not a new entry in the history. */
      replay: boolean
      /** True when the song was picked at random by autoplay. */
      autoplayed: boolean
    }
  | { kind: 'finished' }

export type PreviousStep =
  | { kind: 'restart' }
  | { kind: 'play'; song: LibrarySong; queue: LibrarySong[]; history: LibrarySong[] }

/** Fisher-Yates over a copy. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/**
 * A random playable song for autoplay, steering clear of what just played and
 * what is about to. Falls back to anything playable but the current song, then
 * to anything playable at all (a one-song library keeps that song going).
 */
export function pickRandomSong(
  pool: readonly LibrarySong[],
  avoid: readonly LibrarySong[],
  current: LibrarySong | null,
  random: () => number = Math.random,
): LibrarySong | null {
  const playable = pool.filter((song) => song.isPlayable)
  if (playable.length === 0) return null
  const avoided = new Set(avoid.map((song) => song.path))
  if (current) avoided.add(current.path)
  const fresh = playable.filter((song) => !avoided.has(song.path))
  const notCurrent = playable.filter((song) => song.path !== current?.path)
  const candidates = fresh.length > 0 ? fresh : notCurrent.length > 0 ? notCurrent : playable
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))] ?? null
}

/**
 * What plays after the current song.
 *
 * `ended` is true when the song ran out by itself (Repeat one plays it again)
 * and false for a skip (which always moves on). Then: the queue; Repeat all
 * loops the cycle; autoplay picks a random song from `pool`; or the jukebox is
 * finished.
 */
export function nextStep(
  order: JukeboxPlayOrder,
  { ended, pool, random = Math.random }: { ended: boolean; pool: readonly LibrarySong[]; random?: () => number },
): NextStep {
  const { current, queue, cycle } = order

  if (ended && order.repeat === 'one' && current) {
    return { kind: 'play', song: current, queue: [...queue], cycle: [...cycle], replay: true, autoplayed: false }
  }

  if (queue.length > 0) {
    const [song, ...rest] = queue
    return { kind: 'play', song, queue: rest, cycle: [...cycle], replay: false, autoplayed: false }
  }

  if (order.repeat === 'all') {
    const loop = cycle.length > 0 ? [...cycle] : current ? [current] : []
    if (loop.length > 0) {
      const [song, ...rest] = order.shuffle ? shuffled(loop, random) : loop
      // A new cycle starts; the song about to play is its first entry.
      return { kind: 'play', song, queue: rest, cycle: [], replay: false, autoplayed: false }
    }
  }

  if (order.autoplay) {
    const recent = order.history.slice(-AUTOPLAY_RECENT_LIMIT)
    const song = pickRandomSong(pool, recent, current, random)
    if (song) return { kind: 'play', song, queue: [], cycle: [...cycle], replay: false, autoplayed: true }
  }

  return { kind: 'finished' }
}

/**
 * What Previous does: restart the song once it is past the first few seconds
 * (or when there is nothing before it), else step back one song -- the current
 * one goes back to the front of the queue, so Next returns to it.
 */
export function previousStep(order: JukeboxPlayOrder, elapsedSec: number): PreviousStep {
  const previous = order.history.at(-1)
  if (!previous || elapsedSec > PREVIOUS_RESTART_THRESHOLD_SEC) return { kind: 'restart' }
  return {
    kind: 'play',
    song: previous,
    queue: order.current ? [order.current, ...order.queue] : [...order.queue],
    history: order.history.slice(0, -1),
  }
}

/** `history` with `song` played, capped at HISTORY_LIMIT. */
export function withHistory(history: readonly LibrarySong[], song: LibrarySong | null): LibrarySong[] {
  if (!song) return [...history]
  const next = [...history, song]
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
}

/** `cycle` with `song` in it, once. */
export function withCycle(cycle: readonly LibrarySong[], song: LibrarySong): LibrarySong[] {
  return cycle.some((entry) => entry.path === song.path) ? [...cycle] : [...cycle, song]
}

/** The queue with one entry moved by `delta` places; out-of-range moves leave it as it is. */
export function moveQueueItem<T>(queue: readonly T[], index: number, delta: number): T[] {
  const target = index + delta
  if (index < 0 || index >= queue.length || target < 0 || target >= queue.length || delta === 0) return [...queue]
  const next = [...queue]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

/** The next Repeat mode. */
export function nextRepeat(repeat: JukeboxRepeat): JukeboxRepeat {
  return REPEAT_ORDER[(REPEAT_ORDER.indexOf(repeat) + 1) % REPEAT_ORDER.length]
}

/** Seconds as m:ss (h:mm:ss past an hour); anything unknown or negative is 0:00. */
export function formatPlaybackTime(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = String(whole % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`
}

/** "Artist" or "Artist · Edition": what a song line shows under its title. */
export function songByline(song: Pick<LibrarySong, 'artist' | 'edition'>): string {
  return song.edition ? `${song.artist} · ${song.edition}` : song.artist
}
