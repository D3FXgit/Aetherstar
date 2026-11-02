// Song Select's half of the Home <-> Song Select handover: preselecting the
// song the menu music is playing, and moving on to the next song when a
// preview plays out (instead of looping it). The audio half -- handing the
// very source between the buses -- is App.audioPolicy.test.tsx's.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SongSelector } from '../SongSelector'
import { NAVIGATION_IDLE_MS, nextPreviewableSong } from '../songSelect/useSongSelection'
import { useLibraryStore } from '../../library/useLibraryStore'
import { useSongPreviewStore } from '../../audio/songPreviewStore'
import { resetMenuMusicForTests, useMenuMusicStore } from '../../audio/menuMusic'
import { toLibraryMediaUrl } from '../../library/mediaUrl'
import type { LibrarySong } from '../../library/types'

vi.mock('../../audio/useWebAudioManager', () => ({
  useWebAudioManager: { getState: vi.fn() },
}))

function song(id: string, extra: Partial<LibrarySong> = {}): LibrarySong {
  return {
    path: `/library/${id}`,
    artist: `Artist ${id}`,
    title: `Song ${id}`,
    durationMs: 120000,
    thumbnailPath: null,
    mp3Path: `/library/${id}/song.mp3`,
    videoPath: null,
    bpm: 100,
    gap: 0,
    hasVideo: false,
    hasCover: false,
    isDuet: false,
    isPlayable: true,
    addedAt: 1,
    ...extra,
  }
}

const APPLE = song('apple')
const BANANA = song('banana', { mp3Path: null, isPlayable: false })
const CHERRY = song('cherry')
const DAMSON = song('damson')

const urlOf = (s: LibrarySong) => toLibraryMediaUrl(s.mp3Path!)

function seed(songs: LibrarySong[]) {
  useLibraryStore.setState({
    roots: [{ path: '/library', addedAt: 1 }],
    results: songs,
    scanProgress: {},
    scanErrors: [],
    filters: {},
    lastScanAt: {},
    isReindexing: false,
    searchBase: null,
  })
  window.api = {
    openFile: vi.fn(),
    library: {
      addRoot: vi.fn(),
      removeRoot: vi.fn(),
      listRoots: vi.fn().mockResolvedValue([{ path: '/library', addedAt: 1 }]),
      rescan: vi.fn(),
      search: vi.fn().mockResolvedValue(songs),
      getSong: vi.fn(),
      listScanErrors: vi.fn().mockResolvedValue([]),
      onScanProgress: vi.fn().mockReturnValue(() => {}),
    },
  } as unknown as Window['api']
}

/** Home has `s` playing as library menu music. */
function menuPlaying(s: LibrarySong) {
  useMenuMusicStore.setState({ nowPlaying: { title: s.title, artist: s.artist }, source: 'library', track: urlOf(s) })
}

async function renderSelector() {
  render(<SongSelector onSongPicked={vi.fn()} />)
  return screen.findByTestId('song-preview-panel')
}

function cardOf(s: LibrarySong): HTMLElement {
  return within(screen.getByTestId('song-selector-grid')).getByRole('button', { name: new RegExp(s.title) })
}

let now = 0
const realScrollTo = Element.prototype.scrollTo

beforeEach(() => {
  resetMenuMusicForTests()
  useSongPreviewStore.setState({ track: null, previewStartSec: null, loop: true, endedTrack: null })
  now = 100_000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})

afterEach(() => {
  vi.restoreAllMocks()
  Element.prototype.scrollTo = realScrollTo
})

describe('Song Select preselects the song the menu music is playing', () => {
  it('opens on that song, and asks for it played through rather than looped', async () => {
    seed([APPLE, BANANA, CHERRY])
    menuPlaying(CHERRY)

    const panel = await renderSelector()

    expect(within(panel).getByText('Song cherry')).toBeInTheDocument()
    expect(useSongPreviewStore.getState()).toMatchObject({ track: urlOf(CHERRY), loop: false })
    expect(cardOf(CHERRY)).toHaveAttribute('aria-current', 'true')
  })

  it('keeps the default (first result) when the menu song is filtered out of the list', async () => {
    seed([APPLE, BANANA])
    menuPlaying(CHERRY)

    const panel = await renderSelector()

    expect(within(panel).getByText('Song apple')).toBeInTheDocument()
    expect(useSongPreviewStore.getState().track).toBe(urlOf(APPLE))
  })

  it('keeps the default with the bundled loop playing (no library song to match)', async () => {
    seed([APPLE, CHERRY])
    useMenuMusicStore.setState({ nowPlaying: null, source: 'builtin', track: null })

    const panel = await renderSelector()

    expect(within(panel).getByText('Song apple')).toBeInTheDocument()
  })

  it('a preview already running (Back from Player Selection) still wins', async () => {
    seed([APPLE, CHERRY, DAMSON])
    menuPlaying(CHERRY)
    useSongPreviewStore.setState({ track: urlOf(DAMSON) })

    const panel = await renderSelector()

    expect(within(panel).getByText('Song damson')).toBeInTheDocument()
  })

  it('scrolls the preselected song into view in a library too big to render at once', async () => {
    const many = Array.from({ length: 400 }, (_, index) => song(`s${String(index).padStart(3, '0')}`))
    seed(many)
    menuPlaying(many[350])
    const scrollTo = vi.fn()
    Element.prototype.scrollTo = scrollTo

    await renderSelector()

    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: expect.any(Number) })))
    const lastTop = (scrollTo.mock.calls.at(-1)![0] as ScrollToOptions).top!
    expect(lastTop).toBeGreaterThan(0)
  })
})

describe('a preview that plays out moves the selection on', () => {
  async function selectorOn(songs: LibrarySong[], first: LibrarySong) {
    seed(songs)
    menuPlaying(first)
    await renderSelector()
    expect(useSongPreviewStore.getState().track).toBe(urlOf(first))
  }

  function previewEnds(s: LibrarySong) {
    act(() => useSongPreviewStore.getState().notifyEnded(urlOf(s)))
  }

  it('selects the next song in the grid order and previews it, skipping one that cannot play', async () => {
    await selectorOn([APPLE, BANANA, CHERRY], APPLE)

    previewEnds(APPLE)

    expect(within(screen.getByTestId('song-preview-panel')).getByText('Song cherry')).toBeInTheDocument()
    expect(useSongPreviewStore.getState()).toMatchObject({ track: urlOf(CHERRY), loop: false, endedTrack: null })
  })

  it('wraps to the top after the last song', async () => {
    await selectorOn([APPLE, BANANA, CHERRY], CHERRY)

    previewEnds(CHERRY)

    expect(useSongPreviewStore.getState().track).toBe(urlOf(APPLE))
  })

  it('ignores the end of a song that is no longer the selected one', async () => {
    await selectorOn([APPLE, CHERRY, DAMSON], APPLE)

    act(() => useSongPreviewStore.getState().notifyEnded(urlOf(DAMSON)))

    expect(useSongPreviewStore.getState().track).toBe(urlOf(APPLE))
  })

  it('idle, with focus resting on the song that ended: focus follows the selection', async () => {
    await selectorOn([APPLE, CHERRY, DAMSON], APPLE)
    act(() => cardOf(APPLE).focus())
    now += NAVIGATION_IDLE_MS + 1

    previewEnds(APPLE)

    await waitFor(() => expect(cardOf(CHERRY)).toHaveFocus())
    expect(cardOf(CHERRY)).toHaveAttribute('aria-current', 'true')
  })

  it('mid-navigation: the selection still moves, but focus stays where the user put it and the grid does not scroll', async () => {
    await selectorOn([APPLE, CHERRY, DAMSON], APPLE)
    act(() => cardOf(APPLE).focus())
    const scrollTo = vi.fn()
    Element.prototype.scrollTo = scrollTo
    now += NAVIGATION_IDLE_MS / 4

    previewEnds(APPLE)

    expect(cardOf(CHERRY)).toHaveAttribute('aria-current', 'true')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(cardOf(APPLE)).toHaveFocus()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('idle, but focus elsewhere (the search box, a filter): focus is left alone', async () => {
    await selectorOn([APPLE, CHERRY, DAMSON], APPLE)
    act(() => cardOf(DAMSON).focus())
    now += NAVIGATION_IDLE_MS + 1

    previewEnds(APPLE)

    expect(useSongPreviewStore.getState().track).toBe(urlOf(CHERRY))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(cardOf(DAMSON)).toHaveFocus()
  })
})

describe('nextPreviewableSong', () => {
  it('walks the order, skips what cannot play, wraps, and never returns the current song', () => {
    expect(nextPreviewableSong([APPLE, BANANA, CHERRY], APPLE)).toBe(CHERRY)
    expect(nextPreviewableSong([APPLE, BANANA, CHERRY], CHERRY)).toBe(APPLE)
    expect(nextPreviewableSong([APPLE, BANANA], APPLE)).toBeNull()
    expect(nextPreviewableSong([], APPLE)).toBeNull()
    // Not in the order (a letter filter hid it): from the top.
    expect(nextPreviewableSong([BANANA, CHERRY, DAMSON], APPLE)).toBe(CHERRY)
  })
})
