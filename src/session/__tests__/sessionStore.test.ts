import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSessionStore, isSessionScene } from '../sessionStore'
import { useSceneStore } from '../../scenes/sceneStore'
import { useMicHealthStore } from '../../game/state/useMicHealthStore'
import type { LibrarySong } from '../../library/types'
import type { SessionSongResult } from '../types'

const SONG: LibrarySong = {
  path: '/library/song',
  artist: 'Nova Lane',
  title: 'Paper Satellites',
  durationMs: 180000,
  thumbnailPath: null,
  mp3Path: '/library/song/song.mp3',
  videoPath: null,
  bpm: 250,
  gap: 24065,
  hasVideo: true,
  hasCover: true,
  isDuet: false,
  isPlayable: true,
  addedAt: 1,
}

const RESULT: SessionSongResult[] = [{ playerId: 'p1', score: 4200, epicCount: 5, goodCount: 2, awfulCount: 1, bestLine: 'Wake' }]
const MULTI_RESULT: SessionSongResult[] = [
  { playerId: 'p1', score: 4200, epicCount: 5, goodCount: 2, awfulCount: 1, bestLine: 'Wake' },
  { playerId: 'p2', score: 3100, epicCount: 3, goodCount: 4, awfulCount: 0, bestLine: 'Yeah' },
]

describe('useSessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({
      phase: 'idle',
      sessionId: null,
      selectedSong: null,
      assignedPlayerIds: [],
      lastResult: null,
      songsPlayedThisSession: 0,
    })
    useSceneStore.setState({ current: 'home', history: [] })
    useMicHealthStore.setState({ byPlayerId: {} })
    window.api = {
      session: {
        start: vi.fn().mockResolvedValue({ id: 's1', startedAt: 1 }),
        recordEntry: vi.fn(),
        listLeaderboard: vi.fn(),
      },
    } as unknown as Window['api']
  })

  it('starts on idle', () => {
    expect(useSessionStore.getState().phase).toBe('idle')
  })

  it('startSession calls the session:start IPC, stores sessionId, and moves to select', async () => {
    await useSessionStore.getState().startSession()
    expect(window.api!.session.start).toHaveBeenCalled()
    expect(useSessionStore.getState().sessionId).toBe('s1')
    expect(useSessionStore.getState().phase).toBe('select')
  })

  // "Start a night" used to do nothing at all when the session database had
  // failed to open: the IPC rejected, startSession threw, and nobody caught it.
  it('startSession still starts the night, unrecorded, when the session database is unavailable', async () => {
    vi.mocked(window.api!.session.start).mockRejectedValue(new Error('no database'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await useSessionStore.getState().startSession()

    expect(useSessionStore.getState().sessionId).toBeNull()
    expect(useSessionStore.getState().phase).toBe('select')
    expect(useSceneStore.getState().current).toBe('session-select')
    consoleError.mockRestore()
  })

  it('startSession starts a fresh night: no result, sing counts or song tally from the last one', async () => {
    useSessionStore.setState({
      lastResult: RESULT,
      songsPlayedThisSession: 4,
      sessionSingCounts: { p1: 3 },
      selectedSong: SONG,
      assignedPlayerIds: ['p1'],
    })

    await useSessionStore.getState().startSession()

    const state = useSessionStore.getState()
    expect(state.lastResult).toBeNull()
    expect(state.songsPlayedThisSession).toBe(0)
    expect(state.sessionSingCounts).toEqual({})
    expect(state.selectedSong).toBeNull()
    expect(state.assignedPlayerIds).toEqual([])
  })

  it('pickSong sets selectedSong and moves to assign', () => {
    useSessionStore.getState().pickSong(SONG)
    expect(useSessionStore.getState().selectedSong).toEqual(SONG)
    expect(useSessionStore.getState().phase).toBe('assign')
  })

  it('assignPlayers sets assignedPlayerIds and moves to the song-start transition, not straight to play', () => {
    useSessionStore.getState().assignPlayers(['p1'])
    expect(useSessionStore.getState().assignedPlayerIds).toEqual(['p1'])
    expect(useSessionStore.getState().phase).toBe('starting')
  })

  it('assignPlayers accepts multiple player ids', () => {
    useSessionStore.getState().assignPlayers(['p1', 'p2'])
    expect(useSessionStore.getState().assignedPlayerIds).toEqual(['p1', 'p2'])
    expect(useSessionStore.getState().phase).toBe('starting')
  })

  it('beginSong moves from the song-start transition into play', () => {
    useSessionStore.getState().assignPlayers(['p1'])
    useSessionStore.getState().beginSong()
    expect(useSessionStore.getState().phase).toBe('play')
  })

  it('finishSong sets lastResult, increments songsPlayedThisSession, and moves to results', () => {
    useSessionStore.getState().finishSong(RESULT)
    const state = useSessionStore.getState()
    expect(state.lastResult).toEqual(RESULT)
    expect(state.songsPlayedThisSession).toBe(1)
    expect(state.phase).toBe('results')
  })

  it('finishSong accepts a result per assigned player', () => {
    useSessionStore.getState().finishSong(MULTI_RESULT)
    const state = useSessionStore.getState()
    expect(state.lastResult).toEqual(MULTI_RESULT)
    expect(state.songsPlayedThisSession).toBe(1)
    expect(state.phase).toBe('results')
  })

  it('playAgain resets selectedSong/assignedPlayerIds and returns to select, keeping the same sessionId', async () => {
    await useSessionStore.getState().startSession()
    useSessionStore.setState({ selectedSong: SONG, assignedPlayerIds: ['p1'] })
    useSessionStore.getState().playAgain()
    const state = useSessionStore.getState()
    expect(state.selectedSong).toBeNull()
    expect(state.assignedPlayerIds).toEqual([])
    expect(state.phase).toBe('select')
    expect(state.sessionId).toBe('s1') // same party session, not a new one
  })

  it('viewLeaderboard moves to leaderboard', () => {
    useSessionStore.getState().viewLeaderboard()
    expect(useSessionStore.getState().phase).toBe('leaderboard')
  })

  it('endSession resets everything to the initial idle state, including sessionId', async () => {
    await useSessionStore.getState().startSession()
    useSessionStore.setState({ phase: 'leaderboard', selectedSong: SONG, assignedPlayerIds: ['p1'], lastResult: RESULT, songsPlayedThisSession: 3 })
    useSessionStore.getState().endSession()
    expect(useSessionStore.getState()).toMatchObject({
      phase: 'idle',
      sessionId: null,
      selectedSong: null,
      assignedPlayerIds: [],
      lastResult: null,
      songsPlayedThisSession: 0,
    })
  })

  /**
   * The piece of song teardown that has no unmount cleanup behind it.
   *
   * A lane clears its own mic-health entry when it unmounts, so the ordinary
   * end of a song is covered. What is not is every path where the lane never
   * got that far -- a chart that failed to load mid-song, a singer still
   * `starting` when the song was abandoned. Left behind, those entries are read
   * by the *next* song's lane and shown as "Microphone not running" over a mic
   * that is fine.
   */
  it('endSession clears the mic-health board the song left behind', () => {
    useMicHealthStore.getState().report('p1', 'no-capture', 'device-1')
    useMicHealthStore.getState().report('p2', 'ok', 'device-2')
    useSessionStore.setState({ phase: 'play', selectedSong: SONG, assignedPlayerIds: ['p1', 'p2'] })

    useSessionStore.getState().endSession()

    expect(useMicHealthStore.getState().byPlayerId).toEqual({})
  })

  // Cheap-by-default: `reset()` mints a fresh object and notifies every
  // subscriber, and endSession is also the plain "Back out of the song list"
  // path, where nothing has ever been reported.
  it('leaves an already-empty mic-health board untouched rather than re-notifying', () => {
    const before = useMicHealthStore.getState().byPlayerId

    useSessionStore.getState().endSession()

    expect(useMicHealthStore.getState().byPlayerId).toBe(before)
  })

  // ---- Back -------------------------------------------------------
  // Back inside the party loop must move the *machine*, not pop the scene
  // stack behind its back -- popping session-assign -> session-select while
  // leaving phase on 'assign' would desynchronise the two.
  describe('back()', () => {
    it('is the machine that moves, so phase and scene stay in step', () => {
      useSessionStore.getState().pickSong(SONG)
      expect(useSceneStore.getState().current).toBe('session-assign')

      useSessionStore.getState().back()

      expect(useSessionStore.getState().phase).toBe('select')
      expect(useSceneStore.getState().current).toBe('session-select')
    })

    it('back() from assign clears the picked song so the select screen is honest', () => {
      useSessionStore.getState().pickSong(SONG)
      useSessionStore.getState().back()
      expect(useSessionStore.getState().selectedSong).toBeNull()
      expect(useSessionStore.getState().assignedPlayerIds).toEqual([])
    })

    it('back() from the song-start transition returns to assign, keeping song and singers', () => {
      useSessionStore.getState().pickSong(SONG)
      useSessionStore.getState().assignPlayers(['p1', 'p2'])

      useSessionStore.getState().back()

      const state = useSessionStore.getState()
      expect(state.phase).toBe('assign')
      expect(state.selectedSong).toEqual(SONG)
      expect(state.assignedPlayerIds).toEqual(['p1', 'p2'])
      expect(useSceneStore.getState().current).toBe('session-assign')
    })

    it('back() from select leaves the party loop entirely (there is no earlier phase)', async () => {
      await useSessionStore.getState().startSession()
      useSessionStore.getState().back()
      expect(useSessionStore.getState().phase).toBe('idle')
      expect(useSessionStore.getState().sessionId).toBeNull()
      expect(useSceneStore.getState().current).toBe('home')
    })

    // Abandoning mid-song must reset the machine, never leave it parked on
    // 'play' with no song running. The *confirmation* lives in the UI; the
    // store's job is to land somewhere clean.
    it('back() from play ends the session rather than leaving the machine mid-song', () => {
      useSessionStore.getState().pickSong(SONG)
      useSessionStore.getState().assignPlayers(['p1'])
      useSessionStore.getState().beginSong()

      useSessionStore.getState().back()

      expect(useSessionStore.getState().phase).toBe('idle')
      expect(useSessionStore.getState().selectedSong).toBeNull()
      expect(useSceneStore.getState().current).toBe('home')
    })

    it('back() from results ends the night -- the song is already over, there is no going back into it', () => {
      useSessionStore.getState().finishSong(RESULT)
      useSessionStore.getState().back()
      expect(useSessionStore.getState().phase).toBe('idle')
    })

    it('back() from the leaderboard returns to the results it was opened from', () => {
      useSessionStore.getState().finishSong(RESULT)
      useSessionStore.getState().viewLeaderboard()

      useSessionStore.getState().back()

      expect(useSessionStore.getState().phase).toBe('results')
      expect(useSceneStore.getState().current).toBe('session-results')
    })

    it('back() from a leaderboard opened with no result behind it ends the night instead', () => {
      useSessionStore.getState().viewLeaderboard()
      useSessionStore.getState().back()
      expect(useSessionStore.getState().phase).toBe('idle')
    })

    it('back() while idle does nothing -- Home is not a session screen', () => {
      useSceneStore.setState({ current: 'players', history: [] })
      useSessionStore.getState().back()
      expect(useSessionStore.getState().phase).toBe('idle')
      expect(useSceneStore.getState().current).toBe('players')
    })
  })

  describe('party mode machine', () => {
    it('startSession(party) moves directly to party-draw phase and scene', async () => {
      await useSessionStore.getState().startSession('party')
      expect(useSessionStore.getState().mode).toBe('party')
      expect(useSessionStore.getState().phase).toBe('party-draw')
      expect(useSceneStore.getState().current).toBe('session-party-draw')
    })

    it('setMode toggles between classic and party on the selection screens', () => {
      useSessionStore.setState({ phase: 'select', mode: 'classic' })
      useSessionStore.getState().setMode('party')
      expect(useSessionStore.getState().mode).toBe('party')
      expect(useSessionStore.getState().phase).toBe('party-draw')
      expect(useSceneStore.getState().current).toBe('session-party-draw')

      useSessionStore.getState().setMode('classic')
      expect(useSessionStore.getState().mode).toBe('classic')
      expect(useSessionStore.getState().phase).toBe('select')
      expect(useSceneStore.getState().current).toBe('session-select')
    })

    it('confirmPartyDraw sets song, players, and transitions to starting', () => {
      useSessionStore.setState({ phase: 'party-draw', mode: 'party' })
      useSessionStore.getState().confirmPartyDraw(SONG, ['p1', 'p2'])

      const state = useSessionStore.getState()
      expect(state.selectedSong).toEqual(SONG)
      expect(state.assignedPlayerIds).toEqual(['p1', 'p2'])
      expect(state.phase).toBe('starting')
      expect(useSceneStore.getState().current).toBe('session-starting')
    })

    it('playAgain in party mode returns to party-draw and retains sessionSingCounts', async () => {
      await useSessionStore.getState().startSession('party')
      expect(useSessionStore.getState().sessionSingCounts).toEqual({})

      useSessionStore.getState().confirmPartyDraw(SONG, ['p1', 'p2'])
      useSessionStore.getState().beginSong()
      useSessionStore.getState().finishSong(RESULT)

      expect(useSessionStore.getState().sessionSingCounts).toEqual({ p1: 1, p2: 1 })

      useSessionStore.getState().playAgain()
      const state = useSessionStore.getState()
      expect(state.selectedSong).toBeNull()
      expect(state.assignedPlayerIds).toEqual([])
      expect(state.phase).toBe('party-draw')
      expect(useSceneStore.getState().current).toBe('session-party-draw')
      // sessionSingCounts survived playAgain!
      expect(state.sessionSingCounts).toEqual({ p1: 1, p2: 1 })
    })

    it('back() from party-draw ends the session and returns home', () => {
      useSessionStore.setState({ phase: 'party-draw', mode: 'party' })
      useSessionStore.getState().back()
      expect(useSessionStore.getState().phase).toBe('idle')
      expect(useSceneStore.getState().current).toBe('home')
    })

    it('back() from starting in party mode returns to party-draw', () => {
      useSessionStore.setState({ phase: 'starting', mode: 'party' })
      useSessionStore.getState().back()
      expect(useSessionStore.getState().phase).toBe('party-draw')
      expect(useSceneStore.getState().current).toBe('session-party-draw')
    })

    it('setMode to Versus (battle) updates mode and transitions from party-draw to select', () => {
      useSessionStore.setState({ phase: 'party-draw', mode: 'party' })
      useSessionStore.getState().setMode('battle')
      expect(useSessionStore.getState().mode).toBe('battle')
      expect(useSessionStore.getState().phase).toBe('select')

      useSessionStore.getState().setMode('classic')
      expect(useSessionStore.getState().mode).toBe('classic')
      expect(useSessionStore.getState().phase).toBe('select')
    })

    it('setMode to Versus trims a line-up of more than two to its first two picks', () => {
      useSessionStore.setState({ phase: 'select', mode: 'classic', assignedPlayerIds: ['p1', 'p2', 'p3'] })
      useSessionStore.getState().setMode('battle')
      expect(useSessionStore.getState().mode).toBe('battle')
      expect(useSessionStore.getState().assignedPlayerIds).toEqual(['p1', 'p2'])
      useSessionStore.getState().setMode('classic')
    })

    it('assignPlayers in Versus starts only a one-against-one line-up', () => {
      useSessionStore.setState({ phase: 'assign', mode: 'battle', selectedSong: SONG, assignedPlayerIds: [] })

      useSessionStore.getState().assignPlayers(['p1'])
      expect(useSessionStore.getState().phase).toBe('assign')
      expect(useSessionStore.getState().assignedPlayerIds).toEqual([])

      useSessionStore.getState().assignPlayers(['p1', 'p2', 'p3'])
      expect(useSessionStore.getState().phase).toBe('starting')
      expect(useSessionStore.getState().assignedPlayerIds).toEqual(['p1', 'p2'])
      useSessionStore.setState({ mode: 'classic' })
    })
  })

  describe('isSessionScene', () => {
    it.each(['session-select', 'session-assign', 'session-party-draw', 'session-starting', 'session-play', 'session-results', 'session-leaderboard'] as const)(
      "treats '%s' as a session-machine scene",
      (scene) => {
        expect(isSessionScene(scene)).toBe(true)
      },
    )

    it.each(['home', 'players', 'settings', 'lab-session'] as const)("treats '%s' as a plain scene", (scene) => {
      expect(isSessionScene(scene)).toBe(false)
    })
  })
})
