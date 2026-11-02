import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SongSelector } from '../SongSelector'
import { useSessionStore } from '../sessionStore'
import { useLibraryStore } from '../../library/useLibraryStore'
import { useSongPreviewStore } from '../../audio/songPreviewStore'
import { useWebAudioManager } from '../../audio/useWebAudioManager'
import { BackAuthorityProvider } from '../../scenes/SceneHeader'
import { setLanguage } from '../../i18n'
import type { LibrarySong, ScanErrorEntry } from '../../library/types'

vi.mock('../../audio/useWebAudioManager', () => ({
  useWebAudioManager: { getState: vi.fn() },
}))

const SONG_A: LibrarySong = {
  path: '/library/apple',
  artist: 'Artist A',
  title: 'Apple Song',
  durationMs: 120000,
  thumbnailPath: null,
  mp3Path: '/library/apple/song.mp3',
  videoPath: null,
  bpm: 100,
  gap: 0,
  hasVideo: false,
  hasCover: false,
  isDuet: false,
  isPlayable: true,
  addedAt: 1,
}
const SONG_C: LibrarySong = { ...SONG_A, path: '/library/cherry', title: 'Cherry Song', mp3Path: '/library/cherry/song.mp3' }

const ERRORS: ScanErrorEntry[] = [
  { path: '/library/broken-one', reason: 'Missing #BPM header', timestamp: 2 },
  { path: '/library/broken-two', reason: 'No notes in chart', timestamp: 1 },
]

function seed({ scanErrors = [] as ScanErrorEntry[], favorites = [] as string[] } = {}) {
  useLibraryStore.setState({
    roots: [{ path: '/library', addedAt: 1 }],
    results: [SONG_A, SONG_C],
    scanProgress: {},
    scanErrors: [],
    filters: {},
    lastScanAt: { '/library': Date.now() },
    isReindexing: false,
    searchBase: null,
    favorites: new Set(),
  })
  useSongPreviewStore.setState({ track: null })
  vi.mocked(useWebAudioManager.getState).mockReturnValue({
    play: vi.fn(),
    duckTo: vi.fn(),
    restore: vi.fn(),
    crossfadeTo: vi.fn(),
    stop: vi.fn(),
  } as unknown as ReturnType<typeof useWebAudioManager.getState>)
  window.api = {
    openFile: vi.fn(),
    library: {
      addRoot: vi.fn(),
      removeRoot: vi.fn(),
      listRoots: vi.fn().mockResolvedValue([{ path: '/library', addedAt: 1 }]),
      rescan: vi.fn(),
      search: vi.fn().mockResolvedValue([SONG_A, SONG_C]),
      getSong: vi.fn(),
      listScanErrors: vi.fn().mockResolvedValue(scanErrors),
      onScanProgress: vi.fn().mockReturnValue(() => {}),
      listFavorites: vi.fn().mockResolvedValue(favorites),
      setFavorite: vi.fn().mockResolvedValue(true),
      recordPlay: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Window['api']
}

describe('SongSelector: songs that could not be loaded', () => {
  beforeEach(() => {
    useSessionStore.setState({ mode: 'classic', phase: 'select' })
    seed({ scanErrors: ERRORS })
  })

  afterEach(async () => {
    await act(() => setLanguage(null))
  })

  it('shows nothing when every song loaded', async () => {
    seed()
    render(<SongSelector onSongPicked={vi.fn()} />)
    await waitFor(() => expect(window.api!.library.listScanErrors).toHaveBeenCalled())
    expect(screen.queryByTestId('scan-errors-button')).not.toBeInTheDocument()
  })

  it('reads the errors on open and offers a quiet count in the header', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    expect(await screen.findByRole('button', { name: "2 songs couldn't be loaded" })).toBeInTheDocument()
  })

  it('uses the singular for one song, and German when the language is German', async () => {
    seed({ scanErrors: [ERRORS[0]] })
    render(<SongSelector onSongPicked={vi.fn()} />)
    expect(await screen.findByRole('button', { name: "1 song couldn't be loaded" })).toBeInTheDocument()

    await act(() => setLanguage('de'))
    expect(screen.getByRole('button', { name: '1 Song konnte nicht geladen werden' })).toBeInTheDocument()
  })

  it('lists each file and reason in a focus-scoped dialog that Escape closes without going Back', async () => {
    const onBack = vi.fn()
    render(
      <BackAuthorityProvider onBack={onBack}>
        <SongSelector onSongPicked={vi.fn()} />
      </BackAuthorityProvider>,
    )
    const button = await screen.findByTestId('scan-errors-button')
    await userEvent.click(button)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('data-focus-scope')
    const rows = within(dialog).getAllByTestId('scan-error')
    expect(rows[0]).toHaveTextContent('/library/broken-one')
    expect(rows[0]).toHaveTextContent('Missing #BPM header')
    expect(rows[1]).toHaveTextContent('No notes in chart')
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus()

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const shellBack = vi.fn()
    window.addEventListener('keydown', shellBack)
    act(() => {
      window.dispatchEvent(escape)
    })
    window.removeEventListener('keydown', shellBack)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(shellBack).not.toHaveBeenCalled()
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('takes a gamepad Back (the session back) while open, instead of leaving the screen', async () => {
    useSessionStore.setState({ mode: 'classic', phase: 'select' })
    render(<SongSelector onSongPicked={vi.fn()} />)
    await userEvent.click(await screen.findByTestId('scan-errors-button'))

    act(() => useSessionStore.getState().back())

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useSessionStore.getState().phase).toBe('select')
  })
})

describe('SongSelector: favourites and history', () => {
  beforeEach(() => {
    useSessionStore.setState({ mode: 'classic', phase: 'select' })
    seed({ favorites: ['/library/cherry'] })
  })

  it('loads the starred songs and stars the selected one from the preview panel', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    const panel = await screen.findByTestId('song-preview-panel')
    const star = within(panel).getByRole('button', { name: 'Favourite' })
    expect(star).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(star)

    expect(window.api!.library.setFavorite).toHaveBeenCalledWith('/library/apple', true)
    expect(star).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(useLibraryStore.getState().favorites.has('/library/cherry')).toBe(true))
  })

  it('stars with the F key, and leaves F alone while typing in the search box', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    await screen.findByTestId('song-preview-panel')

    fireEvent.keyDown(window, { key: 'f' })
    expect(window.api!.library.setFavorite).toHaveBeenCalledWith('/library/apple', true)

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'f' })
    expect(window.api!.library.setFavorite).toHaveBeenCalledTimes(1)
  })

  it('shows the shortcut in the bar', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    await screen.findByTestId('song-selector')
    const hints = screen.getByTestId('shortcut-hints')
    expect(within(hints).getByText('Favourite')).toBeInTheDocument()
    expect(within(hints).queryByText('Add to queue')).not.toBeInTheDocument()
  })

  it('filters to favourites from a chip', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    await screen.findByTestId('song-selector')

    fireEvent.click(screen.getByRole('button', { name: 'Favourites' }))

    expect(window.api!.library.search).toHaveBeenLastCalledWith(expect.objectContaining({ favoritesOnly: true }))
  })

  it('cycles on to the history sorts', async () => {
    useLibraryStore.setState({ filters: { sort: 'recent' } })
    render(<SongSelector onSongPicked={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Sort: Recently added' }))
    expect(window.api!.library.search).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'recentlySung' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sort: Recently sung' }))
    expect(window.api!.library.search).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'mostSung' }))
    await screen.findByRole('button', { name: 'Sort: Most sung' })
  })
})

describe('SongSelector: jukebox mode', () => {
  beforeEach(() => {
    useSessionStore.setState({ mode: 'jukebox', phase: 'select', jukeboxQueue: [] })
    seed()
  })

  it('has no mode tabs and no records, and offers Play now and Add to queue', async () => {
    const onSongPicked = vi.fn()
    render(<SongSelector onSongPicked={onSongPicked} />)
    const panel = await screen.findByTestId('song-preview-panel')

    expect(screen.queryByTestId('mode-segmented-control')).not.toBeInTheDocument()
    expect(screen.getByTestId('jukebox-mode-label')).toBeInTheDocument()
    expect(within(panel).queryByTestId('song-highscores')).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Start singing' })).not.toBeInTheDocument()

    await userEvent.click(within(panel).getByRole('button', { name: 'Play now' }))
    expect(onSongPicked).toHaveBeenCalledWith(SONG_A)
  })

  it('queues the selected song, shows it in the strip and removes it again', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    const panel = await screen.findByTestId('song-preview-panel')

    await userEvent.click(within(panel).getByRole('button', { name: 'Add to queue' }))

    const strip = screen.getByTestId('jukebox-queue')
    expect(within(strip).getByTestId('jukebox-queue-item')).toHaveTextContent('Apple Song')
    await userEvent.click(within(strip).getByRole('button', { name: 'Remove Apple Song from the queue' }))
    expect(within(strip).queryByTestId('jukebox-queue-item')).not.toBeInTheDocument()
    expect(useSessionStore.getState().jukeboxQueue).toEqual([])
  })

  it('queues with the Q key', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    await screen.findByTestId('song-preview-panel')
    fireEvent.keyDown(window, { key: 'q' })
    expect(useSessionStore.getState().jukeboxQueue.map((song) => song.path)).toEqual(['/library/apple'])
  })

  it('"Shuffle all" fills the queue with every song in the list', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Shuffle all' }))

    expect(
      useSessionStore
        .getState()
        .jukeboxQueue.map((song) => song.path)
        .sort(),
    ).toEqual(['/library/apple', '/library/cherry'])
    expect(screen.getAllByTestId('jukebox-queue-item')).toHaveLength(2)
  })
})
