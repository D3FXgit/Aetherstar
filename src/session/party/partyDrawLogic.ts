/**
 * ---------------------------------------------------------------------------
 * Party Mode (Mystery Roulette) Draw Engine
 *
 * Rules:
 * 1. Singer selection is FAIR: candidates are drawn from the least-sung players
 *    first (sorted by sessionSingCounts ascending). Ties are broken randomly.
 * 2. Song selection uses a cursor into a shuffled catalog: a re-roll advances
 *    the cursor by 3 (reshuffling only on wrap-around without repeating the
 *    declined 3), so songs you just declined are never immediately re-dealt.
 * 3. Opt-out (The Dual Re-roll):
 *    - Opting out adds the player to `excludedThisRound` so they cannot be
 *      redrawn during the same round.
 *    - The slot is replaced with a fair draw from the remaining bench.
 *    - Simultaneously re-rolls the 3 offered songs.
 *    - If the bench is empty (no replacement available), opt-out is disabled.
 * 4. Lifecycles:
 *    - `excludedThisRound` is strictly per-round: it resets to an empty set
 *      on every new round (initRound / playAgain).
 *    - Degrades gracefully if no mics are configured or library has fewer than 3 songs.
 * ---------------------------------------------------------------------------
 */
import type { LibrarySong } from '../../library/types'
import type { PlayerProfile } from '../../contracts/types'

export interface PartyRoundState {
  /** Shuffled catalog of songs. */
  shuffledCatalog: LibrarySong[]
  /** Current index into shuffledCatalog. */
  songCursor: number
  /** The 3 (or fewer, if small library) songs offered this roll. */
  offeredSongs: LibrarySong[]
  /** Assigned singer player IDs per active mic slot, order matches claimable mics. */
  assignedPlayerIds: string[]
  /** Player IDs that opted out this round. Resets on new round. */
  excludedThisRound: string[]
  /** Total songs sung by each player this session (playerId -> count). */
  sessionSingCounts: Record<string, number>
}

export type PartyRoundInitResult =
  | { status: 'no-mics' }
  | { status: 'no-players' }
  | { status: 'ready'; state: PartyRoundState }

export type Rng = () => number

/** Uniform Fisher-Yates array shuffle. */
export function shuffleArray<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const temp = result[i]
    result[i] = result[j]
    result[j] = temp
  }
  return result
}

/**
 * Draw K distinct singers from candidates using fair selection:
 * - Sort candidates by `sessionSingCounts[id] ?? 0` ascending.
 * - Group into tiers by sing count.
 * - Take from the lowest tier first; break ties within a tier uniformly at random.
 */
export function drawFairSingers(
  candidates: readonly PlayerProfile[],
  count: number,
  sessionSingCounts: Record<string, number>,
  rng: Rng = Math.random,
): string[] {
  if (count <= 0 || candidates.length === 0) return []
  const needed = Math.min(count, candidates.length)

  // Group candidate IDs by their session sing count
  const tiers = new Map<number, string[]>()
  for (const player of candidates) {
    const singCount = sessionSingCounts[player.id] ?? 0
    const list = tiers.get(singCount)
    if (list) {
      list.push(player.id)
    } else {
      tiers.set(singCount, [player.id])
    }
  }

  // Ascending sing count tiers (e.g. 0 times sung, 1 time sung, etc.)
  const sortedCounts = Array.from(tiers.keys()).sort((a, b) => a - b)

  const selected: string[] = []
  for (const tierCount of sortedCounts) {
    const tierCandidates = tiers.get(tierCount)!
    const shuffledTier = shuffleArray(tierCandidates, rng)
    const remaining = needed - selected.length
    if (shuffledTier.length <= remaining) {
      selected.push(...shuffledTier)
    } else {
      selected.push(...shuffledTier.slice(0, remaining))
    }
    if (selected.length >= needed) break
  }

  return selected
}

/**
 * Draw next batch of songs from shuffled catalog using a cursor.
 * If reaching end of catalog, reshuffles while ensuring the next batch
 * does not immediately re-deal the songs that were just declined.
 */
export function drawNextSongs(
  catalog: readonly LibrarySong[],
  cursor: number,
  batchSize = 3,
  rng: Rng = Math.random,
): { songs: LibrarySong[]; nextCursor: number; nextCatalog: LibrarySong[] } {
  if (catalog.length <= batchSize) {
    return {
      songs: [...catalog],
      nextCursor: 0,
      nextCatalog: [...catalog],
    }
  }

  // Can we take directly from current catalog without wrapping?
  if (cursor + batchSize <= catalog.length) {
    const songs = catalog.slice(cursor, cursor + batchSize)
    return {
      songs,
      nextCursor: cursor + batchSize,
      nextCatalog: [...catalog],
    }
  }

  // Wrapping around: the tail of the current catalog plus a fresh reshuffle.
  const declinedPaths = new Set(catalog.slice(Math.max(0, cursor - batchSize), cursor).map((s) => s.path))
  const reshuffled = shuffleArray(catalog, rng)

  // Rotate or swap so that the top `batchSize` songs do not match the declined ones (if catalog has enough songs)
  if (catalog.length >= batchSize * 2) {
    const nonDeclined = reshuffled.filter((s) => !declinedPaths.has(s.path))
    const matching = reshuffled.filter((s) => declinedPaths.has(s.path))
    const freshCatalog = [...nonDeclined, ...matching]
    return {
      songs: freshCatalog.slice(0, batchSize),
      nextCursor: batchSize,
      nextCatalog: freshCatalog,
    }
  }

  return {
    songs: reshuffled.slice(0, batchSize),
    nextCursor: batchSize,
    nextCatalog: reshuffled,
  }
}

/**
 * Initialize a brand new party round.
 * Excluded players set is always empty on initialization.
 */
export function initPartyRound(params: {
  catalog: readonly LibrarySong[]
  allPlayers: readonly PlayerProfile[]
  claimableMicNumbers: readonly number[]
  sessionSingCounts?: Record<string, number>
  rng?: Rng
}): PartyRoundInitResult {
  const { catalog, allPlayers, claimableMicNumbers: micNumbers, sessionSingCounts = {}, rng = Math.random } = params

  if (micNumbers.length === 0) {
    return { status: 'no-mics' }
  }
  if (allPlayers.length === 0) {
    return { status: 'no-players' }
  }

  const micCount = micNumbers.length
  const initialSingers = drawFairSingers(allPlayers, micCount, sessionSingCounts, rng)

  const shuffledCatalog = shuffleArray(catalog, rng)
  const { songs, nextCursor, nextCatalog } = drawNextSongs(shuffledCatalog, 0, 3, rng)

  return {
    status: 'ready',
    state: {
      shuffledCatalog: nextCatalog,
      songCursor: nextCursor,
      offeredSongs: songs,
      assignedPlayerIds: initialSingers,
      excludedThisRound: [],
      sessionSingCounts: { ...sessionSingCounts },
    },
  }
}

/**
 * Check if the singer at slotIndex can opt out:
 * True if there is at least one candidate on the bench who is not currently
 * assigned and has not opted out this round.
 */
export function canSlotOptOut(
  slotIndex: number,
  currentState: PartyRoundState,
  allPlayers: readonly PlayerProfile[],
): boolean {
  const playerId = currentState.assignedPlayerIds[slotIndex]
  if (!playerId) return false

  const excluded = new Set(currentState.excludedThisRound)
  excluded.add(playerId)
  const currentlyAssigned = new Set(currentState.assignedPlayerIds)

  const benchCandidates = allPlayers.filter((p) => !currentlyAssigned.has(p.id) && !excluded.has(p.id))
  return benchCandidates.length > 0
}

/**
 * Execute an Opt-Out / Pass on a slot:
 * - Excludes the opting-out singer from further draws this round.
 * - Replaces that slot with a fair draw from available bench candidates.
 * - Re-rolls the 3 offered songs simultaneously.
 * - If no bench candidate exists, returns the original state untouched.
 */
export function executeOptOut(
  slotIndex: number,
  currentState: PartyRoundState,
  allPlayers: readonly PlayerProfile[],
  rng: Rng = Math.random,
): { state: PartyRoundState; replacedPlayerId: string | null } {
  const outgoingId = currentState.assignedPlayerIds[slotIndex]
  if (!outgoingId) return { state: currentState, replacedPlayerId: null }

  const newExcluded = [...currentState.excludedThisRound, outgoingId]
  const excludedSet = new Set(newExcluded)
  const currentlyAssigned = new Set(currentState.assignedPlayerIds)

  const benchCandidates = allPlayers.filter((p) => !currentlyAssigned.has(p.id) && !excludedSet.has(p.id))
  if (benchCandidates.length === 0) {
    return { state: currentState, replacedPlayerId: null }
  }

  // Draw 1 replacement singer fairly from the bench
  const replacement = drawFairSingers(benchCandidates, 1, currentState.sessionSingCounts, rng)[0]
  if (!replacement) {
    return { state: currentState, replacedPlayerId: null }
  }

  const nextAssigned = [...currentState.assignedPlayerIds]
  nextAssigned[slotIndex] = replacement

  // Re-roll 3 songs simultaneously
  const { songs, nextCursor, nextCatalog } = drawNextSongs(
    currentState.shuffledCatalog,
    currentState.songCursor,
    3,
    rng,
  )

  return {
    state: {
      ...currentState,
      shuffledCatalog: nextCatalog,
      songCursor: nextCursor,
      offeredSongs: songs,
      assignedPlayerIds: nextAssigned,
      excludedThisRound: newExcluded,
    },
    replacedPlayerId: replacement,
  }
}

/**
 * Record a completed song in party mode:
 * Increments each participating player's sing count.
 */
export function recordSongSung(
  arg1?: readonly string[] | Record<string, number>,
  arg2?: Record<string, number> | readonly string[]
): Record<string, number> {
  let playerIds: readonly string[] = []
  let counts: Record<string, number> = {}

  if (Array.isArray(arg1)) {
    playerIds = arg1
    if (arg2 && typeof arg2 === 'object' && !Array.isArray(arg2)) {
      counts = arg2 as Record<string, number>
    }
  } else if (arg1 && typeof arg1 === 'object') {
    counts = arg1 as Record<string, number>
    if (Array.isArray(arg2)) {
      playerIds = arg2
    }
  }

  const next = { ...counts }
  for (const id of playerIds) {
    if (id) {
      next[id] = (next[id] ?? 0) + 1
    }
  }
  return next
}
