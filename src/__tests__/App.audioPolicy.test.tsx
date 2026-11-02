import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import App from '../App'
import { useSceneStore } from '../scenes/sceneStore'
import { createWebAudioManager } from '../audio/webAudioManager'
import { menuSongUrl } from '../audio/menuTrack'
import {
  useSongPreviewStore,
  MENU_MUSIC_STOP_MS,
  PREVIEW_BROWSE_FADE_MS,
  PREVIEW_CROSSFADE_MS,
  PREVIEW_HANDOVER_MS,
  PREVIEW_LAUNCH_FADE_MS,
} from '../audio/songPreviewStore'
import { JUKEBOX_SCENE, useSessionStore } from '../session/sessionStore'
import { RESULTS_BED_FADE_IN_MS, RESULTS_BED_FADE_OUT_MS } from '../audio/resultsBed'
import { useAppPreferencesStore } from '../settings/appPreferencesStore'
import { useLibraryStore } from '../library/useLibraryStore'
import { toLibraryMediaUrl } from '../library/mediaUrl'
import type { LibrarySong } from '../library/types'
import type { AudioManager, PlayOptions, TransferredTrack } from '../audio/audioManagerContract'
import {
  MENU_SONG_CROSSFADE_MS,
  MENU_SONG_FADE_IN_MS,
  resetMenuMusicForTests,
  useMenuMusicStore,
} from '../audio/menuMusic'

vi.mock('../audio/webAudioManager')

// One stub for the whole file: useWebAudioManager caches its engine in a module
// variable, so only the first test here actually constructs one.
const engine = {
  play: vi.fn(),
  duckTo: vi.fn(),
  restore: vi.fn(),
  crossfadeTo: vi.fn(),
  stop: vi.fn(),
  // Nothing to hand over unless a test says otherwise.
  transfer: vi.fn<NonNullable<AudioManager['transfer']>>(() => null),
}

/**
 * Every play() made on `bus` for `url`, whatever else the manager forwards
 * after those two (it grew an optional options argument; this policy test is
 * about *what* plays on *which* bus, not about per-track options).
 */
function playsOf(url: string, bus: string) {
  return engine.play.mock.calls.filter((call) => call[0] === url && call[1] === bus)
}

const PREVIEW_A = 'aetherstar-media://roots/library/apple/song.mp3'
const PREVIEW_B = 'aetherstar-media://roots/library/banana/song.mp3'

function resetShell() {
  useSceneStore.setState({ current: 'home' })
  useSongPreviewStore.setState({ track: null, previewStartSec: null, loop: true, endedTrack: null })
  useLibraryStore.setState({ searchBase: null, filters: {} })
  resetMenuMusicForTests()
  delete window.api
  vi.mocked(createWebAudioManager).mockClear()
  Object.values(engine).forEach((fn) => fn.mockClear())
  engine.transfer.mockImplementation(() => null)
  vi.mocked(createWebAudioManager).mockReturnValue(engine)
}

// The policy below is the one the bundled loop has always had (ducked under
// gameplay, restored after); the library-song rotation, the default, has its
// own block further down.
describe('App -- scene-driven Audio Manager policy', () => {
  beforeEach(() => {
    resetShell()
    useAppPreferencesStore.setState({ menuMusicMode: 'builtin' })
  })

  it('plays the menu track once on reaching a non-gameplay scene, ducks on entering gameplay, restores on returning', () => {
    act(() => {
      render(<App />)
    })
    expect(playsOf(menuSongUrl, 'music').length).toBeGreaterThan(0)
    expect(engine.play).toHaveBeenCalledOnce()

    act(() => useSceneStore.setState({ current: 'players' }))
    expect(engine.play).toHaveBeenCalledOnce()
    expect(engine.duckTo).not.toHaveBeenCalled()

    act(() => useSceneStore.setState({ current: 'session-play' }))
    expect(engine.duckTo.mock.calls[0][0]).toBe(0)

    act(() => useSceneStore.setState({ current: 'home' }))
    expect(engine.restore).toHaveBeenCalledOnce()
    expect(engine.play).toHaveBeenCalledOnce()
  })

  // The user-facing requirement: "the main menu music must persist smoothly
  // across screens". Persisting means the *same* source keeps playing -- no
  // second play(), no crossfade, and above all no stop() -- for the whole walk
  // through the menu scenes and the party loop's non-gameplay phases, as long
  // as nothing has asked for a song preview.
  it('never stops, restarts or crossfades the music channel while walking through menu scenes with no preview requested', () => {
    act(() => {
      render(<App />)
    })
    for (const scene of ['players', 'session-select', 'session-assign', 'session-starting', 'settings', 'home'] as const) {
      act(() => useSceneStore.setState({ current: scene }))
    }

    expect(engine.play).toHaveBeenCalledOnce()
    expect(engine.crossfadeTo).not.toHaveBeenCalled()
    expect(engine.stop).not.toHaveBeenCalledWith(expect.anything(), 'music')
    expect(engine.duckTo).not.toHaveBeenCalled()
  })

  // Gameplay is the one place that must be genuinely silent. The music channel
  // is ducked (kept alive so returning is a fade-in, not a restart), while a
  // preview -- a source with `loop = true` that some screen may have left
  // running -- has to be stopped outright.
  // A jukebox song is a song too: no menu music under it.
  it('treats the jukebox like gameplay, ducking the menu music under its song', () => {
    act(() => {
      render(<App />)
    })
    act(() => useSceneStore.setState({ current: JUKEBOX_SCENE }))

    expect(engine.duckTo).toHaveBeenCalledWith(0, expect.any(Number), 'music')
    expect(playsOf(menuSongUrl, 'music')).toHaveLength(1)
  })

  it('entering gameplay ducks the music channel to zero and stops the preview channel outright', () => {
    act(() => {
      render(<App />)
    })
    act(() => useSceneStore.setState({ current: 'session-play' }))

    expect(engine.duckTo).toHaveBeenCalledWith(0, expect.any(Number), 'music')
    expect(engine.stop).toHaveBeenCalledWith(expect.any(Number), 'preview')
    expect(engine.stop).not.toHaveBeenCalledWith(expect.anything(), 'music')
  })

  describe('song preview handoff', () => {
    /** Walk the shell to the selector with a preview requested, exactly as SongSelector does. */
    function selectSong(track: string) {
      act(() => useSceneStore.setState({ current: 'session-select' }))
      act(() => useSongPreviewStore.getState().requestPreview(track))
    }

    // Requirement 1, verbatim: "The menu music must stop immediately when a
    // song is selected." Stopped, not ducked -- duckTo(0) would leave the
    // looping menu source alive at zero gain underneath the preview.
    it('stops the menu music outright -- never ducks it -- the moment a song preview is requested', () => {
      act(() => {
        render(<App />)
      })
      engine.play.mockClear()

      selectSong(PREVIEW_A)

      expect(engine.stop).toHaveBeenCalledWith(MENU_MUSIC_STOP_MS, 'music')
      expect(engine.duckTo).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 'music')
      expect(playsOf(PREVIEW_A, 'preview').length).toBeGreaterThan(0)
    })

    // #PREVIEWSTART: the chart says where its preview begins, and the request
    // carries that through to the engine's play().
    it("starts the preview at the chart's #PREVIEWSTART when the request names one", () => {
      act(() => {
        render(<App />)
      })
      act(() => useSceneStore.setState({ current: 'session-select' }))
      act(() => useSongPreviewStore.getState().requestPreview(PREVIEW_A, { previewStartSec: 42.5 }))

      expect(playsOf(PREVIEW_A, 'preview').at(-1)?.[2]).toMatchObject({ previewStartSec: 42.5, loop: true })
    })

    // Requirement 2, the hard half: the preview outlives the screen that
    // started it. Crossing into Player Selection must produce no play() (a
    // restart, and -- since the engine keeps the outgoing source alive until
    // its replacement is running -- a moment of two previews layered) and no
    // stop().
    it('carries the preview into Player Selection without restarting or layering it', () => {
      act(() => {
        render(<App />)
      })
      selectSong(PREVIEW_A)
      engine.play.mockClear()
      engine.stop.mockClear()

      act(() => useSceneStore.setState({ current: 'session-assign' }))

      expect(engine.play).not.toHaveBeenCalled()
      expect(engine.stop).not.toHaveBeenCalled()
    })

    // Re-rendering the shell (any unrelated store change) must not be able to
    // re-issue the preview either -- "keyed on the selected song", not on a
    // render.
    it('re-requesting the same song while on Player Selection changes nothing', () => {
      act(() => {
        render(<App />)
      })
      selectSong(PREVIEW_A)
      act(() => useSceneStore.setState({ current: 'session-assign' }))
      engine.play.mockClear()
      engine.stop.mockClear()

      act(() => useSongPreviewStore.getState().requestPreview(PREVIEW_A))

      expect(engine.play).not.toHaveBeenCalled()
      expect(engine.stop).not.toHaveBeenCalled()
    })

    // Browsing is a blend, not a cut: the outgoing preview keeps playing until
    // the incoming one has started, and the two cross on an equal-power curve.
    it('browsing to a different song crossfades (equal-power) from the outgoing preview into the new one', () => {
      act(() => {
        render(<App />)
      })
      selectSong(PREVIEW_A)
      engine.play.mockClear()
      engine.stop.mockClear()

      act(() => useSongPreviewStore.getState().requestPreview(PREVIEW_B, { loop: false }))

      expect(PREVIEW_CROSSFADE_MS).toBeGreaterThanOrEqual(200)
      expect(PREVIEW_CROSSFADE_MS).toBeLessThanOrEqual(250)
      expect(engine.crossfadeTo).toHaveBeenCalledWith(
        PREVIEW_B,
        PREVIEW_CROSSFADE_MS,
        'preview',
        expect.objectContaining({ fadeCurve: 'equal-power', loop: false }),
      )
      expect(engine.stop).not.toHaveBeenCalled()
      expect(engine.play).not.toHaveBeenCalled()
    })

    // Song Select previews play once; the engine's end-of-track report lands
    // in the store, where the selector picks it up and moves on.
    it('reports a preview that played to its end, and crossfades into whatever is asked for next', () => {
      act(() => {
        render(<App />)
      })
      act(() => useSceneStore.setState({ current: 'session-select' }))
      act(() => useSongPreviewStore.getState().requestPreview(PREVIEW_A, { loop: false }))
      const options = playsOf(PREVIEW_A, 'preview').at(-1)![2] as PlayOptions
      expect(options.loop).toBe(false)

      act(() => options.onEnded?.())
      expect(useSongPreviewStore.getState().endedTrack).toBe(PREVIEW_A)

      act(() => useSongPreviewStore.getState().requestPreview(PREVIEW_B, { loop: false }))
      expect(useSongPreviewStore.getState().endedTrack).toBeNull()
      expect(engine.crossfadeTo).toHaveBeenCalledWith(PREVIEW_B, PREVIEW_CROSSFADE_MS, 'preview', expect.anything())
    })

    // The launch handoff that has to keep working: `song_selected.wav` opens
    // the start transition and reaches full level 300 ms in, so the preview is
    // faded on the shorter launch curve rather than the browse one.
    it('fades the preview on the launch curve when the start transition begins', () => {
      act(() => {
        render(<App />)
      })
      selectSong(PREVIEW_A)
      act(() => useSceneStore.setState({ current: 'session-assign' }))
      engine.stop.mockClear()

      act(() => useSceneStore.setState({ current: 'session-starting' }))

      expect(engine.stop).toHaveBeenCalledWith(PREVIEW_LAUNCH_FADE_MS, 'preview')
    })

    // The menu music was *stopped*, not ducked, so there is nothing left to
    // restore(): coming back out of the party loop has to start it again, or
    // the results screen sits in silence for the rest of the night.
    it('starts the menu music again on the way out of the loop, since the preview stopped it', () => {
      act(() => {
        render(<App />)
      })
      selectSong(PREVIEW_A)
      act(() => useSceneStore.setState({ current: 'session-assign' }))
      act(() => useSceneStore.setState({ current: 'session-starting' }))
      act(() => useSceneStore.setState({ current: 'session-play' }))
      engine.play.mockClear()

      act(() => useSceneStore.setState({ current: 'session-results' }))

      expect(playsOf(menuSongUrl, 'music').length).toBeGreaterThan(0)
    })

    // The countdown must not have menu music underneath it. The preview has
    // just been faded out and the music was stopped when it started, so the
    // start transition is exactly the scene where the shell has to leave the
    // music channel alone rather than treating it as "a menu again".
    it('does not bring the menu music back under the 3-2-1 countdown', () => {
      act(() => {
        render(<App />)
      })
      selectSong(PREVIEW_A)
      act(() => useSceneStore.setState({ current: 'session-assign' }))
      engine.play.mockClear()

      act(() => useSceneStore.setState({ current: 'session-starting' }))

      expect(playsOf(menuSongUrl, 'music')).toHaveLength(0)
    })

    // Leaving the selector for anywhere that isn't the launch path (Back to
    // Home) is a browse-fade, and the menu music comes back.
    it('stops the preview and restarts the menu music when Back leaves the selector', () => {
      act(() => {
        render(<App />)
      })
      selectSong(PREVIEW_A)
      engine.play.mockClear()
      engine.stop.mockClear()

      act(() => useSceneStore.setState({ current: 'home' }))

      expect(engine.stop).toHaveBeenCalledWith(PREVIEW_BROWSE_FADE_MS, 'preview')
      expect(playsOf(menuSongUrl, 'music').length).toBeGreaterThan(0)
    })

    // A stale request must not resurrect a preview the next time the selector
    // is opened, before the screen has had a chance to say what it wants.
    it('clears the requested preview once the session has left the preview scenes', () => {
      act(() => {
        render(<App />)
      })
      selectSong(PREVIEW_A)

      act(() => useSceneStore.setState({ current: 'home' }))

      expect(useSongPreviewStore.getState().track).toBeNull()
    })
  })
})

// --- Menu music from the user's library (the default) -----------------------

function librarySong(id: string, extra: Partial<LibrarySong> = {}): LibrarySong {
  return {
    path: `/songs/${id}`,
    artist: `Artist ${id}`,
    title: `Title ${id}`,
    durationMs: 200_000,
    thumbnailPath: null,
    mp3Path: `/songs/${id}/song.mp3`,
    videoPath: null,
    bpm: 120,
    gap: 0,
    hasVideo: false,
    hasCover: false,
    isDuet: false,
    isPlayable: true,
    addedAt: 0,
    ...extra,
  }
}

/** The library list the app already holds -- what the menu music picks from without a database read. */
function holdLibrary(songs: LibrarySong[]) {
  useLibraryStore.setState({ searchBase: { key: 'all', songs }, filters: {} })
}

/** Lets the menu music's background pick (an awaited candidate list) land. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

/** Every crossfadeTo() on the menu bus, as [url, ms, options]. */
function menuCrossfades() {
  return engine.crossfadeTo.mock.calls
    .filter((call) => call[2] === 'music')
    .map((call) => [call[0], call[1], call[3]] as [string, number, PlayOptions])
}

describe('App -- menu music from the library', () => {
  beforeEach(() => {
    resetShell()
    useAppPreferencesStore.setState({ menuMusicMode: 'library' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fades in a library song on the menu bus, once (not looped), from its #PREVIEWSTART', async () => {
    const song = librarySong('a', { previewStartSec: 42 })
    holdLibrary([song])

    act(() => {
      render(<App />)
    })
    await flush()

    const [url, ms, options] = menuCrossfades()[0]
    expect(url).toBe(toLibraryMediaUrl(song.mp3Path!))
    expect(ms).toBe(MENU_SONG_FADE_IN_MS)
    expect(options).toMatchObject({ previewStartSec: 42, startAtPreview: true, loop: false, cache: false })
    expect(playsOf(menuSongUrl, 'music')).toHaveLength(0)
  })

  it('shows the song as now playing only once it is actually playing', async () => {
    holdLibrary([librarySong('a')])
    act(() => {
      render(<App />)
    })
    await flush()
    expect(useMenuMusicStore.getState().nowPlaying).toBeNull()

    act(() => menuCrossfades()[0][2].onStarted?.({ durationSec: 200, offsetSec: 60 }))

    expect(useMenuMusicStore.getState().nowPlaying).toEqual({ title: 'Title a', artist: 'Artist a' })
  })

  it('crossfades into another random song when the current one runs out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const first = librarySong('a')
    const second = librarySong('b')
    holdLibrary([first, second])
    act(() => {
      render(<App />)
    })
    await flush()
    const [firstUrl, , firstOptions] = menuCrossfades()[0]

    // 40 s left from the start point: the next song starts fading in 3 s before the end.
    act(() => firstOptions.onStarted?.({ durationSec: 100, offsetSec: 60 }))
    act(() => vi.advanceTimersByTime(40_000 - MENU_SONG_CROSSFADE_MS - 1))
    await flush()
    expect(menuCrossfades()).toHaveLength(1)

    act(() => vi.advanceTimersByTime(1))
    await flush()

    expect(menuCrossfades()).toHaveLength(2)
    const [nextUrl, nextMs] = menuCrossfades()[1]
    expect(nextMs).toBe(MENU_SONG_CROSSFADE_MS)
    expect(nextUrl).not.toBe(firstUrl)
    expect([toLibraryMediaUrl(first.mp3Path!), toLibraryMediaUrl(second.mp3Path!)]).toContain(nextUrl)
  })

  it('moves on after at most 90 s of one song', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    holdLibrary([librarySong('a'), librarySong('b')])
    act(() => {
      render(<App />)
    })
    await flush()

    act(() => menuCrossfades()[0][2].onStarted?.({ durationSec: 400, offsetSec: 60 }))
    act(() => vi.advanceTimersByTime(90_000 - MENU_SONG_CROSSFADE_MS))
    await flush()

    expect(menuCrossfades()).toHaveLength(2)
  })

  it('falls back to the bundled loop when the library is empty', async () => {
    act(() => {
      render(<App />)
    })
    await flush()

    expect(playsOf(menuSongUrl, 'music')).toHaveLength(1)
    expect(menuCrossfades()).toHaveLength(0)
    expect(useMenuMusicStore.getState()).toMatchObject({ nowPlaying: null, source: 'builtin' })
  })

  it('falls back to the bundled loop when every pick fails to load', async () => {
    holdLibrary(['a', 'b', 'c', 'd', 'e'].map((id) => librarySong(id)))
    act(() => {
      render(<App />)
    })
    for (let attempt = 0; attempt < 3; attempt++) {
      await flush()
      act(() => menuCrossfades().at(-1)![2].onError?.(new Error('decode failed')))
    }
    await flush()

    // Three different songs tried, then the loop.
    expect(new Set(menuCrossfades().map(([url]) => url)).size).toBe(3)
    expect(playsOf(menuSongUrl, 'music')).toHaveLength(1)
  })

  it('never plays songs that cannot play (no audio, not playable)', async () => {
    const good = librarySong('good')
    holdLibrary([librarySong('silent', { mp3Path: null }), librarySong('broken', { isPlayable: false }), good])
    act(() => {
      render(<App />)
    })
    await flush()

    expect(menuCrossfades()[0][0]).toBe(toLibraryMediaUrl(good.mp3Path!))
  })

  it('stops a library song for gameplay -- no duck -- and starts a new one on the way back', async () => {
    holdLibrary([librarySong('a'), librarySong('b')])
    act(() => {
      render(<App />)
    })
    await flush()
    act(() => menuCrossfades()[0][2].onStarted?.({ durationSec: 200, offsetSec: 60 }))

    act(() => useSceneStore.setState({ current: 'session-play' }))
    expect(engine.stop).toHaveBeenCalledWith(expect.any(Number), 'music')
    expect(engine.duckTo).not.toHaveBeenCalled()
    expect(useMenuMusicStore.getState().nowPlaying).toBeNull()

    act(() => useSceneStore.setState({ current: 'session-results' }))
    await flush()
    expect(menuCrossfades()).toHaveLength(2)
    expect(engine.restore).not.toHaveBeenCalled()
  })

  it('a song preview stops the library song, exactly as it stops the loop', async () => {
    holdLibrary([librarySong('a')])
    act(() => {
      render(<App />)
    })
    await flush()
    engine.stop.mockClear()

    act(() => useSceneStore.setState({ current: 'session-select' }))
    act(() => useSongPreviewStore.getState().requestPreview(PREVIEW_A))

    expect(engine.stop).toHaveBeenCalledWith(MENU_MUSIC_STOP_MS, 'music')
    expect(playsOf(PREVIEW_A, 'preview').length).toBeGreaterThan(0)
  })

  it('a late-landing pick never starts after the music was stopped', async () => {
    holdLibrary([librarySong('a')])
    act(() => {
      render(<App />)
    })
    // Straight into gameplay, before the pick has landed.
    act(() => useSceneStore.setState({ current: 'session-play' }))
    await flush()

    expect(menuCrossfades()).toHaveLength(0)
  })

  describe('the Menu music setting', () => {
    it('Off: silence on the menus', async () => {
      holdLibrary([librarySong('a')])
      useAppPreferencesStore.setState({ menuMusicMode: 'off' })
      act(() => {
        render(<App />)
      })
      await flush()

      expect(engine.play).not.toHaveBeenCalledWith(expect.anything(), 'music')
      expect(menuCrossfades()).toHaveLength(0)
    })

    it('switching to Off stops the music at once; switching back starts it again', async () => {
      holdLibrary([librarySong('a')])
      act(() => {
        render(<App />)
      })
      await flush()
      engine.stop.mockClear()

      act(() => useAppPreferencesStore.setState({ menuMusicMode: 'off' }))
      expect(engine.stop).toHaveBeenCalledWith(expect.any(Number), 'music')

      act(() => useAppPreferencesStore.setState({ menuMusicMode: 'library' }))
      await flush()
      expect(menuCrossfades()).toHaveLength(2)
    })

    it('Built-in track: the bundled loop even with a library, and no "now playing"', async () => {
      holdLibrary([librarySong('a')])
      useAppPreferencesStore.setState({ menuMusicMode: 'builtin' })
      act(() => {
        render(<App />)
      })
      await flush()

      expect(playsOf(menuSongUrl, 'music')).toHaveLength(1)
      expect(menuCrossfades()).toHaveLength(0)
      expect(useMenuMusicStore.getState().nowPlaying).toBeNull()
    })

    it('switching from the library to Built-in swaps the song for the loop', async () => {
      holdLibrary([librarySong('a')])
      act(() => {
        render(<App />)
      })
      await flush()

      act(() => useAppPreferencesStore.setState({ menuMusicMode: 'builtin' }))

      expect(engine.stop).toHaveBeenCalledWith(expect.any(Number), 'music')
      expect(playsOf(menuSongUrl, 'music')).toHaveLength(1)
    })
  })
})

// --- Handing the song between Home and Song Select --------------------------

describe('App -- the menu song and the song preview hand over, never restart', () => {
  const SONG_A = librarySong('a', { previewStartSec: 30 })
  const SONG_B = librarySong('b')
  const URL_A = toLibraryMediaUrl(SONG_A.mp3Path!)
  const URL_B = toLibraryMediaUrl(SONG_B.mp3Path!)

  function moved(track: string, durationSec = 200, positionSec = 80): TransferredTrack {
    return { track, durationSec, positionSec }
  }

  /** Library menu music playing SONG_A, as Home has it (Math.random is pinned, so A is the pick). */
  async function homeWithMenuSong() {
    holdLibrary([SONG_A, SONG_B])
    act(() => {
      render(<App />)
    })
    await flush()
    const [url, , options] = menuCrossfades()[0]
    expect(url).toBe(URL_A)
    act(() => options.onStarted?.({ durationSec: 200, offsetSec: 30 }))
  }

  /** What Song Select requests for a song: played through, not looped. */
  function previewOf(url: string) {
    act(() => useSongPreviewStore.getState().requestPreview(url, { loop: false }))
  }

  beforeEach(() => {
    resetShell()
    useAppPreferencesStore.setState({ menuMusicMode: 'library' })
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('into Song Select: the playing menu song is handed to the preview bus -- no new play, no stop, nothing decoded again', async () => {
    await homeWithMenuSong()
    expect(useMenuMusicStore.getState().track).toBe(URL_A)
    engine.transfer.mockImplementation(() => moved(URL_A))
    engine.play.mockClear()
    engine.stop.mockClear()
    engine.crossfadeTo.mockClear()

    act(() => useSceneStore.setState({ current: 'session-select' }))
    previewOf(URL_A)

    expect(engine.transfer).toHaveBeenCalledOnce()
    expect(engine.transfer).toHaveBeenCalledWith(
      'music',
      'preview',
      PREVIEW_HANDOVER_MS,
      expect.objectContaining({ track: URL_A, loop: false }),
    )
    expect(engine.play).not.toHaveBeenCalled()
    expect(engine.crossfadeTo).not.toHaveBeenCalled()
    expect(engine.stop).not.toHaveBeenCalled()
    // The rotation is retired: nothing on Home's "Now playing", no next song queued.
    expect(useMenuMusicStore.getState()).toMatchObject({ nowPlaying: null, source: null, track: null })
  })

  it('the handed-over song reports its end to the selector like any preview', async () => {
    await homeWithMenuSong()
    engine.transfer.mockImplementation(() => moved(URL_A))
    act(() => useSceneStore.setState({ current: 'session-select' }))
    previewOf(URL_A)

    const [, , , options] = engine.transfer.mock.calls[0]
    act(() => options?.onEnded?.())

    expect(useSongPreviewStore.getState().endedTrack).toBe(URL_A)
  })

  it('no rotation crossfade fires under the preview after a handover', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await homeWithMenuSong()
    engine.transfer.mockImplementation(() => moved(URL_A))
    act(() => useSceneStore.setState({ current: 'session-select' }))
    previewOf(URL_A)
    engine.crossfadeTo.mockClear()

    act(() => vi.advanceTimersByTime(10 * 60_000))
    await flush()

    expect(menuCrossfades()).toHaveLength(0)
  })

  it('another song selected: the handed-over song crossfades into its preview', async () => {
    await homeWithMenuSong()
    engine.transfer.mockImplementation(() => moved(URL_A))
    act(() => useSceneStore.setState({ current: 'session-select' }))
    previewOf(URL_A)

    previewOf(URL_B)

    expect(engine.crossfadeTo).toHaveBeenLastCalledWith(
      URL_B,
      PREVIEW_CROSSFADE_MS,
      'preview',
      expect.objectContaining({ fadeCurve: 'equal-power', loop: false }),
    )
    expect(engine.stop).not.toHaveBeenCalledWith(expect.anything(), 'preview')
  })

  it('a different song requested: the menu music stops and the preview starts, as before', async () => {
    await homeWithMenuSong()
    engine.stop.mockClear()

    act(() => useSceneStore.setState({ current: 'session-select' }))
    previewOf(URL_B)

    expect(engine.transfer).not.toHaveBeenCalled()
    expect(engine.stop).toHaveBeenCalledWith(MENU_MUSIC_STOP_MS, 'music')
    expect(playsOf(URL_B, 'preview')).toHaveLength(1)
  })

  it('a looping preview of the same song (Party Draw) is not handed over', async () => {
    await homeWithMenuSong()
    engine.transfer.mockImplementation(() => moved(URL_A))

    act(() => useSceneStore.setState({ current: 'session-party-draw' }))
    act(() => useSongPreviewStore.getState().requestPreview(URL_A))

    expect(engine.transfer).not.toHaveBeenCalled()
    expect(playsOf(URL_A, 'preview')).toHaveLength(1)
  })

  it('falls back to stop-and-play when the engine has nothing to hand over', async () => {
    await homeWithMenuSong()
    engine.stop.mockClear()

    act(() => useSceneStore.setState({ current: 'session-select' }))
    previewOf(URL_A)

    expect(engine.transfer).toHaveBeenCalledOnce()
    expect(engine.stop).toHaveBeenCalledWith(MENU_MUSIC_STOP_MS, 'music')
    expect(playsOf(URL_A, 'preview')).toHaveLength(1)
  })

  describe('back to Home', () => {
    async function previewingInSelect(url: string) {
      holdLibrary([SONG_A, SONG_B])
      act(() => {
        render(<App />)
      })
      await flush()
      act(() => useSceneStore.setState({ current: 'session-select' }))
      previewOf(url)
      engine.play.mockClear()
      engine.stop.mockClear()
      engine.crossfadeTo.mockClear()
    }

    it('the previewing song carries on as the menu music, named on Home -- no stop, no restart', async () => {
      await previewingInSelect(URL_B)
      engine.transfer.mockImplementation(() => moved(URL_B))

      act(() => useSceneStore.setState({ current: 'home' }))

      expect(engine.transfer).toHaveBeenCalledWith(
        'preview',
        'music',
        PREVIEW_HANDOVER_MS,
        expect.objectContaining({ track: URL_B, loop: false }),
      )
      expect(engine.stop).not.toHaveBeenCalled()
      expect(engine.play).not.toHaveBeenCalled()
      expect(menuCrossfades()).toHaveLength(0)
      expect(useMenuMusicStore.getState()).toMatchObject({
        nowPlaying: { title: SONG_B.title, artist: SONG_B.artist },
        source: 'library',
        track: URL_B,
      })
      expect(useSongPreviewStore.getState().track).toBeNull()
    })

    it('when it ends, the rotation carries on with another random song', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await previewingInSelect(URL_B)
      // 120 s into 200: 80 s to go.
      engine.transfer.mockImplementation(() => moved(URL_B, 200, 120))
      act(() => useSceneStore.setState({ current: 'home' }))

      act(() => vi.advanceTimersByTime(80_000 - MENU_SONG_CROSSFADE_MS - 1))
      await flush()
      expect(menuCrossfades()).toHaveLength(0)

      act(() => vi.advanceTimersByTime(1))
      await flush()
      const [[nextUrl, ms]] = menuCrossfades()
      expect(ms).toBe(MENU_SONG_CROSSFADE_MS)
      // The song just handed over counts as recently played.
      expect(nextUrl).toBe(URL_A)
    })

    it('starts menu music the ordinary way when there is nothing to take over (the preview played out)', async () => {
      await previewingInSelect(URL_B)

      act(() => useSceneStore.setState({ current: 'home' }))
      await flush()

      expect(engine.transfer).toHaveBeenCalledOnce()
      expect(engine.stop).toHaveBeenCalledWith(PREVIEW_BROWSE_FADE_MS, 'preview')
      expect(menuCrossfades()).toHaveLength(1)
    })

    it('Built-in menu music: no handover -- the preview stops and the loop comes back', async () => {
      useAppPreferencesStore.setState({ menuMusicMode: 'builtin' })
      await previewingInSelect(URL_B)
      engine.transfer.mockImplementation(() => moved(URL_B))

      act(() => useSceneStore.setState({ current: 'home' }))

      expect(engine.transfer).not.toHaveBeenCalled()
      expect(engine.stop).toHaveBeenCalledWith(PREVIEW_BROWSE_FADE_MS, 'preview')
      expect(playsOf(menuSongUrl, 'music')).toHaveLength(1)
    })

    it('Off: no handover, just silence', async () => {
      useAppPreferencesStore.setState({ menuMusicMode: 'off' })
      await previewingInSelect(URL_B)
      engine.transfer.mockImplementation(() => moved(URL_B))

      act(() => useSceneStore.setState({ current: 'home' }))

      expect(engine.transfer).not.toHaveBeenCalled()
      expect(engine.stop).toHaveBeenCalledWith(PREVIEW_BROWSE_FADE_MS, 'preview')
      expect(menuCrossfades()).toHaveLength(0)
    })

    it('never into the countdown or gameplay', async () => {
      await previewingInSelect(URL_B)
      engine.transfer.mockImplementation(() => moved(URL_B))

      act(() => useSceneStore.setState({ current: 'session-assign' }))
      act(() => useSceneStore.setState({ current: 'session-starting' }))
      act(() => useSceneStore.setState({ current: 'session-play' }))

      expect(engine.transfer).not.toHaveBeenCalled()
      expect(engine.stop).toHaveBeenCalledWith(PREVIEW_LAUNCH_FADE_MS, 'preview')
    })
  })
})

// --- The results bed: the sung song, muffled, behind the results screen -----

describe('App -- the results bed', () => {
  const SUNG = librarySong('sung', { previewStartSec: 42 })
  const SUNG_URL = toLibraryMediaUrl(SUNG.mp3Path!)

  /** Every crossfadeTo() on the results bus, as [url, ms, options]. */
  function bedCrossfades() {
    return engine.crossfadeTo.mock.calls
      .filter((call) => call[2] === 'results')
      .map((call) => [call[0], call[1], call[3]] as [string, number, PlayOptions])
  }

  /** Anything that would put the menu music on: a play, crossfade or restore on the music bus. */
  function menuMusicStarts() {
    return [
      ...engine.play.mock.calls.filter((call) => call[1] === 'music'),
      ...engine.crossfadeTo.mock.calls.filter((call) => call[2] === 'music'),
      ...engine.restore.mock.calls.filter((call) => call[1] === 'music'),
    ]
  }

  /** Sing SUNG and land on its results, the way the session machine does. */
  function singAndFinish() {
    act(() => useSessionStore.setState({ selectedSong: SUNG }))
    act(() => useSceneStore.setState({ current: 'session-play' }))
    act(() => useSceneStore.setState({ current: 'session-results' }))
  }

  beforeEach(() => {
    resetShell()
    useSessionStore.setState({ selectedSong: null })
    useAppPreferencesStore.setState({ menuMusicMode: 'builtin' })
  })

  afterEach(() => {
    useSessionStore.setState({ selectedSong: null })
  })

  it('plays the sung song muffled on the results bus, from its #PREVIEWSTART, fading in over 1.5 s', () => {
    act(() => {
      render(<App />)
    })
    act(() => useSessionStore.setState({ selectedSong: SUNG }))
    act(() => useSceneStore.setState({ current: 'session-play' }))
    // Nothing during the song itself.
    expect(bedCrossfades()).toHaveLength(0)

    act(() => useSceneStore.setState({ current: 'session-results' }))

    expect(RESULTS_BED_FADE_IN_MS).toBe(1500)
    expect(bedCrossfades()).toEqual([
      [
        SUNG_URL,
        RESULTS_BED_FADE_IN_MS,
        expect.objectContaining({ effect: 'muffled', previewStartSec: 42, startAtPreview: true, loop: true, cache: false }),
      ],
    ])
  })

  it('leaves the engine to pick the start when the chart has no #PREVIEWSTART, and falls back to the instrumental', () => {
    const stemsOnly = librarySong('stems', { mp3Path: null, instrumentalPath: '/songs/stems/inst.ogg' })
    act(() => {
      render(<App />)
    })
    act(() => useSessionStore.setState({ selectedSong: stemsOnly }))
    act(() => useSceneStore.setState({ current: 'session-results' }))

    const [url, , options] = bedCrossfades()[0]
    expect(url).toBe(toLibraryMediaUrl('/songs/stems/inst.ogg'))
    expect(options.previewStartSec).toBeNull()
  })

  it('takes the room from the menu music: the ducked loop is stopped, and nothing restarts it under the bed', () => {
    act(() => {
      render(<App />)
    })
    singAndFinish()

    expect(engine.stop).toHaveBeenCalledWith(MENU_MUSIC_STOP_MS, 'music')
    expect(engine.restore).not.toHaveBeenCalled()
    expect(playsOf(menuSongUrl, 'music')).toHaveLength(1)
  })

  it('never starts a library menu song while the bed plays', async () => {
    useAppPreferencesStore.setState({ menuMusicMode: 'library' })
    holdLibrary([librarySong('a'), librarySong('b')])
    act(() => {
      render(<App />)
    })
    await flush()
    engine.crossfadeTo.mockClear()

    singAndFinish()
    await flush()

    expect(menuMusicStarts()).toHaveLength(0)
    expect(bedCrossfades()).toHaveLength(1)
  })

  it('fades out over 800 ms for the leaderboard, where the menu music takes over again -- and comes back on Back', () => {
    act(() => {
      render(<App />)
    })
    singAndFinish()
    engine.play.mockClear()

    act(() => useSceneStore.setState({ current: 'session-leaderboard' }))

    expect(RESULTS_BED_FADE_OUT_MS).toBe(800)
    expect(engine.stop).toHaveBeenCalledWith(RESULTS_BED_FADE_OUT_MS, 'results')
    expect(playsOf(menuSongUrl, 'music')).toHaveLength(1)

    engine.stop.mockClear()
    act(() => useSceneStore.setState({ current: 'session-results' }))

    expect(bedCrossfades()).toHaveLength(2)
    expect(engine.stop).toHaveBeenCalledWith(MENU_MUSIC_STOP_MS, 'music')
  })

  it('fades out on "New song" (the session forgets the song) and on leaving for Home', () => {
    act(() => {
      render(<App />)
    })
    singAndFinish()
    act(() => {
      useSessionStore.setState({ selectedSong: null })
      useSceneStore.setState({ current: 'session-select' })
    })
    expect(engine.stop).toHaveBeenCalledWith(RESULTS_BED_FADE_OUT_MS, 'results')
    expect(playsOf(menuSongUrl, 'music').length).toBeGreaterThan(1)

    engine.stop.mockClear()
    act(() => useSessionStore.setState({ selectedSong: SUNG }))
    act(() => useSceneStore.setState({ current: 'session-results' }))
    act(() => {
      useSessionStore.setState({ selectedSong: null })
      useSceneStore.setState({ current: 'home' })
    })
    expect(engine.stop).toHaveBeenCalledWith(RESULTS_BED_FADE_OUT_MS, 'results')
  })

  it('a Versus rematch clears the room on the launch curve, with no menu music under the countdown', () => {
    act(() => {
      render(<App />)
    })
    singAndFinish()
    engine.play.mockClear()

    act(() => useSceneStore.setState({ current: 'session-starting' }))

    expect(engine.stop).toHaveBeenCalledWith(PREVIEW_LAUNCH_FADE_MS, 'results')
    expect(menuMusicStarts()).toHaveLength(0)
  })

  it('without a sung song (or one with no audio) the results screen keeps the menu music, as before', () => {
    act(() => {
      render(<App />)
    })
    act(() => useSessionStore.setState({ selectedSong: librarySong('silent', { mp3Path: null }) }))
    act(() => useSceneStore.setState({ current: 'session-play' }))
    act(() => useSceneStore.setState({ current: 'session-results' }))

    expect(bedCrossfades()).toHaveLength(0)
    expect(engine.restore).toHaveBeenCalledWith(expect.any(Number), 'music')
  })

  it('a bed that fails to load is just silence: no crash, and no menu music sneaking in', () => {
    engine.crossfadeTo.mockImplementation((_url: string, _ms: number, channel?: string, options?: PlayOptions) => {
      if (channel === 'results') options?.onError?.(new Error('decode failed'))
    })
    try {
      act(() => {
        render(<App />)
      })
      singAndFinish()

      expect(bedCrossfades()).toHaveLength(1)
      // The one play is the menu loop on the way in, before any song was sung.
      expect(menuMusicStarts()).toHaveLength(1)
      expect(engine.restore).not.toHaveBeenCalled()
    } finally {
      engine.crossfadeTo.mockReset()
    }
  })
})
