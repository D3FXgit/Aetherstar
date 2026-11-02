// The session state machine: idle -> select -> assign -> starting -> play ->
// results -> leaderboard, plus party-draw and the jukebox. It is the navigation
// authority for these scenes: components call its actions, never navigate().
import { create } from 'zustand'
import type { LibrarySong } from '../library/types'
import type { SessionMode, SessionPhase, SessionSongResult, SessionStoreState } from './types'
import type { SceneName } from '../scenes/sceneStore'
import { useSceneStore } from '../scenes/sceneStore'
import { useMicHealthStore } from '../game/state/useMicHealthStore'
import { recordSongSung } from './party/partyDrawLogic'
import { canStartWith, clampLineupForMode } from './singerLimits'
import { useCalibrationStore } from '../calibration/calibrationStore'
import { logCrash } from '../diagnostics/log'
import { recordPlay } from '../library/api'
import { useLibraryStore } from '../library/useLibraryStore'
import {
  moveQueueItem,
  nextRepeat,
  nextStep,
  previousStep,
  shuffled,
  withCycle,
  withHistory,
  type JukeboxPlayOrder,
  type JukeboxRepeat,
} from '../jukebox/queueLogic'
import { DEFAULT_JUKEBOX_PREFS, loadJukeboxPrefs, saveJukeboxPrefs } from '../jukebox/jukeboxPrefs'
import * as api from './api'

/** The jukebox's scene; its component is registered at runtime by src/jukebox. */
export const JUKEBOX_SCENE: SceneName = 'jukebox'

/** The jukebox's player state, on top of the queue in SessionStoreState. */
interface JukeboxPlayerState {
  /** Songs played before the current one, oldest first: where Previous goes. */
  jukeboxHistory: LibrarySong[]
  /** Distinct songs played since the last Repeat-all loop: what Repeat all plays again. */
  jukeboxCycle: LibrarySong[]
  jukeboxShuffle: boolean
  jukeboxRepeat: JukeboxRepeat
  /** Keep playing random songs once the queue runs out. */
  jukeboxAutoplay: boolean
  /** The queue ran out with nothing else to play: the jukebox shows its "Queue finished" card. */
  jukeboxFinished: boolean
}

interface SessionStore extends SessionStoreState, JukeboxPlayerState {
  startSession: (mode?: SessionMode) => Promise<void>
  /** Open the song list in jukebox mode: no singers, no scoring. */
  startJukebox: () => Promise<void>
  setMode: (mode: SessionMode) => void
  confirmPartyDraw: (song: LibrarySong, playerIds: string[]) => void
  setSongCatalogueCursor: (cursor: number) => void
  pickSong: (song: LibrarySong) => void
  assignPlayers: (playerIds: string[]) => void
  beginSong: () => void
  finishSong: (results: SessionSongResult[]) => void
  playAgain: () => void
  viewLeaderboard: () => void
  endSession: () => void
  /** Step the machine back one phase. */
  back: () => void
  /** Jukebox: play this song now; the queue carries on after it. */
  playJukeboxNow: (song: LibrarySong) => void
  queueJukeboxSong: (song: LibrarySong) => void
  removeFromJukeboxQueue: (index: number) => void
  /** Jukebox: replace the queue with these songs in random order. */
  shuffleIntoJukeboxQueue: (songs: LibrarySong[]) => void
  /**
   * Jukebox Next / Skip: the next queued song; past the end of the queue,
   * Repeat all loops, autoplay picks a random song, or the jukebox is finished.
   */
  nextJukeboxSong: () => void
  /** Jukebox: the song ran out by itself. Like Next, except Repeat one plays it again. */
  jukeboxSongEnded: () => void
  /**
   * Jukebox Previous: the song before this one, or -- `elapsedSec` past the
   * first few seconds, or nothing before it -- 'restart', which the caller does
   * by seeking (the store has no hold on the media).
   */
  previousJukeboxSong: (elapsedSec: number) => 'restart' | 'previous'
  /** Jukebox: move a queued song `delta` places (-1 up, +1 down). */
  moveJukeboxQueueItem: (index: number, delta: number) => void
  clearJukeboxQueue: () => void
  /** Turning shuffle on shuffles what is queued; off leaves the order as it stands. */
  setJukeboxShuffle: (on: boolean) => void
  /** Repeat off -> all -> one -> off. */
  cycleJukeboxRepeat: () => void
  setJukeboxAutoplay: (on: boolean) => void
  jukeboxBackToList: () => void
  setJukeboxMenuOpen: (open: boolean) => void
}

const INITIAL_STATE: SessionStoreState & JukeboxPlayerState = {
  phase: 'idle',
  mode: 'classic',
  sessionId: null,
  selectedSong: null,
  assignedPlayerIds: [],
  lastResult: null,
  songsPlayedThisSession: 0,
  sessionSingCounts: {},
  songCatalogueCursor: 0,
  jukeboxQueue: [],
  jukeboxPlayId: 0,
  jukeboxMenuOpen: false,
  jukeboxHistory: [],
  jukeboxCycle: [],
  jukeboxShuffle: DEFAULT_JUKEBOX_PREFS.shuffle,
  jukeboxRepeat: DEFAULT_JUKEBOX_PREFS.repeat,
  jukeboxAutoplay: DEFAULT_JUKEBOX_PREFS.autoplay,
  jukeboxFinished: false,
}

// 'idle' is Home: its own buttons start a night, so ending one goes back there.
const SCENE_BY_PHASE: Record<SessionPhase, SceneName> = {
  idle: 'home',
  select: 'session-select',
  assign: 'session-assign',
  'party-draw': 'session-party-draw',
  starting: 'session-starting',
  play: 'session-play',
  results: 'session-results',
  leaderboard: 'session-leaderboard',
  jukebox: JUKEBOX_SCENE,
}

function goToPhase(phase: SessionPhase) {
  useSceneStore.getState().navigate(SCENE_BY_PHASE[phase])
}

/** Load the jukebox scene's registration before anything navigates to it. */
async function ensureJukeboxScene(): Promise<void> {
  try {
    await import('../jukebox/registerJukeboxScene')
  } catch (error) {
    logCrash('jukebox:register', error)
  }
}

/** Wipe the mic-health board, but only when there is something on it (reset() always notifies). */
function clearMicHealth() {
  const health = useMicHealthStore.getState()
  if (Object.keys(health.byPlayerId).length > 0) health.reset()
}

/** The jukebox's play order, as queueLogic reads it. */
function jukeboxOrder(state: SessionStoreState & JukeboxPlayerState): JukeboxPlayOrder {
  return {
    current: state.phase === 'jukebox' ? state.selectedSong : null,
    queue: state.jukeboxQueue,
    history: state.jukeboxHistory,
    cycle: state.jukeboxCycle,
    shuffle: state.jukeboxShuffle,
    repeat: state.jukeboxRepeat,
    autoplay: state.jukeboxAutoplay,
  }
}

/** What autoplay picks from: the library as the song list last read it (its filters, not its search text). */
function autoplayPool(): LibrarySong[] {
  const library = useLibraryStore.getState()
  return library.searchBase?.songs ?? library.results
}

let backInterceptor: (() => boolean) | null = null

/**
 * Let an open overlay (a dialog on a session screen) take the next Back --
 * gamepad B included -- instead of the machine. The handler returns true when
 * it consumed the press. Returns the unregister function.
 */
export function interceptSessionBack(handler: () => boolean): () => void {
  backInterceptor = handler
  return () => {
    if (backInterceptor === handler) backInterceptor = null
  }
}

// Every scene the machine owns. The global Back control routes these through
// `back()` below so the phase and the scene never drift apart.
const SESSION_SCENES: ReadonlySet<SceneName> = new Set(
  (Object.entries(SCENE_BY_PHASE) as [SessionPhase, SceneName][])
    .filter(([phase]) => phase !== 'idle')
    .map(([, scene]) => scene),
)

export function isSessionScene(scene: SceneName): boolean {
  return SESSION_SCENES.has(scene)
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  ...INITIAL_STATE,

  startSession: async (mode = 'classic') => {
    if (mode === 'jukebox') return get().startJukebox()

    // Singers' saved difficulties and mic offsets; read per frame, so unawaited.
    void useCalibrationStore.getState().ensureLoaded()

    // One `sessions` row per night. A night is never blocked on record keeping:
    // without a database it starts anyway and its results are simply not saved.
    let sessionId: string | null = null
    try {
      const started = await api.start()
      sessionId = started?.id ?? null
    } catch (error) {
      logCrash('session:start', error)
    }

    const phase: SessionPhase = mode === 'party' ? 'party-draw' : 'select'
    set({ ...INITIAL_STATE, mode, phase, sessionId })
    goToPhase(phase)
  },

  startJukebox: async () => {
    // The output-latency offset keeps the lyrics on the beat.
    void useCalibrationStore.getState().ensureLoaded()
    await ensureJukeboxScene()
    const prefs = loadJukeboxPrefs()
    set({
      ...INITIAL_STATE,
      mode: 'jukebox',
      phase: 'select',
      jukeboxShuffle: prefs.shuffle,
      jukeboxRepeat: prefs.repeat,
      jukeboxAutoplay: prefs.autoplay,
    })
    goToPhase('select')
  },

  setMode: (mode) => {
    const current = get()
    if (current.mode === mode) return
    // The jukebox is entered and left as its own night, never switched into.
    if (mode === 'jukebox' || current.mode === 'jukebox') return
    if (current.phase === 'select' && mode === 'party') {
      set({ mode, phase: 'party-draw', selectedSong: null, assignedPlayerIds: [] })
      goToPhase('party-draw')
    } else if (current.phase === 'party-draw' && mode !== 'party') {
      set({ mode, phase: 'select', selectedSong: null, assignedPlayerIds: [] })
      goToPhase('select')
    } else {
      // Versus is a duel: a line-up already formed for Solo/Duet keeps its
      // first two singers (mics 1 and 2) rather than starting a 3-way "duel".
      set({ mode, assignedPlayerIds: clampLineupForMode(current.assignedPlayerIds, mode) })
    }
  },

  confirmPartyDraw: (song, playerIds) => {
    set({ selectedSong: song, assignedPlayerIds: playerIds, phase: 'starting' })
    goToPhase('starting')
  },

  setSongCatalogueCursor: (cursor) => {
    set({ songCatalogueCursor: cursor })
  },

  pickSong: (song) => {
    // The jukebox has no singers to assign: picking a song plays it.
    if (get().mode === 'jukebox') {
      get().playJukeboxNow(song)
      return
    }
    set({ selectedSong: song, phase: 'assign' })
    goToPhase('assign')
  },

  // The song-start transition runs first and calls beginSong() when it ends.
  assignPlayers: (playerIds) => {
    // The assign screen already enforces this; the store is the last line so
    // nothing can start a Versus song that isn't one against one.
    const { mode } = get()
    const lineup = clampLineupForMode(playerIds, mode)
    if (!canStartWith(mode, lineup.length)) return
    set({ assignedPlayerIds: lineup, phase: 'starting' })
    goToPhase('starting')
  },

  beginSong: () => {
    set({ phase: 'play' })
    goToPhase('play')
  },

  finishSong: (results) => {
    const { selectedSong, mode } = get()
    if (selectedSong) recordPlay(selectedSong.path, mode)
    set((state) => {
      const playerIds =
        state.assignedPlayerIds && state.assignedPlayerIds.length > 0
          ? state.assignedPlayerIds
          : Array.isArray(results)
            ? results.map((r) => r.playerId).filter(Boolean)
            : []
      return {
        lastResult: results,
        songsPlayedThisSession: state.songsPlayedThisSession + 1,
        sessionSingCounts: recordSongSung(playerIds, state.sessionSingCounts),
        phase: 'results',
      }
    })
    goToPhase('results')
  },

  playAgain: () => {
    const nextPhase: SessionPhase = get().mode === 'party' ? 'party-draw' : 'select'
    set({ selectedSong: null, assignedPlayerIds: [], phase: nextPhase })
    goToPhase(nextPhase)
  },

  viewLeaderboard: () => {
    set({ phase: 'leaderboard' })
    goToPhase('leaderboard')
  },

  /**
   * The single exit from the loop, from wherever it is. It also clears the
   * mic-health board, which a lane that never mounted (a chart that failed, a
   * song abandoned while starting) would otherwise leave on the next song.
   */
  endSession: () => {
    clearMicHealth()
    set({ ...INITIAL_STATE })
    goToPhase('idle')
  },

  // The reverse edges of the machine: Back inside the loop is always a phase
  // transition, and the scene follows from it.
  back: () => {
    if (backInterceptor?.()) return
    const { phase, mode, lastResult } = get()
    switch (phase) {
      case 'party-draw':
        get().endSession()
        return

      // Undoing the song pick: exactly playAgain's reset.
      case 'assign':
        set({ selectedSong: null, assignedPlayerIds: [], phase: 'select' })
        goToPhase('select')
        return

      case 'starting': {
        const prevPhase: SessionPhase = mode === 'party' ? 'party-draw' : 'assign'
        set({ phase: prevPhase })
        goToPhase(prevPhase)
        return
      }

      // Results opens the leaderboard, so that is where Back goes, if there is one.
      case 'leaderboard':
        if (lastResult) {
          set({ phase: 'results' })
          goToPhase('results')
          return
        }
        get().endSession()
        return

      // Back over a jukebox song opens (or closes) its Skip / Back to list menu.
      case 'jukebox':
        set({ jukeboxMenuOpen: !get().jukeboxMenuOpen })
        return

      // Nothing earlier to step back to: Back leaves the loop. 'play' only gets
      // here after the UI has confirmed abandoning the song.
      case 'select':
      case 'play':
      case 'results':
        get().endSession()
        return

      // Home is not a session screen -- the scene stack owns Back there.
      case 'idle':
        return
    }
  },

  playJukeboxNow: (song) => {
    if (!song.isPlayable) return
    const state = get()
    const current = state.phase === 'jukebox' ? state.selectedSong : null
    startJukeboxSong(song, { jukeboxHistory: withHistory(state.jukeboxHistory, current) })
  },

  queueJukeboxSong: (song) => {
    if (!song.isPlayable) return
    // Nothing is playing because the queue ran out: the new song plays straight away.
    if (get().phase === 'jukebox' && get().jukeboxFinished) {
      startJukeboxSong(song)
      return
    }
    set((state) => ({ jukeboxQueue: [...state.jukeboxQueue, song] }))
  },

  removeFromJukeboxQueue: (index) => {
    set((state) => ({ jukeboxQueue: state.jukeboxQueue.filter((_, i) => i !== index) }))
  },

  shuffleIntoJukeboxQueue: (songs) => {
    set({ jukeboxQueue: shuffled(songs.filter((song) => song.isPlayable)) })
  },

  nextJukeboxSong: () => advanceJukebox(false),

  jukeboxSongEnded: () => advanceJukebox(true),

  previousJukeboxSong: (elapsedSec) => {
    const state = get()
    if (state.phase !== 'jukebox' || !state.selectedSong) return 'restart'
    const step = previousStep(jukeboxOrder(state), elapsedSec)
    if (step.kind === 'restart') return 'restart'
    startJukeboxSong(step.song, { jukeboxQueue: step.queue, jukeboxHistory: step.history })
    return 'previous'
  },

  moveJukeboxQueueItem: (index, delta) => {
    set((state) => ({ jukeboxQueue: moveQueueItem(state.jukeboxQueue, index, delta) }))
  },

  clearJukeboxQueue: () => {
    if (get().jukeboxQueue.length > 0) set({ jukeboxQueue: [] })
  },

  setJukeboxShuffle: (on) => {
    set((state) => ({ jukeboxShuffle: on, jukeboxQueue: on ? shuffled(state.jukeboxQueue) : state.jukeboxQueue }))
    persistJukeboxPrefs()
  },

  cycleJukeboxRepeat: () => {
    set((state) => ({ jukeboxRepeat: nextRepeat(state.jukeboxRepeat) }))
    persistJukeboxPrefs()
  },

  setJukeboxAutoplay: (on) => {
    set({ jukeboxAutoplay: on })
    persistJukeboxPrefs()
  },

  jukeboxBackToList: () => {
    set((state) => ({
      phase: 'select',
      selectedSong: null,
      jukeboxMenuOpen: false,
      jukeboxFinished: false,
      jukeboxHistory: withHistory(state.jukeboxHistory, state.phase === 'jukebox' ? state.selectedSong : null),
    }))
    goToPhase('select')
  },

  setJukeboxMenuOpen: (open) => {
    if (get().jukeboxMenuOpen !== open) set({ jukeboxMenuOpen: open })
  },
}))

/**
 * Put a song on the jukebox stage. Counted when it starts: a jukebox song is
 * "played" whether or not it is skipped later. A new play id remounts the
 * stage, so the same song twice in a row starts from the top.
 */
function startJukeboxSong(song: LibrarySong, patch: Partial<SessionStoreState & JukeboxPlayerState> = {}) {
  recordPlay(song.path, 'jukebox')
  useSessionStore.setState((state) => ({
    ...patch,
    selectedSong: song,
    phase: 'jukebox',
    jukeboxMenuOpen: false,
    jukeboxFinished: false,
    jukeboxCycle: withCycle(patch.jukeboxCycle ?? state.jukeboxCycle, song),
    jukeboxPlayId: state.jukeboxPlayId + 1,
  }))
  goToPhase('jukebox')
}

/** Next (a skip) or the end of a song (`ended`): see queueLogic.nextStep. */
function advanceJukebox(ended: boolean) {
  const state = useSessionStore.getState()
  const current = state.phase === 'jukebox' ? state.selectedSong : null
  const step = nextStep(jukeboxOrder(state), { ended, pool: autoplayPool() })

  if (step.kind === 'finished') {
    // On the song list there is nothing to finish; it just stays where it is.
    if (state.phase !== 'jukebox') return
    useSessionStore.setState({
      selectedSong: null,
      jukeboxFinished: true,
      jukeboxMenuOpen: false,
      jukeboxHistory: withHistory(state.jukeboxHistory, current),
    })
    return
  }

  startJukeboxSong(step.song, {
    jukeboxQueue: step.queue,
    jukeboxCycle: step.cycle,
    jukeboxHistory: step.replay ? state.jukeboxHistory : withHistory(state.jukeboxHistory, current),
  })
}

function persistJukeboxPrefs() {
  const { jukeboxShuffle, jukeboxRepeat, jukeboxAutoplay } = useSessionStore.getState()
  saveJukeboxPrefs({ shuffle: jukeboxShuffle, repeat: jukeboxRepeat, autoplay: jukeboxAutoplay })
}
