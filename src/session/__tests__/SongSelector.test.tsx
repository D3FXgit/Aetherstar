import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SongSelector } from '../SongSelector'
import { songGridGeometry } from '../songGridGeometry'
import { useLibraryStore, REINDEX_COOLDOWN_MS } from '../../library/useLibraryStore'
import { useWebAudioManager } from '../../audio/useWebAudioManager'
import { useSongPreviewStore } from '../../audio/songPreviewStore'
import { useSfx } from '../../audio/useSfx'
import { BackAuthorityProvider } from '../../scenes/SceneHeader'
import type { LibrarySong } from '../../library/types'
import { useSessionStore } from '../sessionStore'

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

const SONG_B: LibrarySong = {
  ...SONG_A,
  path: '/library/banana',
  artist: 'Artist B',
  title: 'Banana Song',
  mp3Path: null,
  isPlayable: false,
}

const SONG_C: LibrarySong = {
  ...SONG_A,
  path: '/library/cherry',
  artist: 'Artist C',
  title: 'Cherry Song',
  mp3Path: '/library/cherry/song.mp3',
}

// The real-library case: an UltraStar folder with an MPEG-2 .mpg Chromium
// cannot decode, and a cover sitting right next to it.
const SONG_WITH_VIDEO: LibrarySong = {
  ...SONG_A,
  path: '/library/damson',
  artist: 'Artist D',
  title: 'Damson Song',
  mp3Path: '/library/damson/song.mp3',
  videoPath: '/library/damson/video.mpg',
  thumbnailPath: '/library/damson/cover.jpg',
  hasVideo: true,
  hasCover: true,
}

// The real SFX player, captured before any test swaps a spy in, so one that
// does cannot leak into the next.
const realSfxPlay = useSfx.getState().play

describe('SongSelector', () => {
  let mockAudioManager: {
    play: ReturnType<typeof vi.fn>
    duckTo: ReturnType<typeof vi.fn>
    restore: ReturnType<typeof vi.fn>
    crossfadeTo: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    useLibraryStore.setState({
      roots: [{ path: '/library', addedAt: 1 }],
      results: [SONG_A, SONG_B],
      scanProgress: {},
      scanErrors: [],
      filters: {},
      lastScanAt: {},
      isReindexing: false,
      searchBase: null,
    })
    useSongPreviewStore.setState({ track: null })
    useSfx.setState({ play: realSfxPlay })
    mockAudioManager = { play: vi.fn(), duckTo: vi.fn(), restore: vi.fn(), crossfadeTo: vi.fn(), stop: vi.fn() }
    vi.mocked(useWebAudioManager.getState).mockReturnValue(
      mockAudioManager as unknown as ReturnType<typeof useWebAudioManager.getState>,
    )
    window.api = {
      openFile: vi.fn(),
      library: {
        addRoot: vi.fn(),
        removeRoot: vi.fn(),
        listRoots: vi.fn().mockResolvedValue([{ path: '/library', addedAt: 1 }]),
        rescan: vi.fn(),
        search: vi.fn().mockResolvedValue([SONG_A, SONG_B]),
        getSong: vi.fn(),
        listScanErrors: vi.fn().mockResolvedValue([]),
        onScanProgress: vi.fn().mockReturnValue(() => {}),
      },
    } as unknown as Window['api']
  })

  it('shows the "no song library yet" prompt when no library folders are configured', () => {
    useLibraryStore.setState({ roots: [], results: [] })
    render(<SongSelector onSongPicked={vi.fn()} />)
    expect(screen.getByText(/no song library yet/i)).toBeInTheDocument()
  })

  // Back leads the selector's own title row; nothing is drawn over this screen.
  describe('the way back out', () => {
    it('draws the shell Back control as the leading item of the title row', async () => {
      const onBack = vi.fn()
      render(
        <BackAuthorityProvider onBack={onBack}>
          <SongSelector onSongPicked={vi.fn()} />
        </BackAuthorityProvider>,
      )
      await screen.findByTestId('song-selector')

      const back = screen.getByRole('button', { name: 'Back' })
      const titleRow = back.parentElement

      // Same row as the wordmark, and before it in reading order (HIG Layout:
      // reading order runs "from the leading to trailing side").
      expect(titleRow).toHaveTextContent('AETHERSTAR')
      expect(titleRow).toHaveTextContent('Select a song')
      expect(back.compareDocumentPosition(screen.getByRole('heading', { name: 'AETHERSTAR' })))
        .toBe(Node.DOCUMENT_POSITION_FOLLOWING)

      fireEvent.click(back)

      expect(onBack).toHaveBeenCalledTimes(1)
    })

    // The empty-library branch returns early, before the header above ever
    // renders. It is also the first screen a new user reaches, so losing Back
    // here strands them on their very first navigation.
    it('keeps Back on the empty-library branch', () => {
      useLibraryStore.setState({ roots: [], results: [] })

      render(<SongSelector onSongPicked={vi.fn()} />)

      expect(screen.getByText(/no song library yet/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    })

    // Pinned to the viewport, so nothing scrolls but the song list.
    it('takes the whole viewport height and starts its header 52 units down', async () => {
      render(<SongSelector onSongPicked={vi.fn()} />)
      const root = await screen.findByTestId('song-selector')

      expect(root.style.height).toBe('100dvh')
      expect(root.style.height).not.toContain('5rem')
      expect(root.style.paddingTop).toBe('calc(52 * var(--u))')
    })

    // Every other dimension on this screen is a multiple of `--u` (1px at
    // 1080p, 2px at 4K). A fixed-pixel control would be right at 1080p and read
    // as half-size on a television next to a wordmark that had doubled -- which
    // is what the first pass at this looked like at 3840x2160.
    it('scales the control with the screen, never below the 44pt floor', async () => {
      render(<SongSelector onSongPicked={vi.fn()} />)
      await screen.findByTestId('song-selector')

      const back = screen.getByRole('button', { name: 'Back' })

      // Design units, so it grows with the layout...
      expect(back.style.height).toContain('var(--u)')
      expect(back.style.fontSize).toContain('var(--u)')
      // ...but floored against the app-wide size, because `--u` clamps down to
      // 0.62px on a small window and 56 of those is under 44pt.
      expect(back.style.height).toContain('max(3.5rem')
      expect(back.style.fontSize).toContain('max(1rem')
    })
  })

  // A stems-only chart (#VOCALS/#INSTRUMENTAL with no #AUDIO/#MP3) indexes
  // with mp3Path: null but isPlayable: true. Guarding the preview on mp3Path
  // alone left such a song silently unpreviewable -- the one screen where you
  // choose a song by listening to it. The instrumental is the right stem to
  // preview: it is the backing track, and the vocal stem alone is a guide
  // vocal with no accompaniment.
  it('previews the instrumental stem for a stems-only song that has no full mix', async () => {
    const stemsOnly: LibrarySong = {
      ...SONG_A,
      path: '/library/stems',
      title: 'Stems Song',
      mp3Path: null,
      instrumentalPath: '/library/stems/instrumental.mp3',
      vocalsPath: '/library/stems/vocals.mp3',
      hasStems: true,
      isPlayable: true,
    }
    useLibraryStore.setState({ results: [stemsOnly] })
    vi.mocked(window.api!.library.search).mockResolvedValue([stemsOnly])

    render(<SongSelector onSongPicked={vi.fn()} />)
    await screen.findByTestId('song-preview-panel')

    expect(useSongPreviewStore.getState().track).toBe('aetherstar-media://roots/library/stems/instrumental.mp3')
  })

  it('requests a preview of the first song automatically once results load', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    await screen.findByTestId('song-preview-panel')

    expect(useSongPreviewStore.getState().track).toBe(`aetherstar-media://roots${SONG_A.mp3Path}`)
  })

  // Ownership of the preview bus moved out of this screen entirely (see
  // src/audio/songPreviewStore.ts). The selector *requests*; App.tsx, the
  // single audio policy site, is the only thing that calls the engine. If this
  // screen ever reaches for the engine again the handoff into Player Selection
  // silently regresses, because whatever it does here dies with its unmount.
  it('never touches the audio engine itself -- it only ever requests a track', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    const grid = await screen.findByTestId('song-selector-grid')
    await userEvent.click(within(grid).getByRole('button', { name: /Banana Song/ }))

    expect(useWebAudioManager.getState).not.toHaveBeenCalled()
    expect(mockAudioManager.play).not.toHaveBeenCalled()
    expect(mockAudioManager.stop).not.toHaveBeenCalled()
    expect(mockAudioManager.duckTo).not.toHaveBeenCalled()
    expect(mockAudioManager.restore).not.toHaveBeenCalled()
  })

  it('changing the selection re-requests the newly selected song', async () => {
    useLibraryStore.setState({ results: [SONG_A, SONG_C] })
    vi.mocked(window.api!.library.search).mockResolvedValue([SONG_A, SONG_C])
    render(<SongSelector onSongPicked={vi.fn()} />)
    const grid = await screen.findByTestId('song-selector-grid')

    await userEvent.click(within(grid).getByRole('button', { name: /Cherry Song/ }))

    expect(useSongPreviewStore.getState().track).toBe(`aetherstar-media://roots${SONG_C.mp3Path}`)
  })

  // A song with nothing to play must not leave the previous song's preview
  // running underneath it -- the panel would be describing one song while the
  // room hears another.
  it('clears the request when the selected song has no audio at all', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    const grid = await screen.findByTestId('song-selector-grid')

    await userEvent.click(within(grid).getByRole('button', { name: /Banana Song/ }))

    expect(useSongPreviewStore.getState().track).toBeNull()
  })

  // THE regression this redesign exists to prevent. The preview has to outlive
  // this screen: picking a song unmounts the selector on the way to Player
  // Selection, and the chosen song must keep playing there. A cleanup that
  // stopped or cleared the request would make that impossible.
  it('leaves the preview request standing on unmount, so it survives into Player Selection', async () => {
    const { unmount } = render(<SongSelector onSongPicked={vi.fn()} />)
    await screen.findByTestId('song-preview-panel')

    unmount()

    expect(useSongPreviewStore.getState().track).toBe(`aetherstar-media://roots${SONG_A.mp3Path}`)
  })

  // Coming *back* from Player Selection: the preview never stopped, so the
  // selector has to reopen on the song it belongs to. Falling back to the
  // first result would re-request a different track and restart the audio
  // under the user for no reason they asked for.
  it('reopens on the song that is already previewing rather than restarting on the first result', async () => {
    useLibraryStore.setState({ results: [SONG_A, SONG_C] })
    vi.mocked(window.api!.library.search).mockResolvedValue([SONG_A, SONG_C])
    useSongPreviewStore.setState({ track: `aetherstar-media://roots${SONG_C.mp3Path}` })

    render(<SongSelector onSongPicked={vi.fn()} />)
    const panel = await screen.findByTestId('song-preview-panel')

    expect(within(panel).getByText('Cherry Song')).toBeInTheDocument()
    expect(useSongPreviewStore.getState().track).toBe(`aetherstar-media://roots${SONG_C.mp3Path}`)
  })

  // The launch fade itself is App.tsx's (it is the only thing that knows the
  // start transition has begun -- see App.audioPolicy.test.tsx). What this
  // screen must not do is pre-empt it: stopping the preview here would kill it
  // one whole screen early, on Player Selection.
  it('"Start singing" hands the song off without silencing the preview', async () => {
    const onSongPicked = vi.fn()
    render(<SongSelector onSongPicked={onSongPicked} />)
    await screen.findByTestId('song-preview-panel')

    await userEvent.click(screen.getByRole('button', { name: 'Start singing' }))

    expect(onSongPicked).toHaveBeenCalledWith(SONG_A)
    expect(useSongPreviewStore.getState().track).toBe(`aetherstar-media://roots${SONG_A.mp3Path}`)
  })

  it('clicking a different grid card swaps the preview instead of picking the song', async () => {
    const onSongPicked = vi.fn()
    render(<SongSelector onSongPicked={onSongPicked} />)
    const grid = await screen.findByTestId('song-selector-grid')

    await userEvent.click(within(grid).getByRole('button', { name: /Banana Song/ }))

    expect(within(screen.getByTestId('song-preview-panel')).getByText('Banana Song')).toBeInTheDocument()
    expect(onSongPicked).not.toHaveBeenCalled()
  })

  it('disables "Start singing" for an unplayable song and shows why', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    const grid = await screen.findByTestId('song-selector-grid')
    await userEvent.click(within(grid).getByRole('button', { name: /Banana Song/ }))

    const startButton = screen.getByRole('button', { name: /unplayable/i })
    expect(startButton).toBeDisabled()
  })

  it('"Start singing" calls onSongPicked with the selected playable song', async () => {
    const onSongPicked = vi.fn()
    render(<SongSelector onSongPicked={onSongPicked} />)
    await screen.findByTestId('song-preview-panel')

    await userEvent.click(screen.getByRole('button', { name: 'Start singing' }))

    expect(onSongPicked).toHaveBeenCalledWith(SONG_A)
  })

  /**
   * Quick start.
   *
   * A double click on a card is the accelerator for someone who already knows
   * what they want: it commits the song without the trip to the preview panel's
   * CTA. Everything difficult about it is in the interaction, not the feature,
   * and each of those things has a test here.
   */
  describe('quick start (double click)', () => {
    it('commits the double-clicked song, with no trip to "Start singing"', async () => {
      const onSongPicked = vi.fn()
      useLibraryStore.setState({ results: [SONG_A, SONG_C] })
      vi.mocked(window.api!.library.search).mockResolvedValue([SONG_A, SONG_C])
      render(<SongSelector onSongPicked={onSongPicked} />)
      const grid = await screen.findByTestId('song-selector-grid')

      await userEvent.dblClick(within(grid).getByRole('button', { name: /Cherry Song/ }))

      expect(onSongPicked).toHaveBeenCalledTimes(1)
      expect(onSongPicked).toHaveBeenCalledWith(SONG_C)
    })

    /**
     * The interaction problem, stated where it is actually audible.
     *
     * A double click delivers `click`, `click`, `dblclick`. The second click
     * lands on the card that the first one just selected, and without
     * `handleSelect`'s early return it re-enters the same selection and replays
     * the click SFX -- so the gesture is heard as click-click-confirm, a
     * stutter on the one screen a player clicks through fastest. The preview
     * bus is checked in the same breath: exactly one change of the requested
     * track for the whole gesture, A -> C.
     */
    it('sounds and reads as one gesture: one click, one confirm, one commit', async () => {
      const play = vi.fn()
      useSfx.setState({ play })
      const onSongPicked = vi.fn()
      useLibraryStore.setState({ results: [SONG_A, SONG_C] })
      vi.mocked(window.api!.library.search).mockResolvedValue([SONG_A, SONG_C])
      render(<SongSelector onSongPicked={onSongPicked} />)
      const grid = await screen.findByTestId('song-selector-grid')

      const requests: (string | null)[] = []
      const unsubscribe = useSongPreviewStore.subscribe((state) => requests.push(state.track))
      play.mockClear()

      await userEvent.dblClick(within(grid).getByRole('button', { name: /Cherry Song/ }))
      unsubscribe()

      expect(onSongPicked).toHaveBeenCalledTimes(1)
      // 'hover' is the pointer arriving and is not part of the gesture.
      const sounds = play.mock.calls.map(([name]) => name).filter((name) => name !== 'hover')
      expect(sounds).toEqual(['click', 'confirm'])
      expect(requests).toEqual([`aetherstar-media://roots${SONG_C.mp3Path}`])
    })

    /**
     * The audio contract, which is the part a shortcut is most likely to break.
     *
     * The preview must still be *running* when the song is handed off: App.tsx
     * is the only thing that knows the start transition has begun, and it is
     * what fades the preview over PREVIEW_LAUNCH_FADE_MS so it reaches zero
     * before song_selected.wav peaks 300 ms in. A quick start that stopped the
     * preview itself would skip that handoff and cut the room to silence a
     * whole screen early.
     */
    it('leaves the preview running and never touches the audio engine', async () => {
      const onSongPicked = vi.fn()
      useLibraryStore.setState({ results: [SONG_A, SONG_C] })
      vi.mocked(window.api!.library.search).mockResolvedValue([SONG_A, SONG_C])
      render(<SongSelector onSongPicked={onSongPicked} />)
      const grid = await screen.findByTestId('song-selector-grid')

      await userEvent.dblClick(within(grid).getByRole('button', { name: /Cherry Song/ }))

      expect(useSongPreviewStore.getState().track).toBe(`aetherstar-media://roots${SONG_C.mp3Path}`)
      expect(mockAudioManager.stop).not.toHaveBeenCalled()
      expect(mockAudioManager.play).not.toHaveBeenCalled()
    })

    // The song the user double-clicked, not whatever happened to be selected.
    it('commits the card that was double-clicked even when another song is selected', async () => {
      const onSongPicked = vi.fn()
      useLibraryStore.setState({ results: [SONG_A, SONG_C] })
      vi.mocked(window.api!.library.search).mockResolvedValue([SONG_A, SONG_C])
      render(<SongSelector onSongPicked={onSongPicked} />)
      const grid = await screen.findByTestId('song-selector-grid')
      await userEvent.click(within(grid).getByRole('button', { name: /Apple Song/ }))

      fireEvent.dblClick(within(grid).getByRole('button', { name: /Cherry Song/ }))

      expect(onSongPicked).toHaveBeenCalledWith(SONG_C)
      expect(useSongPreviewStore.getState().track).toBe(`aetherstar-media://roots${SONG_C.mp3Path}`)
    })

    // The same guard "Start singing" has. A song with no audio cannot be sung,
    // and a gesture with no disabled state of its own has to check for itself.
    it('refuses to launch an unplayable song', async () => {
      const onSongPicked = vi.fn()
      render(<SongSelector onSongPicked={onSongPicked} />)
      const grid = await screen.findByTestId('song-selector-grid')

      await userEvent.dblClick(within(grid).getByRole('button', { name: /Banana Song/ }))

      expect(onSongPicked).not.toHaveBeenCalled()
    })

    // A single click still only browses. If double click had been implemented
    // by making the click itself commit, this is what would fail.
    it('leaves a single click as browse-and-preview', async () => {
      const onSongPicked = vi.fn()
      useLibraryStore.setState({ results: [SONG_A, SONG_C] })
      vi.mocked(window.api!.library.search).mockResolvedValue([SONG_A, SONG_C])
      render(<SongSelector onSongPicked={onSongPicked} />)
      const grid = await screen.findByTestId('song-selector-grid')

      await userEvent.click(within(grid).getByRole('button', { name: /Cherry Song/ }))

      expect(onSongPicked).not.toHaveBeenCalled()
      expect(useSongPreviewStore.getState().track).toBe(`aetherstar-media://roots${SONG_C.mp3Path}`)
    })

    // Couch-app rule: a pointer-only gesture can be an accelerator, never the
    // door. The gamepad's route in has to still be on screen.
    it('does not replace "Start singing", which a gamepad still needs', async () => {
      render(<SongSelector onSongPicked={vi.fn()} />)
      await screen.findByTestId('song-preview-panel')

      expect(screen.getByRole('button', { name: 'Start singing' })).toBeInTheDocument()
    })

    // The tile is memoised over a 1,200-song grid, so the handlers it is given
    // have to keep one identity across a re-render or the whole grid rebuilds
    // every time the selection moves. Asserted through the observable
    // consequence: re-rendering with a *new* onSongPicked prop must still
    // commit through the new one.
    it('commits through the current onSongPicked after a re-render', async () => {
      const first = vi.fn()
      const second = vi.fn()
      useLibraryStore.setState({ results: [SONG_A, SONG_C] })
      vi.mocked(window.api!.library.search).mockResolvedValue([SONG_A, SONG_C])
      const { rerender } = render(<SongSelector onSongPicked={first} />)
      const grid = await screen.findByTestId('song-selector-grid')

      rerender(<SongSelector onSongPicked={second} />)
      await userEvent.dblClick(within(grid).getByRole('button', { name: /Cherry Song/ }))

      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalledWith(SONG_C)
    })
  })

  // Not part of quick start, but the property it leans on: clicking the card
  // that is already previewing is a no-op rather than a re-selection, so it
  // makes no sound and does not disturb the running preview.
  it('ignores a click on the card that is already selected', async () => {
    const play = vi.fn()
    useSfx.setState({ play })
    render(<SongSelector onSongPicked={vi.fn()} />)
    const grid = await screen.findByTestId('song-selector-grid')
    const requests: (string | null)[] = []
    const unsubscribe = useSongPreviewStore.subscribe((state) => requests.push(state.track))
    play.mockClear()

    await userEvent.click(within(grid).getByRole('button', { name: /Apple Song/ }))
    unsubscribe()

    expect(play.mock.calls.map(([name]) => name).filter((name) => name !== 'hover')).toEqual([])
    expect(requests).toEqual([])
    expect(useSongPreviewStore.getState().track).toBe(`aetherstar-media://roots${SONG_A.mp3Path}`)
  })

  it('the Jump To nav filters the grid down to songs starting with the clicked letter', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    const jumpTo = await screen.findByTestId('jump-to-nav')

    await userEvent.click(within(jumpTo).getByText('B'))

    const grid = screen.getByTestId('song-selector-grid')
    expect(within(grid).queryByText('Apple Song')).not.toBeInTheDocument()
    expect(within(grid).getByText('Banana Song')).toBeInTheDocument()
  })

  describe('auto-reindex on open', () => {
    it('re-walks every library root when the selector opens', async () => {
      render(<SongSelector onSongPicked={vi.fn()} />)
      await screen.findByTestId('song-selector')

      await waitFor(() => expect(window.api!.library.rescan).toHaveBeenCalledWith('/library'))
    })

    // The party case: back to the selector after every song. A song outlasts
    // nothing else on this screen, so the cooldown has to outlast a song.
    it('does not re-walk the disk when reopened inside the cooldown', async () => {
      useLibraryStore.setState({ lastScanAt: { '/library': Date.now() } })

      render(<SongSelector onSongPicked={vi.fn()} />)
      await screen.findByTestId('song-selector')
      await waitFor(() => expect(window.api!.library.listRoots).toHaveBeenCalled())

      expect(window.api!.library.rescan).not.toHaveBeenCalled()
    })

    it('re-walks once the index has gone stale past the cooldown', async () => {
      useLibraryStore.setState({ lastScanAt: { '/library': Date.now() - REINDEX_COOLDOWN_MS - 1 } })

      render(<SongSelector onSongPicked={vi.fn()} />)
      await screen.findByTestId('song-selector')

      await waitFor(() => expect(window.api!.library.rescan).toHaveBeenCalledWith('/library'))
    })

    // The requirement the reindex must never break: someone opened this screen
    // to pick a song, not to wait for a scan of a 1,200-song library.
    it('leaves the grid on screen and fully clickable while the scan is still running', async () => {
      // A scan that never finishes -- if anything on this screen awaited it,
      // this test would hang or render empty.
      vi.mocked(window.api!.library.rescan).mockReturnValue(new Promise<void>(() => {}))

      render(<SongSelector onSongPicked={vi.fn()} />)
      const grid = await screen.findByTestId('song-selector-grid')
      await waitFor(() => expect(window.api!.library.rescan).toHaveBeenCalled())

      expect(within(grid).getByText('Apple Song')).toBeInTheDocument()
      await userEvent.click(within(grid).getByRole('button', { name: /Banana Song/ }))
      expect(within(screen.getByTestId('song-preview-panel')).getByText('Banana Song')).toBeInTheDocument()
    })

    it('reports the scan with the real parsed/found counts rather than an indeterminate spinner', async () => {
      render(<SongSelector onSongPicked={vi.fn()} />)
      await screen.findByTestId('song-selector')

      await act(async () => {
        useLibraryStore.setState({
          isReindexing: true,
          scanProgress: {
            '/library': { rootPath: '/library', songsFound: 1284, songsParsed: 412, currentPath: null, done: false, errorCount: 0 },
          },
        })
      })

      expect(screen.getByTestId('library-scan-status')).toHaveTextContent('412 / 1,284')
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '412')
    })

    it('subscribes to scan progress while open and drops the subscription when it closes', async () => {
      const unsubscribe = vi.fn()
      vi.mocked(window.api!.library.onScanProgress).mockReturnValue(unsubscribe)

      const { unmount } = render(<SongSelector onSongPicked={vi.fn()} />)
      await screen.findByTestId('song-selector')
      expect(window.api!.library.onScanProgress).toHaveBeenCalled()

      unmount()
      expect(unsubscribe).toHaveBeenCalled()
    })

    // The throttle needs an escape hatch: a host who just dropped a folder in
    // should not have to wait out the cooldown.
    it('"Refresh library" forces a re-walk even inside the cooldown', async () => {
      useLibraryStore.setState({ lastScanAt: { '/library': Date.now() } })
      render(<SongSelector onSongPicked={vi.fn()} />)
      await screen.findByTestId('song-selector')

      await userEvent.click(screen.getByRole('button', { name: /refresh library/i }))

      await waitFor(() => expect(window.api!.library.rescan).toHaveBeenCalledWith('/library'))
    })
  })

  describe('video preview', () => {
    beforeEach(() => {
      useLibraryStore.setState({ results: [SONG_WITH_VIDEO] })
      vi.mocked(window.api!.library.search).mockResolvedValue([SONG_WITH_VIDEO])
    })

    it('plays the tagged video over the cover, as an aetherstar-media:// URL', async () => {
      render(<SongSelector onSongPicked={vi.fn()} />)
      await screen.findByTestId('song-preview-panel')

      expect(screen.getByTestId('song-preview-video')).toHaveAttribute(
        'src',
        `aetherstar-media://roots${SONG_WITH_VIDEO.videoPath}`,
      )
      expect(screen.getByTestId('song-preview-cover')).toHaveAttribute(
        'src',
        `aetherstar-media://roots${SONG_WITH_VIDEO.thumbnailPath}`,
      )
    })

    // The reported bug: .mpg/.avi that Chromium refuses leaves a black box,
    // with the song's cover sitting unused behind the branch that chose video.
    it('falls back to the cover art when the video cannot be decoded', async () => {
      render(<SongSelector onSongPicked={vi.fn()} />)
      await screen.findByTestId('song-preview-panel')

      fireEvent.error(screen.getByTestId('song-preview-video'))

      expect(screen.queryByTestId('song-preview-video')).not.toBeInTheDocument()
      expect(screen.getByTestId('song-preview-cover')).toBeInTheDocument()
    })

    // Rapid clicking through the grid must not leave the previous song's frame
    // (or a half-loaded one) sitting in the panel.
    it('remounts the video element on every selection change, so no frame of the previous song survives', async () => {
      const cherryWithVideo = { ...SONG_C, videoPath: '/library/cherry/video.mp4', hasVideo: true }
      useLibraryStore.setState({ results: [SONG_WITH_VIDEO, cherryWithVideo] })
      vi.mocked(window.api!.library.search).mockResolvedValue([SONG_WITH_VIDEO, cherryWithVideo])
      render(<SongSelector onSongPicked={vi.fn()} />)
      const grid = await screen.findByTestId('song-selector-grid')

      await userEvent.click(within(grid).getByRole('button', { name: /Cherry Song/ }))

      expect(screen.getByTestId('song-preview-video')).toHaveAttribute(
        'src',
        'aetherstar-media://roots/library/cherry/video.mp4',
      )
    })

    it('keeps the preview video muted -- its audio is the separate ducked preview channel', async () => {
      render(<SongSelector onSongPicked={vi.fn()} />)
      await screen.findByTestId('song-preview-panel')

      expect((screen.getByTestId('song-preview-video') as HTMLVideoElement).muted).toBe(true)
    })
  })

  // Every dimension is a 1920x1080 reference value times one design unit, so
  // the screen at 4K is the 1080p layout at 2x rather than a corner of the TV.
  describe('filling the screen from 1080p to 4K', () => {
    it('scales the whole screen off one viewport-derived design unit', async () => {
      render(<SongSelector onSongPicked={vi.fn()} />)
      const root = await screen.findByTestId('song-selector')

      // min(vw/1920, vh/1080) is exactly 1px at 1080p and 2px at 2160p.
      expect(root.style.getPropertyValue('--u')).toContain('100vw / 1920')
      expect(root.style.getPropertyValue('--u')).toContain('100vh / 1080')
    })

    it('sizes the preview panel and its media well in design units, not a capped clamp', async () => {
      render(<SongSelector onSongPicked={vi.fn()} />)
      const panel = await screen.findByTestId('song-preview-panel')

      expect(panel.style.width).toBe('calc(400 * var(--u))')
      expect(panel.style.padding).toBe('calc(26 * var(--u))')
      expect(screen.getByTestId('song-preview-media').style.height).toBe('calc(300 * var(--u))')
    })

    // auto-fill against a design-unit minimum rather than a fixed column count:
    // 1060 design units of grid at 16:9 fits exactly five columns
    // at *any* resolution, while a genuinely wider screen (21:9) gets more
    // columns instead of five stretched ones.
    it('lays the grid out in five columns at 16:9 at every resolution', () => {
      // The grid is 1060 design units wide at 16:9 (plus the 7px focus gutter
      // each side): five columns at 1080p and at 4K alike.
      const at1080 = songGridGeometry(1060 + 14, 1)
      const at4k = songGridGeometry(2120 + 14, 2)
      expect(at1080.columns).toBe(5)
      expect(at4k.columns).toBe(5)
      expect(at1080.gapPx).toBe(22)
      expect(at4k.cardPx).toBeCloseTo(at1080.cardPx * 2, 5)
      // A genuinely wider screen gets more columns, not wider cards.
      expect(songGridGeometry(1600, 1).columns).toBeGreaterThan(5)
      // Each row is one square card plus the gap under it.
      expect(at1080.rowHeightPx).toBeCloseTo(at1080.cardPx + 22, 5)
    })

    // A TV screen does not scroll as a page. The header, the preview panel and
    // the shortcuts bar stay put and only the song list moves, which is also
    // what keeps the committed action ("Start singing") permanently on screen.
    it('scrolls the song list on its own instead of scrolling the page', async () => {
      render(<SongSelector onSongPicked={vi.fn()} />)
      const root = await screen.findByTestId('song-selector')

      expect(root.className).toContain('overflow-hidden')
      expect(screen.getByTestId('song-selector-grid').style.overflowY).toBe('auto')
    })

    // Which card is previewing is carried by a cyan ring, a brighter border and
    // a filled play badge -- all colour. Assistive technology gets none of
    // that, so the state is also on the element itself.
    it('marks the previewing card as current for assistive technology, not only in colour', async () => {
      render(<SongSelector onSongPicked={vi.fn()} />)
      const grid = await screen.findByTestId('song-selector-grid')

      await userEvent.click(within(grid).getByRole('button', { name: /Banana Song/ }))

      expect(within(grid).getByRole('button', { name: /Banana Song/ })).toHaveAttribute('aria-current', 'true')
      expect(within(grid).getByRole('button', { name: /Apple Song/ })).not.toHaveAttribute('aria-current')
    })

    // The app's single focus treatment is a 3px outline at a 3px offset, drawn
    // *outside* the card. A scroll container with no gutter clips it on all
    // four edges, which on a couch UI means losing the only cue that says
    // where you are.
    it('leaves a gutter inside the scroll containers so the focus outline is never clipped', async () => {
      render(<SongSelector onSongPicked={vi.fn()} />)
      const grid = await screen.findByTestId('song-selector-grid')
      // Rows are absolutely positioned, so the gutter lives inside each row.
      const card = within(grid).getByRole('button', { name: /Apple Song/ })
      const rowGrid = card.parentElement as HTMLElement

      expect(parseFloat(rowGrid.style.paddingInline)).toBeGreaterThanOrEqual(6)
      expect(parseFloat(rowGrid.style.paddingTop)).toBeGreaterThanOrEqual(6)
      expect(parseFloat(screen.getByTestId('jump-to-nav').style.padding)).toBeGreaterThanOrEqual(6)
    })
  })

  it('the Duets shortcut toggles the real duetOnly filter via useLibraryStore.search', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    await screen.findByTestId('song-selector')

    fireEvent.click(screen.getByRole('button', { name: 'Duets' }))

    expect(window.api!.library.search).toHaveBeenCalledWith(expect.objectContaining({ duetOnly: true }))
  })

  it('clicking the Party segmented pill switches the session to party mode', async () => {
    useSessionStore.setState({ mode: 'classic', phase: 'select' })
    render(<SongSelector onSongPicked={vi.fn()} />)
    await screen.findByTestId('song-selector')

    fireEvent.click(screen.getByRole('button', { name: 'Party' }))
    expect(useSessionStore.getState().mode).toBe('party')
    expect(useSessionStore.getState().phase).toBe('party-draw')
  })
})


function stubAudioManager() {
  vi.mocked(useWebAudioManager.getState).mockReturnValue({
    play: vi.fn(),
    duckTo: vi.fn(),
    restore: vi.fn(),
    crossfadeTo: vi.fn(),
    stop: vi.fn(),
  } as unknown as ReturnType<typeof useWebAudioManager.getState>)
}

function seedLibrary(songs: LibrarySong[], extraApi: Record<string, unknown> = {}) {
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
  useSongPreviewStore.setState({ track: null })
  stubAudioManager()
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
    ...extraApi,
  } as unknown as Window['api']
}

describe('SongSelector, a large library', () => {
  const many: LibrarySong[] = Array.from({ length: 400 }, (_, index) => ({
    ...SONG_A,
    path: `/library/song-${String(index).padStart(3, '0')}`,
    title: `Song ${String(index).padStart(3, '0')}`,
    thumbnailPath: `/library/song-${index}/cover.jpg`,
  }))

  beforeEach(() => seedLibrary(many))

  it('renders only the rows in view, not every song in the library', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    const grid = await screen.findByTestId('song-selector-grid')
    const cards = within(grid).getAllByRole('button')

    expect(cards.length).toBeGreaterThan(0)
    expect(cards.length).toBeLessThan(many.length)
  })

  it('loads covers lazily and draws no blur on any card', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    const grid = await screen.findByTestId('song-selector-grid')

    const covers = grid.querySelectorAll('img')
    expect(covers.length).toBeGreaterThan(0)
    covers.forEach((cover) => {
      expect(cover).toHaveAttribute('loading', 'lazy')
      expect(cover).toHaveAttribute('decoding', 'async')
    })
    grid.querySelectorAll<HTMLElement>('*').forEach((node) => {
      expect(node.style.backdropFilter ?? '').toBe('')
    })
  })
})

describe('SongSelector modes, filters and records', () => {
  beforeEach(() => {
    useSessionStore.setState({ mode: 'classic', phase: 'select' })
    seedLibrary([
      { ...SONG_A, language: 'English' },
      { ...SONG_C, language: 'German' },
    ], {
      players: { list: vi.fn().mockResolvedValue([{ id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' }]) },
      session: {
        listSongHighscores: vi.fn().mockResolvedValue([
          { sessionId: 's', songPath: '/library/apple', playerId: 'p1', score: 8450, epicCount: 0, goodCount: 0, awfulCount: 0, playedAt: 1, difficulty: 'hard' },
        ]),
      },
    })
  })

  it('offers Solo/Duet, Versus and Party, and no Relay', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    const modes = await screen.findByTestId('mode-segmented-control')

    expect(within(modes).getAllByRole('button').map((button) => button.textContent)).toEqual(['Solo/Duet', 'Versus', 'Party'])
    fireEvent.click(within(modes).getByRole('button', { name: 'Versus' }))
    expect(useSessionStore.getState().mode).toBe('battle')
  })

  it('no longer guesses a difficulty from the BPM', async () => {
    vi.mocked(window.api!.session.listSongHighscores!).mockResolvedValue([])
    render(<SongSelector onSongPicked={vi.fn()} />)
    await screen.findByText('No highscore yet')
    const panel = await screen.findByTestId('song-preview-panel')

    expect(within(panel).queryByText(/^(easy|medium|hard)$/i)).not.toBeInTheDocument()
  })

  it('shows the selected song record and who holds it', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)

    const record = await screen.findByTestId('song-highscore')
    expect(record).toHaveTextContent('Hard')
    expect(record).toHaveTextContent((8450).toLocaleString())
    await waitFor(() => expect(record).toHaveTextContent('Alex'))
    expect(window.api!.session.listSongHighscores).toHaveBeenCalledWith({ songPath: '/library/apple', limit: 1 })
  })

  it('cycles the sort order from one chip', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    await screen.findByTestId('song-selector')

    fireEvent.click(screen.getByRole('button', { name: 'Sort: Artist' }))
    expect(window.api!.library.search).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'title' }))
    await screen.findByRole('button', { name: 'Sort: Title' })
  })

  it('filters by language once the library has more than one', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Language: All' }))

    expect(window.api!.library.search).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'English' }))
  })

  it('waits for typing to pause before searching, and never re-reads the library for it', async () => {
    render(<SongSelector onSongPicked={vi.fn()} />)
    await screen.findByTestId('song-selector')
    await waitFor(() => expect(useLibraryStore.getState().searchBase).not.toBeNull())
    vi.mocked(window.api!.library.search).mockClear()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'cher' } })
    expect(useLibraryStore.getState().filters.query).toBeUndefined()

    await waitFor(() => expect(useLibraryStore.getState().filters.query).toBe('cher'))
    expect(window.api!.library.search).not.toHaveBeenCalled()
  })
})
