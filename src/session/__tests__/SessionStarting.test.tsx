import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionStarting } from '../SessionStarting'
import { useSessionStore } from '../sessionStore'
import { resetChartCacheForTests } from '../../stage/chart/useChartLoader'
import type { LibrarySong } from '../../library/types'

vi.mock('../../audio/useSfx', () => {
  const play = vi.fn()
  return { useSfx: Object.assign((selector: (s: { play: typeof play }) => unknown) => selector({ play }), { getState: () => ({ play }) }) }
})

const SONG: LibrarySong = {
  path: '/library/major-tom',
  artist: 'Mira Castell',
  title: 'Orbit Seven',
  durationMs: 240000,
  thumbnailPath: '/library/.aetherstar/thumbnails/major-tom.jpg',
  mp3Path: '/library/major-tom/song.mp3',
  videoPath: null,
  bpm: 200,
  gap: 0,
  hasVideo: false,
  hasCover: true,
  isDuet: false,
  isPlayable: true,
  addedAt: 1,
}

function setSong(song: LibrarySong | null) {
  useSessionStore.setState({ phase: 'starting', selectedSong: song, assignedPlayerIds: ['p1'] })
}

describe('SessionStarting', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setSong(SONG)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    // Module-level singleton that outlives both the React tree and this
    // test's `fetch` stub (see useChartLoader).
    resetChartCacheForTests()
  })

  it('shows the selected song s title and artist', () => {
    render(<SessionStarting />)
    expect(screen.getByTestId('transition-song-title')).toHaveTextContent('Orbit Seven')
    expect(screen.getByText('Mira Castell')).toBeInTheDocument()
  })

  it('serves the cover through the privileged library-media scheme, never a raw filesystem path', () => {
    render(<SessionStarting />)
    expect(screen.getByTestId('transition-cover')).toHaveAttribute(
      'src',
      'aetherstar-media://roots/library/.aetherstar/thumbnails/major-tom.jpg',
    )
  })

  it('renders without a cover when the library never produced a thumbnail for the song', () => {
    setSong({ ...SONG, thumbnailPath: null, hasCover: false })
    render(<SessionStarting />)
    expect(screen.queryByTestId('transition-cover')).not.toBeInTheDocument()
    expect(screen.getByTestId('transition-song-title')).toHaveTextContent('Orbit Seven')
  })

  it('renders without a cover when no song is selected at all', () => {
    setSong(null)
    render(<SessionStarting />)
    expect(screen.queryByTestId('transition-cover')).not.toBeInTheDocument()
  })

  /**
   * The transition holds the screen for its measured 4750ms, and until this
   * nothing at all was done on the song's behalf during it: the chart was
   * first fetched, decoded and parsed when `session-play` mounted -- after the
   * countdown had already reached "1" -- so the reward for the count was a
   * "Loading..." panel.
   */
  it('warms the chart while the transition runs, instead of leaving the fetch until after the countdown', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })
    vi.stubGlobal('fetch', fetchMock)

    render(<SessionStarting />)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/library/major-tom')
  })

  it('advances the session to the play phase when the transition finishes', () => {
    render(<SessionStarting />)

    act(() => void vi.advanceTimersByTime(10000))

    expect(useSessionStore.getState().phase).toBe('play')
  })
})
