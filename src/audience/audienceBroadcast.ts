/**
 * The host half of the audience mesh: what the main window sends to the TV.
 *
 * The audience window is a second renderer process and shares no store with
 * the host, so everything it draws arrives over `AUDIENCE_REPORT_SCORE_STATE`
 * -> the main process's throttling relay -> `AUDIENCE_SCORE_STATE`. This module
 * composes the host's current screen (scene, song, singers, lyrics, scores) and
 * is the single sender: two senders on one channel make the TV flicker.
 *
 * Started from module scope in ./AudienceScoreboard.tsx, guarded on the window
 * role, because App.tsx imports that module statically in both windows.
 *
 * Cost: store changes *request* a publish, coalesced to at most one compose +
 * IPC send per `AUDIENCE_PUBLISH_INTERVAL_MS` (the relay's own rate). The
 * recent-clears tail is only re-sent while it changes (see `encodeForWire`),
 * and nothing is composed while no audience window is open (`onWindowPresence`).
 */
import type { ScoreState } from '../contracts/types'
import { useSceneStore, type SceneName } from '../scenes/sceneStore'
import { useSessionStore } from '../session/sessionStore'
import { usePlayersStore } from '../players/store'
import { useStageStore } from '../stage/stageStore'
import { useMicSlotStore } from '../multiplayer/store'
import { readSingerPitches } from './pitchMirror'
import { claimableMicNumbers, micNumberFor } from '../multiplayer/slots'
import { isConfigured } from '../multiplayer/types'
import { useHitStore } from '../game/state/useHitStore'
import type { LibrarySong } from '../library/types'
import { toLibraryMediaUrl } from '../library/mediaUrl'
import {
  AUDIENCE_CLEAR_WINDOW,
  type AudienceNoteClear,
  type AudienceSinger,
  type AudienceSong,
  type AudienceState,
  type AudienceView,
} from './types'
import { watchAssignSelection, type MirroredPick } from './assignSelectionMirror'
import { readStageClock, watchStageClock } from './stageClockMirror'

/** Any store exposing Zustand's standard getState()/subscribe() over score-shaped state. */
export interface ScoreReadableStore {
  /** Any `combo` the store still carries is ignored: scoring is 0-10,000 with no combo. */
  getState: () => Pick<ScoreState, 'players' | 'rank'>
  subscribe: (listener: () => void) => () => void
}

const EMPTY_SCORE: Pick<ScoreState, 'players' | 'rank'> = { players: [], rank: [] }

/**
 * The most often the host composes and sends: once per ~30 Hz frame, matching
 * the main process's relay (electron/windows/state-broadcaster.cjs, 34 ms) --
 * anything faster is overwritten in the relay before it is ever forwarded.
 */
export const AUDIENCE_PUBLISH_INTERVAL_MS = 33

/**
 * After the clears tail changes it is sent in full on this many consecutive
 * publishes, then omitted (`clearsUnchanged`) until it changes again. The
 * repeats cover a message the relay drops by overwriting it before its tick.
 */
const CLEARS_REPEAT_SENDS = 3

/** ...and re-sent in full at least this often regardless, so a loss always heals. */
const CLEARS_KEYFRAME_MS = 1000

/**
 * Which audience screen each host scene maps to.
 *
 * `session-starting` stays on the line-up: the 3-2-1 transition is the host
 * telling the singers to get ready, and cutting the audience to a blank stage
 * for four seconds before the song appears would read as a fault.
 * `session-leaderboard` stays on the celebration, because the leaderboard is
 * opened *from* results and the room has not stopped looking at who won.
 * Everything unlisted (Home, the song list, Settings, the library, every lab
 * route) is the idle attract screen: the main screen without the buttons.
 */
const VIEW_BY_SCENE: Partial<Record<SceneName, AudienceView>> = {
  'session-assign': 'lineup',
  'session-starting': 'lineup',
  'session-party-draw': 'lineup',
  'session-play': 'play',
  'session-results': 'results',
  'session-leaderboard': 'results',
  'lab-audience': 'scoreboard',
}

function coverUrlFor(song: LibrarySong | null): string | null {
  // Same resolution the host screens use (SessionStarting, SongSelector): the
  // scanner's generated thumbnail served over the library-media scheme, which
  // the audience window can fetch because the protocol is registered on the
  // default session, not per window.
  return song?.thumbnailPath ? toLibraryMediaUrl(song.thumbnailPath) : null
}

function toAudienceSong(song: LibrarySong | null): AudienceSong | null {
  if (!song) return null
  const result: AudienceSong = {
    path: song.path,
    title: song.title,
    artist: song.artist,
    coverUrl: coverUrlFor(song),
  }
  if (song.videoPath) {
    result.videoPath = song.videoPath
  }
  return result
}

// --- What the host is currently sending -------------------------------------

let scoreSource: ScoreReadableStore | null = null
let scoreUnsubscribe: (() => void) | null = null
/** An explicit, in-progress line-up published by the selection screen, when there is one. */
let publishedSelection: string[] | null = null
/** The same thing recovered from the screen itself -- see ./assignSelectionMirror.ts. */
let mirroredSelection: MirroredPick[] = []

function send(state: AudienceState): void {
  window.api?.audience?.reportScoreState(state)
}

/** The mics on offer tonight, so the numbers the audience reads match the ones the host drew. */
function claimable(): number[] {
  return claimableMicNumbers(useMicSlotStore.getState().slots)
}

function singerFromPlayerId(playerId: string, micNumber: number): AudienceSinger {
  const profile = usePlayersStore.getState().players.find((player) => player.id === playerId)
  return {
    playerId,
    name: profile?.name ?? playerId,
    micNumber,
    avatarUrl: profile?.avatarUrl ?? '',
  }
}

let cachedAssignedKey = ""
let cachedSingers: AudienceSinger[] = []

function singersFromAssignment(assignedPlayerIds: string[]): AudienceSinger[] {
  const key = assignedPlayerIds.join("|")
  if (key === cachedAssignedKey && cachedSingers.length > 0) {
    return cachedSingers
  }
  const mics = claimable()
  const result = assignedPlayerIds
    .map((playerId) => {
      const micNumber = micNumberFor(assignedPlayerIds, playerId, mics)
      return micNumber === null ? null : singerFromPlayerId(playerId, micNumber)
    })
    .filter((singer): singer is AudienceSinger => singer !== null)
  cachedAssignedKey = key
  cachedSingers = result
  return result
}

/** The line-up as it is being built, before "Start singing" commits it. */
function singersFromMirror(picks: MirroredPick[]): AudienceSinger[] {
  const profiles = usePlayersStore.getState().players
  return picks.map((pick) => {
    const profile = profiles.find((player) => player.name === pick.name)
    return {
      playerId: profile?.id ?? null,
      name: pick.name,
      micNumber: pick.micNumber,
      avatarUrl: profile?.avatarUrl ?? '',
    }
  })
}

/**
 * The recent tail of the host's judgements, compacted for the wire.
 *
 * `useHitStore` already keeps a bounded window of the last 256 hits for exactly
 * the same reason this is bounded, so this is a slice of a slice -- no scan of
 * the song, and nothing here grows over its length. Only the four fields the
 * audience's note lanes actually use survive the trip: `deviationCents` and the
 * host-local timestamp are dropped.
 */
let clearsSourceEvents: unknown = null
let clearsSourceCount = -1
let clearsCache: AudienceNoteClear[] = []
/** The hit-store run (`epoch`) the clears were last read from, and the song it belongs to. */
let clearsEpoch = -1
let clearsSong: string | null = null
/** How many of that run's hits (`total`) were judged before `clearsSong` came on: never sent. */
let clearsBaselineTotal = 0

/**
 * Only this song's judgements, never the last one's.
 *
 * Note ids restart at `note-0` on every song, so a tail left over from the
 * previous song is indistinguishable on the television from this song's own
 * clears: replayed onto the new lanes, it painted notes nobody had sung yet and
 * marked them seen, so the real judgements were then dropped as duplicates.
 * Gameplay resets the hit store at every song boundary (a new `epoch`), which
 * is the normal way a run ends. Should a song ever change *without* that reset,
 * whatever the store already holds is set aside, and only what is judged from
 * then on is sent.
 */
function recentClears(songPath: string | null): AudienceNoteClear[] {
  const { events, total, epoch } = useHitStore.getState()
  if (epoch !== clearsEpoch) {
    // A fresh run (or the first look at one): it belongs to the song on now.
    clearsEpoch = epoch
    clearsSong = songPath
    clearsBaselineTotal = 0
  } else if (songPath !== clearsSong) {
    clearsSong = songPath
    clearsBaselineTotal = total
  }
  const count = Math.min(Math.max(0, total - clearsBaselineTotal), events.length, AUDIENCE_CLEAR_WINDOW)
  // The hit store replaces its array on every write, so an identical reference
  // means nothing was judged since the last compose: hand back the same array,
  // which is also what lets `encodeForWire` see that it need not re-send it.
  if (events === clearsSourceEvents && count === clearsSourceCount) return clearsCache
  const tail = events.slice(events.length - count)
  clearsSourceEvents = events
  clearsSourceCount = count
  clearsCache = tail.map((event) => ({
    noteId: event.noteId,
    playerId: event.playerId,
    tier: event.tier,
    credit: event.credit,
  }))
  return clearsCache
}

/** Everything the audience window needs to draw the host's current screen. */
export function composeAudienceState(): AudienceState {
  const scene = useSceneStore.getState().current
  const session = useSessionStore.getState()
  const score = scoreSource?.getState() ?? EMPTY_SCORE
  const view = VIEW_BY_SCENE[scene] ?? 'idle'

  // The line-up screen is the one place the committed assignment is still
  // empty, so it prefers whatever describes the *current* picks: the explicit
  // publication if a caller made one, otherwise the screen's own mirror.
  const liveSelection =
    publishedSelection !== null ? singersFromAssignment(publishedSelection) : singersFromMirror(mirroredSelection)
  const committed = singersFromAssignment(session.assignedPlayerIds)
  const singers = view === 'lineup' && committed.length === 0 ? liveSelection : committed

  const byPlayerId = new Map(singers.map((singer) => [singer.playerId, singer]))
  const results = (session.lastResult ?? [])
    .map((result) => {
      const singer = byPlayerId.get(result.playerId) ?? singerFromPlayerId(result.playerId, 1)
      return { ...singer, ...result, playerId: result.playerId }
    })
    .sort((a, b) => b.score - a.score)

  const stage = useStageStore.getState()

  return {
    view,
    mode: session.mode,
    players: score.players,
    // Deprecated wire field (see ScoreState.combo): there is no combo any more,
    // so the audience is always told 0 and never shows one.
    combo: 0,
    rank: score.rank,
    song: toAudienceSong(session.selectedSong),
    singers,
    results: view === 'results' ? results : [],
    lyrics:
      view === 'play'
        ? { currentLineIndex: stage.currentLineIndex, activeSyllableIndex: stage.activeSyllableIndex }
        : null,
    // Read live rather than cached from the poll below, so *every* publish --
    // including the ones a score or a syllable boundary triggers between polls
    // -- carries an anchor taken at that instant rather than up to 100 ms old.
    // A `querySelector` on a screen that is not singing would find nothing
    // anyway; the guard just says so without asking.
    playback: view === 'play' ? readStageClock() : null,
    // See AudienceState.micRigConfigured: with nothing configured the host
    // collapses to one fallback lane, and the television must do the same.
    micRigConfigured: useMicSlotStore.getState().slots.some(isConfigured),
    clears: view === 'play' ? recentClears(session.selectedSong?.path ?? null) : [],
    // Live pitch indicators. Read at publish time from the frame loop's own
    // registry, never from a store -- see ./pitchMirror.ts.
    pitches: view === 'play' ? readSingerPitches() : [],
  }
}

// --- Sending ------------------------------------------------------------------

/**
 * Whether an audience window exists to receive anything.
 *
 * Assumed true until the preload says otherwise, so a preload with no presence
 * signal always sends. When
 * `window.api.audience.onWindowPresence` exists (see `installAudienceHostBroadcast`)
 * the host stops composing entirely while no audience window is open, and
 * publishes immediately when one appears so it never starts on a stale frame.
 */
let audienceWindowPresent = true

let publishPending = false
let publishTimer: ReturnType<typeof setTimeout> | null = null
let lastPublishAt = Number.NEGATIVE_INFINITY
/**
 * Bumped on every send and every cancel. A scheduled trailing send only fires
 * if no send happened since it was scheduled -- so a timer that outlived a
 * newer send (or a cancel) can never deliver anything after it.
 */
let publishGeneration = 0

let lastFullClears: AudienceNoteClear[] | null = null
let clearsRepeatsLeft = 0
let lastClearsKeyframeAt = Number.NEGATIVE_INFINITY

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/**
 * Leave the clears tail out of the message when the audience already has it.
 *
 * The tail is up to `AUDIENCE_CLEAR_WINDOW` entries (~7 KB) and, between
 * notes, does not change for seconds at a time. It goes in full whenever it
 * changed recently or a keyframe is due; otherwise the message says
 * `clearsUnchanged` and the audience keeps what it holds
 * (normalizeAudienceState).
 */
function encodeForWire(state: AudienceState, at: number): AudienceState {
  if (state.clears.length === 0) {
    lastFullClears = state.clears
    clearsRepeatsLeft = 0
    return state
  }
  if (state.clears !== lastFullClears) {
    lastFullClears = state.clears
    clearsRepeatsLeft = CLEARS_REPEAT_SENDS
  }
  if (clearsRepeatsLeft > 0 || at - lastClearsKeyframeAt >= CLEARS_KEYFRAME_MS) {
    clearsRepeatsLeft = Math.max(0, clearsRepeatsLeft - 1)
    lastClearsKeyframeAt = at
    return state
  }
  return { ...state, clears: [], clearsUnchanged: true }
}

function cancelScheduledPublish(): void {
  if (publishTimer !== null) clearTimeout(publishTimer)
  publishTimer = null
  publishPending = false
  publishGeneration++
}

/**
 * The only place a payload leaves the host. It composes *here*, at the moment
 * of sending -- never earlier -- so whatever goes out is the current state of
 * every store, and because composing and sending are one synchronous step no
 * older composition can follow it onto the channel.
 */
function sendNow(throttled: boolean): void {
  // Any send supersedes a trailing send still scheduled: it would carry the
  // same (or older) state.
  cancelScheduledPublish()
  const at = now()
  // Only throttled sends open a new interval, so a deliberate publish never
  // delays the store change that follows it.
  if (throttled) lastPublishAt = at
  if (!audienceWindowPresent) return
  send(encodeForWire(composeAudienceState(), at))
}

/**
 * Compose and push once, now. Safe to call from anywhere, including outside a
 * React tree. For the rare, deliberate moments (install, registering a score
 * source, a published line-up, an audience window appearing); it supersedes
 * any publish already scheduled, since that would carry the same state. Store
 * changes go through `requestAudiencePublish` instead.
 */
export function publishAudienceState(): void {
  sendNow(false)
}

/**
 * Ask for a publish: a leading/trailing throttle at `AUDIENCE_PUBLISH_INTERVAL_MS`.
 *
 * The first request after a quiet interval sends at once (no added latency
 * for an isolated change); every further request inside the interval -- eight
 * notes ending in one frame, a syllable boundary landing with a score tick --
 * collapses into one trailing send at the end of it. The trailing send
 * composes when it fires (see `sendNow`), so it carries the state as it is
 * *then*, including every change made after it was scheduled. A no-op while
 * no audience window is open.
 */
export function requestAudiencePublish(): void {
  if (!audienceWindowPresent || publishPending) return
  const wait = lastPublishAt + AUDIENCE_PUBLISH_INTERVAL_MS - now()
  if (wait <= 0) {
    sendNow(true)
    return
  }
  publishPending = true
  const generation = publishGeneration
  publishTimer = setTimeout(() => {
    publishTimer = null
    // Superseded by a send or a cancel since it was scheduled.
    if (!publishPending || generation !== publishGeneration) return
    sendNow(true)
  }, wait)
}

/** Whether a trailing send is scheduled (tests, teardown). */
export function hasPendingAudiencePublish(): boolean {
  return publishPending
}

/** Send a scheduled publish now instead of waiting for its slot (tests, teardown). */
export function flushAudiencePublish(): void {
  if (!publishPending) return
  sendNow(true)
}

/**
 * Point the broadcast at a score store for as long as the caller needs it.
 *
 * The score table is the one part of the payload the host cannot name a single
 * owner for: gameplay reports the real `useScoreStore`, the Dev Lab reports the
 * mock one. Registering the source (rather than each caller sending its own
 * payload) is what keeps a single sender on the channel.
 *
 * @returns the unregister function -- the store stops being read as soon as it is called.
 */
export function setAudienceScoreSource(store: ScoreReadableStore): () => void {
  scoreUnsubscribe?.()
  scoreSource = store
  scoreUnsubscribe = store.subscribe(requestAudiencePublish)
  publishAudienceState()

  return () => {
    if (scoreSource !== store) return
    scoreUnsubscribe?.()
    scoreUnsubscribe = null
    scoreSource = null
    publishAudienceState()
  }
}

/**
 * The intended seam for the Player Selection screen's in-progress picks.
 *
 * Nothing calls it yet -- `SessionAssign` keeps that selection in local state
 * and belongs to another module -- so ./assignSelectionMirror.ts recovers the
 * same information from the screen's own published attributes. Calling this
 * with the screen's `selectedIds` takes precedence over that mirror and is the
 * one-line replacement for it; `null` hands the job back.
 */
export function setAudienceAssignSelection(playerIds: string[] | null): void {
  publishedSelection = playerIds
  publishAudienceState()
}

// --- Installation -----------------------------------------------------------

let installed = false

/**
 * Subscribe the host window to everything the audience mirrors.
 *
 * Idempotent: a second call is a no-op, so a hot-module reload or a stray
 * import cannot end up with two senders on the channel.
 *
 * @returns a teardown function (used by tests; the app never uninstalls).
 */
export function installAudienceHostBroadcast(): () => void {
  if (installed) return () => {}
  installed = true

  const unsubscribes: (() => void)[] = [
    useSceneStore.subscribe(requestAudiencePublish),
    useSessionStore.subscribe(requestAudiencePublish),
    usePlayersStore.subscribe(requestAudiencePublish),
    useStageStore.subscribe(requestAudiencePublish),
    useMicSlotStore.subscribe(requestAudiencePublish),
  ]

  // Presence, when the preload offers it (an optional API -- see
  // `audienceWindowPresent`). Expected contract: the callback fires with the
  // current state on subscribe and again on every open/close.
  const onWindowPresence = (
    window.api?.audience as { onWindowPresence?: (callback: (open: boolean) => void) => () => void } | undefined
  )?.onWindowPresence
  if (typeof onWindowPresence === 'function') {
    unsubscribes.push(
      onWindowPresence((open) => {
        const wasPresent = audienceWindowPresent
        audienceWindowPresent = open
        if (!open) cancelScheduledPublish()
        else if (!wasPresent) publishAudienceState()
      }),
    )
  }

  // The selection mirror only runs while the host is actually on the selection
  // screen -- it is a DOM poll, and there is nothing for it to read anywhere
  // else.
  let stopMirror: (() => void) | null = null
  const syncMirror = () => {
    const onLineup = VIEW_BY_SCENE[useSceneStore.getState().current] === 'lineup'
    if (onLineup && !stopMirror) {
      stopMirror = watchAssignSelection((picks) => {
        mirroredSelection = picks
        requestAudiencePublish()
      })
    } else if (!onLineup && stopMirror) {
      stopMirror()
      stopMirror = null
      mirroredSelection = []
    }
  }
  unsubscribes.push(useSceneStore.subscribe(syncMirror))
  syncMirror()

  // The song clock, on the same terms and for the same reason (see
  // ./stageClockMirror.ts): it is the one thing the audience needs that the
  // host deliberately keeps out of every store, it is only readable while a
  // song is on screen, and it is what turns the audience's note lanes and
  // backdrop video from a slideshow into playback.
  let stopClock: (() => void) | null = null
  const syncClock = () => {
    const onStage = VIEW_BY_SCENE[useSceneStore.getState().current] === 'play'
    if (onStage && !stopClock) {
      stopClock = watchStageClock(requestAudiencePublish)
    } else if (!onStage && stopClock) {
      stopClock()
      stopClock = null
    }
  }
  unsubscribes.push(useSceneStore.subscribe(syncClock))
  syncClock()

  // The audience window can be opened at any time and re-hydrates from the
  // main process's cached last value, so the host states its screen once now
  // rather than waiting for something to change.
  publishAudienceState()

  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe()
    cancelScheduledPublish()
    audienceWindowPresent = true
    stopMirror?.()
    stopMirror = null
    stopClock?.()
    stopClock = null
    mirroredSelection = []
    publishedSelection = null
    installed = false
  }
}

/** Test-only: forget the registered score source between cases. */
export function resetAudienceBroadcastForTests(): void {
  scoreUnsubscribe?.()
  scoreUnsubscribe = null
  scoreSource = null
  publishedSelection = null
  mirroredSelection = []
  cachedAssignedKey = ""
  cachedSingers = []
  cancelScheduledPublish()
  lastPublishAt = Number.NEGATIVE_INFINITY
  audienceWindowPresent = true
  clearsSourceEvents = null
  clearsSourceCount = -1
  clearsCache = []
  clearsEpoch = -1
  clearsSong = null
  clearsBaselineTotal = 0
  lastFullClears = null
  clearsRepeatsLeft = 0
  lastClearsKeyframeAt = Number.NEGATIVE_INFINITY
}
