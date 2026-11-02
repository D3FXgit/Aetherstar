import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect, type ReactNode, type RefObject } from 'react'
import { JukeboxScene } from '../JukeboxScene'
import { useJukeboxUiStore, TRANSPORT_HIDE_DELAY_MS } from '../jukeboxUiStore'
import { useSessionStore } from '../../session/sessionStore'
import { useSceneStore } from '../../scenes/sceneStore'
import { useLibraryStore } from '../../library/useLibraryStore'
import { usePauseStore } from '../../stage/pause/pauseStore'
import { useAppPreferencesStore } from '../../settings/appPreferencesStore'
import type { StageControl } from '../../stage/Stage'
import type { LibrarySong } from '../../library/types'

/** The stage's transport handle, as the real Stage would expose it: a song at 30 s of 200 s. */
const control = {
  time: 30,
  getTime: vi.fn(() => control.time),
  getStartTime: vi.fn(() => 0),
  getEndTime: vi.fn<() => number | null>(() => 200),
  seek: vi.fn((seconds: number) => {
    control.time = seconds
  }),
}

interface MockStageProps {
  overlay?: (clock: unknown) => ReactNode
  onEnded?: () => void
  skipLeadIn?: boolean
  showSongCard?: boolean
  controlRef?: RefObject<StageControl | null>
}
const stageProps: MockStageProps[] = []
let stageMounts = 0

vi.mock('../../stage/Stage', () => ({
  Stage: (props: MockStageProps) => {
    stageProps.push(props)
    if (props.controlRef) props.controlRef.current = control
    useEffect(() => {
      stageMounts += 1
    }, [])
    return <div data-testid="stage" />
  },
}))

vi.mock('../../stage/chart/useChartLoader', () => ({
  useChartLoader: (path: string | null) => ({
    status: path ? 'ready' : 'idle',
    chart: path ? { meta: { title: 'T', artist: 'A', gap: 0, bpm: 120 }, lines: [] } : null,
    sourceDir: path,
    error: null,
  }),
}))

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
const NEXT: LibrarySong = { ...SONG, path: '/library/next', title: 'Next Song', artist: 'Next Artist' }
const THIRD: LibrarySong = { ...SONG, path: '/library/third', title: 'Third Song', artist: 'Third Artist' }
const FOURTH: LibrarySong = { ...SONG, path: '/library/fourth', title: 'Fourth Song', artist: 'Fourth Artist' }

const key = (name: string) => fireEvent.keyDown(document.activeElement ?? document.body, { key: name })

describe('JukeboxScene', () => {
  beforeEach(() => {
    localStorage.clear()
    stageProps.length = 0
    stageMounts = 0
    control.time = 30
    control.seek.mockClear()
    control.getEndTime.mockImplementation(() => 200)
    window.api = { library: { recordPlay: vi.fn().mockResolvedValue(true), setGameplayActive: vi.fn() } } as unknown as Window['api']
    useSceneStore.setState({ current: 'session-select', history: [] })
    useLibraryStore.setState({ searchBase: { key: 'k', songs: [SONG, NEXT, THIRD, FOURTH] }, results: [], favorites: new Set() })
    usePauseStore.getState().reset()
    useSessionStore.setState({
      mode: 'jukebox',
      phase: 'select',
      jukeboxQueue: [NEXT],
      jukeboxHistory: [],
      jukeboxCycle: [],
      jukeboxMenuOpen: false,
      jukeboxFinished: false,
      jukeboxShuffle: false,
      jukeboxRepeat: 'off',
      jukeboxAutoplay: true,
    })
    useSessionStore.getState().playJukeboxNow(SONG)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('plays the song on the stage with no gameplay overlay, and says what is playing and what is next', () => {
    render(<JukeboxScene />)

    expect(screen.getByTestId('stage')).toBeInTheDocument()
    expect(stageProps.at(-1)?.overlay).toBeUndefined()
    expect(stageProps.at(-1)).toMatchObject({ skipLeadIn: true, showSongCard: false })
    // The lyrics layer follows the measured lift, so the transport bar never covers them.
    expect(String((stageProps.at(-1) as { chromeStyle?: { translate?: string } }).chromeStyle?.translate)).toContain(
      '--jukebox-lyric-lift',
    )
    expect(screen.getByTestId('jukebox-now-playing')).toHaveTextContent('Paper Satellites')
    expect(screen.getByTestId('jukebox-transport-now-playing')).toHaveTextContent('Nova Lane')
    expect(screen.getByTestId('jukebox-up-next')).toHaveTextContent('Next Song')
    expect(window.api!.library.setGameplayActive).toHaveBeenCalledWith(true)
  })

  it('moves on to the next queued song when one ends', () => {
    render(<JukeboxScene />)
    act(() => stageProps.at(-1)!.onEnded!())
    expect(useSessionStore.getState().selectedSong).toEqual(NEXT)
  })

  it('opens the menu on Back, focuses it, and closes it on Escape', () => {
    render(<JukeboxScene />)
    act(() => useSessionStore.getState().back())

    const menu = screen.getByTestId('jukebox-menu')
    expect(menu).toHaveAttribute('data-focus-scope')
    expect(screen.getByRole('button', { name: 'Keep listening' })).toHaveFocus()

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByTestId('jukebox-menu')).not.toBeInTheDocument()
  })

  it('skips to the next song, or goes back to the list, from the menu', async () => {
    render(<JukeboxScene />)
    act(() => useSessionStore.getState().setJukeboxMenuOpen(true))
    await userEvent.click(screen.getByRole('button', { name: 'Skip song' }))
    expect(useSessionStore.getState()).toMatchObject({ selectedSong: NEXT, jukeboxMenuOpen: false })

    act(() => useSessionStore.getState().setJukeboxMenuOpen(true))
    await userEvent.click(screen.getByRole('button', { name: 'Back to the list' }))
    expect(useSessionStore.getState().phase).toBe('select')
    expect(useSceneStore.getState().current).toBe('session-select')
  })

  describe('the transport bar', () => {
    it('pauses the song through the pause store and resumes it with no lead-in', async () => {
      render(<JukeboxScene />)
      await userEvent.click(screen.getByTestId('jukebox-transport-play'))
      expect(usePauseStore.getState().phase).toBe('menu')
      expect(screen.getByTestId('jukebox-transport-play')).toHaveAccessibleName('Play')
      // The singer's pause menu is not the jukebox's.
      expect(screen.queryByTestId('pause-menu')).not.toBeInTheDocument()

      await userEvent.click(screen.getByTestId('jukebox-transport-play'))
      expect(usePauseStore.getState()).toMatchObject({ phase: 'running', resumeCountdown: null, lastTransition: 'resume' })
      expect(screen.getByTestId('jukebox-transport-play')).toHaveAccessibleName('Pause')
    })

    it('shows the time and seeks where the bar is clicked', () => {
      render(<JukeboxScene />)
      expect(screen.getByTestId('jukebox-elapsed')).toHaveTextContent('0:30')
      expect(screen.getByTestId('jukebox-remaining')).toHaveTextContent('−2:50')

      const seek = screen.getByTestId('jukebox-seek')
      expect(seek).toHaveAttribute('aria-valuetext', '0:30 of 3:20')
      vi.spyOn(seek, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 400, top: 0, height: 32 } as DOMRect)
      fireEvent.pointerDown(seek, { clientX: 100, pointerId: 1 })
      fireEvent.pointerUp(seek, { clientX: 100, pointerId: 1 })
      expect(control.seek).toHaveBeenCalledWith(50)
    })

    // A song on stems (the demo song) used to report no length: the knob sat
    // at 0 with no remaining time while the elapsed time ran.
    it('shows the elapsed time alone until the length is known, then the knob and the remaining time', () => {
      vi.useFakeTimers()
      control.time = 9
      control.getEndTime.mockImplementation(() => null)
      render(<JukeboxScene />)
      const seek = screen.getByTestId('jukebox-seek')
      expect(screen.getByTestId('jukebox-elapsed')).toHaveTextContent('0:09')
      expect(screen.getByTestId('jukebox-remaining')).toHaveTextContent(/^$/)
      expect(seek).toHaveAttribute('aria-valuemax', '0')

      // The clock's metadata lands: the bar picks it up on its next read.
      control.getEndTime.mockImplementation(() => 48)
      act(() => vi.advanceTimersByTime(300))
      expect(screen.getByTestId('jukebox-remaining')).toHaveTextContent('−0:39')
      expect(seek).toHaveAttribute('aria-valuemax', '48')
      expect(seek).toHaveAttribute('aria-valuetext', '0:09 of 0:48')
    })

    it('never shows a remaining time for a length that is not a number', () => {
      control.getEndTime.mockImplementation(() => Infinity)
      render(<JukeboxScene />)
      expect(screen.getByTestId('jukebox-elapsed')).toHaveTextContent('0:30')
      expect(screen.getByTestId('jukebox-remaining')).toHaveTextContent(/^$/)
      expect(screen.getByTestId('jukebox-seek')).toHaveAttribute('aria-valuetext', '0:30')
    })

    it('Previous restarts a song that is past its first three seconds, else goes back one song', async () => {
      render(<JukeboxScene />)
      act(() => useSessionStore.getState().nextJukeboxSong())
      expect(useSessionStore.getState().selectedSong).toEqual(NEXT)

      await userEvent.click(screen.getByTestId('jukebox-transport-previous'))
      expect(control.seek).toHaveBeenCalledWith(0)
      expect(useSessionStore.getState().selectedSong).toEqual(NEXT)

      control.time = 1
      await userEvent.click(screen.getByTestId('jukebox-transport-previous'))
      expect(useSessionStore.getState().selectedSong).toEqual(SONG)
      expect(useSessionStore.getState().jukeboxQueue[0]).toEqual(NEXT)
    })

    it('toggles shuffle and steps through the repeat modes', async () => {
      render(<JukeboxScene />)
      await userEvent.click(screen.getByTestId('jukebox-transport-shuffle'))
      expect(useSessionStore.getState().jukeboxShuffle).toBe(true)
      expect(screen.getByTestId('jukebox-transport-shuffle')).toHaveAttribute('aria-pressed', 'true')

      const repeat = screen.getByTestId('jukebox-transport-repeat')
      expect(repeat).toHaveAccessibleName('Repeat: off')
      await userEvent.click(repeat)
      expect(repeat).toHaveAccessibleName('Repeat: all')
      await userEvent.click(repeat)
      expect(repeat).toHaveAccessibleName('Repeat: this song')
      expect(useSessionStore.getState().jukeboxRepeat).toBe('one')
    })

    it('sets the music channel of the mixer, and mutes and unmutes it', async () => {
      useAppPreferencesStore.getState().setMixerVolume('music', 0.6)
      render(<JukeboxScene />)
      fireEvent.change(within(screen.getByTestId('jukebox-transport')).getByRole('slider', { name: 'Music volume' }), {
        target: { value: '0.4' },
      })
      expect(useAppPreferencesStore.getState().mixer.music).toBe(0.4)

      await userEvent.click(screen.getByRole('button', { name: 'Mute' }))
      expect(useAppPreferencesStore.getState().mixer.music).toBe(0)
      await userEvent.click(screen.getByRole('button', { name: 'Unmute' }))
      expect(useAppPreferencesStore.getState().mixer.music).toBe(0.4)
    })

    it('hides after three seconds without input, comes back on any key, and stays up while paused', () => {
      vi.useFakeTimers()
      render(<JukeboxScene />)
      const bar = screen.getByTestId('jukebox-transport')
      expect(bar).toHaveAttribute('data-visible', 'true')

      act(() => vi.advanceTimersByTime(TRANSPORT_HIDE_DELAY_MS + 50))
      expect(bar).toHaveAttribute('data-visible', 'false')

      act(() => {
        key('Shift')
      })
      expect(bar).toHaveAttribute('data-visible', 'true')

      act(() => {
        key(' ')
      })
      expect(usePauseStore.getState().phase).toBe('menu')
      act(() => vi.advanceTimersByTime(TRANSPORT_HIDE_DELAY_MS * 3))
      expect(bar).toHaveAttribute('data-visible', 'true')
    })
  })

  describe('keyboard shortcuts', () => {
    it('Space and K play and pause', () => {
      render(<JukeboxScene />)
      act(() => {
        key(' ')
      })
      expect(usePauseStore.getState().phase).toBe('menu')
      act(() => {
        key('k')
      })
      expect(usePauseStore.getState().phase).toBe('running')
    })

    it('←/→ seek ten seconds', () => {
      render(<JukeboxScene />)
      act(() => {
        key('ArrowRight')
      })
      expect(control.seek).toHaveBeenLastCalledWith(40)
      act(() => {
        key('ArrowLeft')
      })
      expect(control.seek).toHaveBeenLastCalledWith(30)
    })

    it('N skips and P goes back', () => {
      render(<JukeboxScene />)
      act(() => {
        key('n')
      })
      expect(useSessionStore.getState().selectedSong).toEqual(NEXT)
      control.time = 0.5
      act(() => {
        key('p')
      })
      expect(useSessionStore.getState().selectedSong).toEqual(SONG)
    })

    it('↑ brings the bar up with focus on Play/Pause', () => {
      render(<JukeboxScene />)
      act(() => {
        key('ArrowUp')
      })
      expect(screen.getByTestId('jukebox-transport-play')).toHaveFocus()
    })

    it('Q opens the Up next panel; Back closes it before it opens the menu', () => {
      render(<JukeboxScene />)
      act(() => {
        key('q')
      })
      const panel = screen.getByTestId('jukebox-queue-panel')
      expect(panel).toHaveAttribute('data-focus-scope')
      expect(within(panel).getByTestId('jukebox-queue-add')).toHaveFocus()

      act(() => useSessionStore.getState().back())
      expect(screen.queryByTestId('jukebox-queue-panel')).not.toBeInTheDocument()
      expect(useSessionStore.getState().jukeboxMenuOpen).toBe(false)

      act(() => useSessionStore.getState().back())
      expect(screen.getByTestId('jukebox-menu')).toBeInTheDocument()
    })
  })

  describe('the Up next panel', () => {
    it('lists the queue and moves, removes and clears songs', async () => {
      useSessionStore.setState({ jukeboxQueue: [NEXT, THIRD, FOURTH] })
      render(<JukeboxScene />)
      act(() => useJukeboxUiStore.getState().setQueueOpen(true))
      const panel = screen.getByTestId('jukebox-queue-panel')
      expect(within(panel).getAllByTestId('jukebox-queue-panel-item').map((item) => item.textContent)).toEqual([
        expect.stringContaining('Next Song'),
        expect.stringContaining('Third Song'),
        expect.stringContaining('Fourth Song'),
      ])

      await userEvent.click(within(panel).getByRole('button', { name: 'Move Fourth Song up' }))
      expect(useSessionStore.getState().jukeboxQueue.map((song) => song.title)).toEqual(['Next Song', 'Fourth Song', 'Third Song'])
      // Focus follows the song it moved.
      expect(within(panel).getByRole('button', { name: 'Move Fourth Song up' })).toHaveFocus()

      await userEvent.click(within(panel).getByRole('button', { name: 'Remove Next Song from the queue' }))
      expect(useSessionStore.getState().jukeboxQueue.map((song) => song.title)).toEqual(['Fourth Song', 'Third Song'])

      await userEvent.click(within(panel).getByTestId('jukebox-queue-clear'))
      expect(useSessionStore.getState().jukeboxQueue).toEqual([])
      expect(within(panel).getByTestId('jukebox-queue-empty')).toBeInTheDocument()
    })

    it('switches autoplay', async () => {
      render(<JukeboxScene />)
      act(() => useJukeboxUiStore.getState().setQueueOpen(true))
      await userEvent.click(screen.getByRole('checkbox', { name: 'Autoplay random songs' }))
      expect(useSessionStore.getState().jukeboxAutoplay).toBe(false)
    })
  })

  describe('adding songs', () => {
    it('adds picked songs to the queue without interrupting the song that is playing', async () => {
      render(<JukeboxScene />)
      const playId = useSessionStore.getState().jukeboxPlayId
      const mounts = stageMounts
      act(() => useJukeboxUiStore.getState().setQueueOpen(true))
      await userEvent.click(screen.getByTestId('jukebox-queue-add'))

      const browser = screen.getByTestId('jukebox-add-songs')
      expect(browser).toHaveAttribute('data-focus-scope')
      await userEvent.click(within(browser).getByRole('button', { name: /Third Song/ }))
      await userEvent.click(within(browser).getByRole('button', { name: /Fourth Song/ }))

      expect(useSessionStore.getState().jukeboxQueue.map((song) => song.title)).toEqual(['Next Song', 'Third Song', 'Fourth Song'])
      expect(within(browser).getByTestId('jukebox-add-songs-status')).toHaveTextContent('Added Fourth Song to the queue')
      // The song never stopped: same play, same stage, still running.
      expect(useSessionStore.getState()).toMatchObject({ selectedSong: SONG, jukeboxPlayId: playId, phase: 'jukebox' })
      expect(stageMounts).toBe(mounts)
      expect(usePauseStore.getState().phase).toBe('running')
      expect(control.seek).not.toHaveBeenCalled()

      // Back closes the browser first, back to the panel.
      act(() => useSessionStore.getState().back())
      expect(screen.queryByTestId('jukebox-add-songs')).not.toBeInTheDocument()
      expect(screen.getByTestId('jukebox-queue-panel')).toBeInTheDocument()
    })

    it('searches the library in place', async () => {
      render(<JukeboxScene />)
      act(() => useJukeboxUiStore.getState().setAddSongsOpen(true))
      const browser = screen.getByTestId('jukebox-add-songs')
      await userEvent.type(within(browser).getByRole('searchbox'), 'Fourth')
      expect(within(browser).getByRole('button', { name: /Fourth Song/ })).toBeInTheDocument()
      expect(within(browser).queryByRole('button', { name: /Third Song/ })).not.toBeInTheDocument()
    })
  })

  describe('when the queue runs out', () => {
    it('shows "Queue finished" with Add songs and Back to the list', async () => {
      useSessionStore.setState({ jukeboxQueue: [], jukeboxAutoplay: false })
      render(<JukeboxScene />)
      act(() => stageProps.at(-1)!.onEnded!())

      const card = screen.getByTestId('jukebox-finished')
      expect(card).toHaveTextContent('Queue finished')
      expect(screen.queryByTestId('jukebox-transport')).not.toBeInTheDocument()

      await userEvent.click(within(card).getByTestId('jukebox-finished-add'))
      const browser = screen.getByTestId('jukebox-add-songs')
      await userEvent.click(within(browser).getByRole('button', { name: /Third Song/ }))
      // Nothing was playing, so the song starts straight away.
      expect(useSessionStore.getState()).toMatchObject({ selectedSong: THIRD, jukeboxFinished: false })
    })

    it('Back from the finished card goes to the list', () => {
      useSessionStore.setState({ jukeboxQueue: [], jukeboxAutoplay: false })
      render(<JukeboxScene />)
      act(() => stageProps.at(-1)!.onEnded!())
      act(() => useSessionStore.getState().back())
      expect(useSessionStore.getState().phase).toBe('select')
      expect(useSceneStore.getState().current).toBe('session-select')
    })

    it('keeps going with a random song when autoplay is on', () => {
      useSessionStore.setState({ jukeboxQueue: [] })
      render(<JukeboxScene />)
      act(() => stageProps.at(-1)!.onEnded!())
      expect(useSessionStore.getState().jukeboxFinished).toBe(false)
      expect(useSessionStore.getState().selectedSong).not.toEqual(SONG)
    })
  })
})
