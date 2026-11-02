import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibrarySong } from '../../library/types'
import type { AudioManager } from '../audioManagerContract'

const search = vi.fn<(filters: object) => Promise<LibrarySong[]>>()
vi.mock('../../library/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../library/api')>()),
  search: (filters: object) => search(filters),
}))

const {
  MENU_SONG_CROSSFADE_MS,
  MENU_SONG_MAX_SEC,
  MENU_SONG_RECENT_COUNT,
  handMenuMusicToPreview,
  menuSongAdvanceDelayMs,
  pickMenuSong,
  resetMenuMusicForTests,
  startMenuMusic,
  stopMenuMusic,
  takeOverPreviewAsMenuMusic,
  useMenuMusicStore,
} = await import('../menuMusic')
const { PREVIEW_HANDOVER_MS } = await import('../songPreviewStore')
const { toLibraryMediaUrl } = await import('../../library/mediaUrl')
const { useLibraryStore } = await import('../../library/useLibraryStore')
const { menuSongUrl } = await import('../menuTrack')

function song(id: string, extra: Partial<LibrarySong> = {}): LibrarySong {
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

function fakeAudio() {
  return { play: vi.fn(), duckTo: vi.fn(), restore: vi.fn(), crossfadeTo: vi.fn(), stop: vi.fn() } satisfies AudioManager
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('pickMenuSong', () => {
  it('returns null for an empty library or one with nothing playable', () => {
    expect(pickMenuSong([], [])).toBeNull()
    expect(pickMenuSong([song('a', { mp3Path: null }), song('b', { isPlayable: false })], [])).toBeNull()
  })

  it('plays the instrumental when a stems-only chart has no full mix', () => {
    const stemsOnly = song('s', { mp3Path: null, instrumentalPath: '/songs/s/inst.mp3' })
    expect(pickMenuSong([stemsOnly], [])).toBe(stemsOnly)
  })

  it('avoids the recently played songs', () => {
    const library = Array.from({ length: 12 }, (_, i) => song(String(i)))
    const recent = library.slice(0, MENU_SONG_RECENT_COUNT).map((entry) => entry.path)
    for (const roll of [0, 0.2, 0.5, 0.8, 0.999]) {
      expect(recent).not.toContain(pickMenuSong(library, recent, new Set(), () => roll)!.path)
    }
  })

  it('never repeats a recent song across a long rotation', () => {
    const library = Array.from({ length: 12 }, (_, i) => song(String(i)))
    const played: string[] = []
    for (let i = 0; i < 200; i++) {
      const next = pickMenuSong(library, played)!
      expect(played.slice(-MENU_SONG_RECENT_COUNT)).not.toContain(next.path)
      played.push(next.path)
    }
  })

  it('on a tiny library still never plays the same song twice in a row', () => {
    const library = [song('a'), song('b')]
    for (const roll of [0, 0.999]) {
      expect(pickMenuSong(library, ['/songs/a'], new Set(), () => roll)!.path).toBe('/songs/b')
    }
    // One song is all there is: it may repeat rather than fall back to the loop.
    expect(pickMenuSong([song('a')], ['/songs/a'])!.path).toBe('/songs/a')
  })

  it('skips songs that already failed to load', () => {
    expect(pickMenuSong([song('a'), song('b')], [], new Set(['/songs/a']), () => 0)!.path).toBe('/songs/b')
    expect(pickMenuSong([song('a')], [], new Set(['/songs/a']))).toBeNull()
  })
})

describe('menuSongAdvanceDelayMs', () => {
  it('starts the next song a crossfade before the end, or before the 90 s cap', () => {
    expect(menuSongAdvanceDelayMs(100, 60)).toBe(40_000 - MENU_SONG_CROSSFADE_MS)
    expect(menuSongAdvanceDelayMs(400, 60)).toBe(MENU_SONG_MAX_SEC * 1000 - MENU_SONG_CROSSFADE_MS)
    expect(menuSongAdvanceDelayMs(Number.NaN, 0)).toBe(MENU_SONG_MAX_SEC * 1000 - MENU_SONG_CROSSFADE_MS)
    expect(menuSongAdvanceDelayMs(2, 0)).toBe(0)
  })
})

describe('startMenuMusic / stopMenuMusic', () => {
  beforeEach(() => {
    resetMenuMusicForTests()
    search.mockReset()
    useLibraryStore.setState({ searchBase: null, filters: {} })
  })

  afterEach(() => {
    resetMenuMusicForTests()
  })

  it('reads the library once through the library API when nothing is loaded yet, then reuses it', async () => {
    search.mockResolvedValue([song('a'), song('b')])
    const audio = fakeAudio()

    startMenuMusic(audio, 'library')
    await flush()
    stopMenuMusic(audio, 100)
    startMenuMusic(audio, 'library')
    await flush()

    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith({})
    expect(audio.crossfadeTo).toHaveBeenCalledTimes(2)
    expect(audio.play).not.toHaveBeenCalled()
  })

  it('uses the list the library already holds without asking the database', async () => {
    useLibraryStore.setState({ searchBase: { key: 'k', songs: [song('a')] }, filters: {} })
    const audio = fakeAudio()

    startMenuMusic(audio, 'library')
    await flush()

    expect(search).not.toHaveBeenCalled()
    expect(audio.crossfadeTo).toHaveBeenCalledWith(expect.stringContaining('/songs/a/song.mp3'), expect.any(Number), 'music', expect.any(Object))
  })

  it('does not pick from a filtered list (favourites, a language) -- it reads the whole library', async () => {
    useLibraryStore.setState({ searchBase: { key: 'k', songs: [song('fav')] }, filters: { favoritesOnly: true } })
    search.mockResolvedValue([song('all')])
    const audio = fakeAudio()

    startMenuMusic(audio, 'library')
    await flush()

    expect(audio.crossfadeTo).toHaveBeenCalledWith(expect.stringContaining('/songs/all/'), expect.any(Number), 'music', expect.any(Object))
  })

  it('falls back to the bundled loop when the library API fails', async () => {
    search.mockRejectedValue(new Error('no database'))
    const audio = fakeAudio()

    startMenuMusic(audio, 'library')
    await flush()

    expect(audio.play).toHaveBeenCalledWith(menuSongUrl, 'music')
    expect(useMenuMusicStore.getState().source).toBe('builtin')
  })

  it('crossfades into the loop, not cuts, when the next song fails after one already played', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      search.mockResolvedValue([song('a'), song('b')])
      const audio = fakeAudio()
      startMenuMusic(audio, 'library')
      await flush()
      audio.crossfadeTo.mock.calls[0][3].onStarted({ durationSec: 30, offsetSec: 0 })

      vi.advanceTimersByTime(30_000)
      await flush()
      // Both remaining picks fail ('a' was recent; 'b' fails, then 'a' fails).
      audio.crossfadeTo.mock.calls[1][3].onError(new Error('gone'))
      await flush()
      audio.crossfadeTo.mock.calls[2][3].onError(new Error('gone'))
      await flush()

      expect(audio.crossfadeTo).toHaveBeenLastCalledWith(menuSongUrl, MENU_SONG_CROSSFADE_MS, 'music')
      expect(audio.play).not.toHaveBeenCalled()
      expect(useMenuMusicStore.getState().nowPlaying).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a song that reports in after the music was stopped', async () => {
    search.mockResolvedValue([song('a')])
    const audio = fakeAudio()
    startMenuMusic(audio, 'library')
    await flush()
    const options = audio.crossfadeTo.mock.calls[0][3]

    stopMenuMusic(audio, 100)
    options.onStarted({ durationSec: 200, offsetSec: 60 })
    options.onError(new Error('late'))
    await flush()

    expect(useMenuMusicStore.getState().nowPlaying).toBeNull()
    expect(audio.crossfadeTo).toHaveBeenCalledTimes(1)
    expect(audio.stop).toHaveBeenCalledWith(100, 'music')
  })

  it('built-in mode plays the loop at once, with nothing to name', () => {
    const audio = fakeAudio()
    startMenuMusic(audio, 'builtin')

    expect(audio.play).toHaveBeenCalledWith(menuSongUrl, 'music')
    expect(search).not.toHaveBeenCalled()
    expect(useMenuMusicStore.getState()).toMatchObject({ nowPlaying: null, source: 'builtin' })
  })
})

describe('handing the song between the menu music and the preview', () => {
  const A = song('a')
  const B = song('b')
  const URL_A = toLibraryMediaUrl('/songs/a/song.mp3')

  function handoverAudio(result: { track: string; durationSec: number; positionSec: number } | null) {
    return { ...fakeAudio(), transfer: vi.fn(() => result) } satisfies AudioManager
  }

  beforeEach(() => {
    search.mockReset()
    useLibraryStore.setState({ searchBase: { key: 'k', songs: [A, B] }, results: [A, B], filters: {} })
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    resetMenuMusicForTests()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  /** Starts library menu music and lets song A report in as playing; returns its media URL. */
  async function playingA(audio: AudioManager): Promise<string> {
    startMenuMusic(audio, 'library')
    await flush()
    const [url, , , options] = vi.mocked(audio.crossfadeTo).mock.calls[0]
    options!.onStarted!({ durationSec: 200, offsetSec: 60 })
    return url
  }

  it('publishes the playing song URL -- the one its preview plays -- for Song Select to preselect', async () => {
    const audio = handoverAudio(null)
    const url = await playingA(audio)

    expect(url.endsWith('/songs/a/song.mp3')).toBe(true)
    expect(useMenuMusicStore.getState().track).toBe(url)
    stopMenuMusic(audio, 100)
    expect(useMenuMusicStore.getState().track).toBeNull()
  })

  it('hands the menu song to the preview bus and retires the rotation', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const audio = handoverAudio(null)
    const url = await playingA(audio)
    audio.transfer.mockReturnValue({ track: url, durationSec: 200, positionSec: 70 })
    const onEnded = vi.fn()

    expect(handMenuMusicToPreview(audio, url, onEnded)).toBe(true)

    expect(audio.transfer).toHaveBeenCalledWith('music', 'preview', PREVIEW_HANDOVER_MS, { track: url, loop: false, onEnded })
    expect(useMenuMusicStore.getState()).toMatchObject({ nowPlaying: null, source: null, track: null })
    vi.advanceTimersByTime(10 * 60_000)
    await flush()
    expect(audio.crossfadeTo).toHaveBeenCalledTimes(1)
    expect(audio.stop).not.toHaveBeenCalled()
  })

  it('does nothing for another song, for a song not yet playing, or when the engine has nothing to hand over', async () => {
    const audio = handoverAudio(null)
    expect(handMenuMusicToPreview(audio, URL_A)).toBe(false)
    const url = await playingA(audio)

    expect(handMenuMusicToPreview(audio, toLibraryMediaUrl(B.mp3Path!))).toBe(false)
    expect(handMenuMusicToPreview(audio, url)).toBe(false)
    expect(useMenuMusicStore.getState().track).toBe(url)
    expect(handMenuMusicToPreview(fakeAudio(), url)).toBe(false)
  })

  it('takes a preview over as the menu song, names it, and moves on at its end', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const audio = handoverAudio(null)
    await playingA(audio)
    // What Song Select previews for B.
    const urlB = toLibraryMediaUrl(B.mp3Path!)
    stopMenuMusic(audio, 100)
    vi.mocked(audio.crossfadeTo).mockClear()
    audio.transfer.mockReturnValue({ track: urlB, durationSec: 200, positionSec: 150 })

    expect(takeOverPreviewAsMenuMusic(audio, urlB)).toBe(true)

    expect(audio.transfer).toHaveBeenCalledWith('preview', 'music', PREVIEW_HANDOVER_MS, { track: urlB, loop: false })
    expect(useMenuMusicStore.getState()).toEqual({
      nowPlaying: { title: B.title, artist: B.artist },
      source: 'library',
      track: urlB,
    })
    vi.advanceTimersByTime(50_000 - MENU_SONG_CROSSFADE_MS - 1)
    await flush()
    expect(audio.crossfadeTo).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await flush()
    // B was just heard, so the next pick is A.
    expect(audio.crossfadeTo).toHaveBeenCalledWith(
      expect.stringContaining('/songs/a/'),
      MENU_SONG_CROSSFADE_MS,
      'music',
      expect.any(Object),
    )
  })

  it('takes nothing over that is not a library song, or that has already played out', () => {
    const audio = handoverAudio(null)

    expect(takeOverPreviewAsMenuMusic(audio, 'aetherstar-media://roots/elsewhere/x.mp3')).toBe(false)
    expect(audio.transfer).not.toHaveBeenCalled()

    expect(takeOverPreviewAsMenuMusic(audio, URL_A)).toBe(false)
    expect(useMenuMusicStore.getState()).toMatchObject({ nowPlaying: null, source: null, track: null })
  })
})
