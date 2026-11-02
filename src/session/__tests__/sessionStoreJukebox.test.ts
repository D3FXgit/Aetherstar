import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JUKEBOX_SCENE, interceptSessionBack, isSessionScene, useSessionStore } from '../sessionStore'
import { useSceneStore } from '../../scenes/sceneStore'
import { useLibraryStore } from '../../library/useLibraryStore'
import type { LibrarySong } from '../../library/types'

// The real registration pulls in every scene in the app; the store only needs it to resolve.
vi.mock('../../jukebox/registerJukeboxScene', () => ({}))

const SONG: LibrarySong = {
  path: '/library/song',
  artist: 'Nova Lane',
  title: 'Paper Satellites',
  durationMs: 180000,
  thumbnailPath: null,
  mp3Path: '/library/song/song.mp3',
  videoPath: null,
  bpm: 250,
  gap: 0,
  hasVideo: false,
  hasCover: false,
  isDuet: false,
  isPlayable: true,
  addedAt: 1,
}
const SONG_2: LibrarySong = { ...SONG, path: '/library/two', title: 'Two' }
const SONG_3: LibrarySong = { ...SONG, path: '/library/three', title: 'Three' }
const UNPLAYABLE: LibrarySong = { ...SONG, path: '/library/broken', isPlayable: false }

describe('the jukebox', () => {
  beforeEach(async () => {
    localStorage.clear()
    useSceneStore.setState({ current: 'home', history: [] })
    window.api = {
      session: { start: vi.fn().mockResolvedValue({ id: 's1', startedAt: 1 }), recordEntry: vi.fn(), listLeaderboard: vi.fn() },
      library: { recordPlay: vi.fn().mockResolvedValue(true) },
    } as unknown as Window['api']
    await useSessionStore.getState().startJukebox()
  })

  it('opens the song list in jukebox mode, without a scored session', () => {
    expect(useSessionStore.getState()).toMatchObject({ mode: 'jukebox', phase: 'select', sessionId: null, jukeboxQueue: [] })
    expect(useSceneStore.getState().current).toBe('session-select')
    expect(window.api!.session.start).not.toHaveBeenCalled()
  })

  it('plays a picked song straight away, with no singer assignment, and counts the play', () => {
    useSessionStore.getState().pickSong(SONG)

    expect(useSessionStore.getState()).toMatchObject({ phase: 'jukebox', selectedSong: SONG, jukeboxMenuOpen: false })
    expect(useSceneStore.getState().current).toBe(JUKEBOX_SCENE)
    expect(isSessionScene(JUKEBOX_SCENE)).toBe(true)
    expect(window.api!.library.recordPlay).toHaveBeenCalledWith('/library/song', 'jukebox')
  })

  it('plays the queue back to back, then shows "Queue finished" when autoplay is off', () => {
    const store = useSessionStore.getState()
    store.setJukeboxAutoplay(false)
    store.queueJukeboxSong(SONG_2)
    store.queueJukeboxSong(UNPLAYABLE)
    store.queueJukeboxSong(SONG_3)
    store.playJukeboxNow(SONG)
    const firstPlay = useSessionStore.getState().jukeboxPlayId

    expect(useSessionStore.getState().jukeboxQueue).toEqual([SONG_2, SONG_3])
    useSessionStore.getState().nextJukeboxSong()
    expect(useSessionStore.getState()).toMatchObject({ selectedSong: SONG_2, jukeboxQueue: [SONG_3] })
    expect(useSessionStore.getState().jukeboxPlayId).toBe(firstPlay + 1)
    useSessionStore.getState().nextJukeboxSong()
    useSessionStore.getState().nextJukeboxSong()

    // The jukebox stays put with its finished card; leaving is the card's (or Back's) call.
    expect(useSessionStore.getState()).toMatchObject({ phase: 'jukebox', selectedSong: null, jukeboxFinished: true })
    expect(useSceneStore.getState().current).toBe(JUKEBOX_SCENE)
    useSessionStore.getState().jukeboxBackToList()
    expect(useSessionStore.getState()).toMatchObject({ phase: 'select', selectedSong: null, jukeboxFinished: false })
    expect(useSceneStore.getState().current).toBe('session-select')
  })

  it('removes and shuffles queue entries', () => {
    const store = useSessionStore.getState()
    store.shuffleIntoJukeboxQueue([SONG, UNPLAYABLE, SONG_2, SONG_3])
    expect(useSessionStore.getState().jukeboxQueue.map((song) => song.path).sort()).toEqual(
      ['/library/song', '/library/three', '/library/two'],
    )
    useSessionStore.getState().removeFromJukeboxQueue(0)
    expect(useSessionStore.getState().jukeboxQueue).toHaveLength(2)
  })

  it('Back over a song toggles the menu instead of leaving', () => {
    useSessionStore.getState().playJukeboxNow(SONG)

    useSessionStore.getState().back()
    expect(useSessionStore.getState()).toMatchObject({ phase: 'jukebox', jukeboxMenuOpen: true })
    useSessionStore.getState().back()
    expect(useSessionStore.getState().jukeboxMenuOpen).toBe(false)

    useSessionStore.getState().setJukeboxMenuOpen(true)
    useSessionStore.getState().jukeboxBackToList()
    expect(useSessionStore.getState()).toMatchObject({ phase: 'select', jukeboxMenuOpen: false })
  })

  it('Back from the list ends the jukebox like any night', () => {
    useSessionStore.getState().queueJukeboxSong(SONG)
    useSessionStore.getState().back()
    expect(useSessionStore.getState()).toMatchObject({ phase: 'idle', mode: 'classic', jukeboxQueue: [] })
    expect(useSceneStore.getState().current).toBe('home')
  })

  it('is never switched into or out of from the mode tabs', () => {
    useSessionStore.getState().setMode('party')
    expect(useSessionStore.getState()).toMatchObject({ mode: 'jukebox', phase: 'select' })
  })

  it('startSession("jukebox") is the same as startJukebox', async () => {
    await useSessionStore.getState().startSession('classic')
    await useSessionStore.getState().startSession('jukebox')
    expect(useSessionStore.getState()).toMatchObject({ mode: 'jukebox', phase: 'select' })
  })
})

describe('play history from sung songs', () => {
  it('counts a finished sung song once, whatever the number of singers', async () => {
    useSceneStore.setState({ current: 'home', history: [] })
    window.api = {
      session: { start: vi.fn().mockResolvedValue({ id: 's1', startedAt: 1 }), recordEntry: vi.fn(), listLeaderboard: vi.fn() },
      library: { recordPlay: vi.fn().mockResolvedValue(true) },
    } as unknown as Window['api']
    await useSessionStore.getState().startSession('battle')
    useSessionStore.getState().pickSong(SONG)
    useSessionStore.getState().assignPlayers(['p1', 'p2'])
    useSessionStore.getState().beginSong()

    useSessionStore.getState().finishSong([
      { playerId: 'p1', score: 1, epicCount: 0, goodCount: 0, awfulCount: 0, bestLine: null },
      { playerId: 'p2', score: 2, epicCount: 0, goodCount: 0, awfulCount: 0, bestLine: null },
    ])

    expect(window.api!.library.recordPlay).toHaveBeenCalledTimes(1)
    expect(window.api!.library.recordPlay).toHaveBeenCalledWith('/library/song', 'battle')
  })
})

describe('interceptSessionBack', () => {
  it('lets an open overlay take Back, until it lets go', () => {
    useSessionStore.setState({ phase: 'assign', mode: 'classic', selectedSong: SONG })
    const handler = vi.fn(() => true)
    const release = interceptSessionBack(handler)

    useSessionStore.getState().back()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(useSessionStore.getState().phase).toBe('assign')

    release()
    useSessionStore.getState().back()
    expect(useSessionStore.getState().phase).toBe('select')
  })
})

describe('jukebox player controls', () => {
  const SONG_4: LibrarySong = { ...SONG, path: '/library/four', title: 'Four' }
  const paths = (songs: LibrarySong[]) => songs.map((song) => song.path)

  beforeEach(async () => {
    localStorage.clear()
    useSceneStore.setState({ current: 'home', history: [] })
    useLibraryStore.setState({ searchBase: null, results: [] })
    window.api = {
      session: { start: vi.fn(), recordEntry: vi.fn(), listLeaderboard: vi.fn() },
      library: { recordPlay: vi.fn().mockResolvedValue(true) },
    } as unknown as Window['api']
    await useSessionStore.getState().startJukebox()
  })

  it('starts with autoplay on, shuffle off and Repeat off', () => {
    expect(useSessionStore.getState()).toMatchObject({ jukeboxAutoplay: true, jukeboxShuffle: false, jukeboxRepeat: 'off' })
  })

  it('Previous steps back through what played, and Next comes forward again', () => {
    const store = useSessionStore.getState()
    store.queueJukeboxSong(SONG_2)
    store.playJukeboxNow(SONG)
    useSessionStore.getState().nextJukeboxSong()
    expect(useSessionStore.getState().selectedSong).toBe(SONG_2)

    expect(useSessionStore.getState().previousJukeboxSong(1)).toBe('previous')
    expect(useSessionStore.getState()).toMatchObject({ selectedSong: SONG, jukeboxQueue: [SONG_2], jukeboxHistory: [] })

    useSessionStore.getState().nextJukeboxSong()
    expect(useSessionStore.getState().selectedSong).toBe(SONG_2)
  })

  it('Previous past the first three seconds (or with nothing before) is a restart, left to the caller', () => {
    const store = useSessionStore.getState()
    store.playJukeboxNow(SONG)
    const playId = useSessionStore.getState().jukeboxPlayId
    expect(useSessionStore.getState().previousJukeboxSong(0)).toBe('restart')
    useSessionStore.getState().playJukeboxNow(SONG_2)
    expect(useSessionStore.getState().previousJukeboxSong(12)).toBe('restart')
    expect(useSessionStore.getState().selectedSong).toBe(SONG_2)
    expect(useSessionStore.getState().jukeboxPlayId).toBe(playId + 1)
  })

  it('Repeat one replays the song when it ends, and a skip still moves on', () => {
    const store = useSessionStore.getState()
    store.queueJukeboxSong(SONG_2)
    store.playJukeboxNow(SONG)
    store.cycleJukeboxRepeat()
    useSessionStore.getState().cycleJukeboxRepeat()
    expect(useSessionStore.getState().jukeboxRepeat).toBe('one')

    const playId = useSessionStore.getState().jukeboxPlayId
    useSessionStore.getState().jukeboxSongEnded()
    // Same song, a new play (the stage remounts and starts from the top).
    expect(useSessionStore.getState()).toMatchObject({ selectedSong: SONG, jukeboxPlayId: playId + 1, jukeboxQueue: [SONG_2] })

    useSessionStore.getState().nextJukeboxSong()
    expect(useSessionStore.getState().selectedSong).toBe(SONG_2)
  })

  it('Repeat all loops back to the first song once the queue runs out', () => {
    const store = useSessionStore.getState()
    store.setJukeboxAutoplay(false)
    store.cycleJukeboxRepeat()
    store.queueJukeboxSong(SONG_2)
    store.queueJukeboxSong(SONG_3)
    store.playJukeboxNow(SONG)
    useSessionStore.getState().jukeboxSongEnded()
    useSessionStore.getState().jukeboxSongEnded()
    expect(useSessionStore.getState().selectedSong).toBe(SONG_3)

    useSessionStore.getState().jukeboxSongEnded()
    expect(useSessionStore.getState()).toMatchObject({ selectedSong: SONG, jukeboxFinished: false })
    expect(paths(useSessionStore.getState().jukeboxQueue)).toEqual([SONG_2.path, SONG_3.path])
  })

  it('autoplay keeps going with a random library song when the queue runs out', () => {
    useLibraryStore.setState({ searchBase: { key: 'k', songs: [SONG, SONG_2, UNPLAYABLE] } })
    useSessionStore.getState().playJukeboxNow(SONG)
    useSessionStore.getState().jukeboxSongEnded()
    expect(useSessionStore.getState()).toMatchObject({ selectedSong: SONG_2, jukeboxFinished: false, phase: 'jukebox' })
  })

  it('shows "Queue finished" when autoplay has nothing to pick, and a song added then plays at once', () => {
    useSessionStore.getState().playJukeboxNow(SONG)
    useSessionStore.getState().nextJukeboxSong()
    expect(useSessionStore.getState()).toMatchObject({ jukeboxFinished: true, selectedSong: null, phase: 'jukebox' })

    useSessionStore.getState().queueJukeboxSong(SONG_3)
    expect(useSessionStore.getState()).toMatchObject({ jukeboxFinished: false, selectedSong: SONG_3, jukeboxQueue: [] })
  })

  it('turning shuffle on shuffles the queue; songs added while playing only join the queue', () => {
    const store = useSessionStore.getState()
    store.playJukeboxNow(SONG)
    const playId = useSessionStore.getState().jukeboxPlayId
    for (const song of [SONG_2, SONG_3, SONG_4]) useSessionStore.getState().queueJukeboxSong(song)
    expect(useSessionStore.getState()).toMatchObject({ selectedSong: SONG, jukeboxPlayId: playId })

    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      useSessionStore.getState().setJukeboxShuffle(true)
    } finally {
      random.mockRestore()
    }
    expect(paths(useSessionStore.getState().jukeboxQueue)).toEqual([SONG_3.path, SONG_4.path, SONG_2.path])
    expect(useSessionStore.getState().jukeboxShuffle).toBe(true)
    expect(useSessionStore.getState().jukeboxPlayId).toBe(playId)
  })

  it('moves and clears queued songs', () => {
    const store = useSessionStore.getState()
    for (const song of [SONG_2, SONG_3, SONG_4]) store.queueJukeboxSong(song)
    useSessionStore.getState().moveJukeboxQueueItem(2, -1)
    expect(paths(useSessionStore.getState().jukeboxQueue)).toEqual([SONG_2.path, SONG_4.path, SONG_3.path])
    useSessionStore.getState().clearJukeboxQueue()
    expect(useSessionStore.getState().jukeboxQueue).toEqual([])
  })

  it('remembers Shuffle, Repeat and autoplay for the next jukebox night', async () => {
    const store = useSessionStore.getState()
    store.setJukeboxShuffle(true)
    store.cycleJukeboxRepeat()
    store.setJukeboxAutoplay(false)
    useSessionStore.getState().endSession()
    expect(useSessionStore.getState().jukeboxAutoplay).toBe(true)

    await useSessionStore.getState().startJukebox()
    expect(useSessionStore.getState()).toMatchObject({ jukeboxShuffle: true, jukeboxRepeat: 'all', jukeboxAutoplay: false })
  })
})
