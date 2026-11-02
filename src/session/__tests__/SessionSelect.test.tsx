import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionSelect } from '../SessionSelect'
import { useSessionStore } from '../sessionStore'
import { useLibraryStore } from '../../library/useLibraryStore'
import { useWebAudioManager } from '../../audio/useWebAudioManager'
import type { LibrarySong } from '../../library/types'

vi.mock('../../audio/useWebAudioManager', () => ({
  useWebAudioManager: { getState: vi.fn() },
}))

const SONG: LibrarySong = {
  path: '/library/nova',
  artist: 'Nova Lane',
  title: 'Paper Satellites',
  durationMs: 180000,
  thumbnailPath: null,
  mp3Path: '/library/nova/song.mp3',
  videoPath: null,
  bpm: 250,
  gap: 24065,
  hasVideo: true,
  hasCover: true,
  isDuet: false,
  isPlayable: true,
  addedAt: 1,
}

describe('SessionSelect', () => {
  beforeEach(() => {
    useLibraryStore.setState({ roots: [{ path: '/library', addedAt: 1 }], results: [SONG], scanProgress: {}, scanErrors: [], filters: {} })
    useSessionStore.setState({ phase: 'select', selectedSong: null, assignedPlayerIds: [], lastResult: null, songsPlayedThisSession: 0 })
    vi.mocked(useWebAudioManager.getState).mockReturnValue({
      play: vi.fn(),
      duckTo: vi.fn(),
      restore: vi.fn(),
      crossfadeTo: vi.fn(),
      stop: vi.fn(),
    })
    window.api = {
      openFile: vi.fn(),
      library: {
        addRoot: vi.fn(),
        removeRoot: vi.fn(),
        listRoots: vi.fn().mockResolvedValue([{ path: '/library', addedAt: 1 }]),
        rescan: vi.fn(),
        search: vi.fn().mockResolvedValue([SONG]),
        getSong: vi.fn(),
        listScanErrors: vi.fn().mockResolvedValue([]),
        onScanProgress: vi.fn().mockReturnValue(() => {}),
      },
    } as unknown as Window['api']
  })

  it('renders the song selector screen', async () => {
    render(<SessionSelect />)
    expect(await screen.findByTestId('song-selector')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Start singing' })).toBeInTheDocument()
  })

  it('clicking a grid card selects/previews it without advancing the session', async () => {
    render(<SessionSelect />)
    const grid = await screen.findByTestId('song-selector-grid')

    await userEvent.click(within(grid).getByRole('button', { name: /Paper Satellites/ }))

    expect(useSessionStore.getState().phase).toBe('select')
    expect(useSessionStore.getState().selectedSong).toBeNull()
  })

  it('"Start singing" calls sessionStore.pickSong and advances to assign', async () => {
    render(<SessionSelect />)
    await screen.findByTestId('song-selector')

    await userEvent.click(screen.getByRole('button', { name: 'Start singing' }))

    expect(useSessionStore.getState().selectedSong).toEqual(SONG)
    expect(useSessionStore.getState().phase).toBe('assign')
  })
})
