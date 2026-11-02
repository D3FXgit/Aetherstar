import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionPlay } from '../SessionPlay'
import { useSessionStore } from '../sessionStore'
import { useHitStore } from '../../game/state/useHitStore'
import { useScoreStore } from '../../game/state/useScoreStore'
import { usePauseStore } from '../../stage/pause/pauseStore'
import type { LibrarySong } from '../../library/types'

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

let capturedProps: { chartPath?: string; assignedPlayerIds?: string[]; onSongEnded?: () => void } = {}

vi.mock('../../scenes/Sing', () => ({
  Sing: (props: { chartPath?: string; assignedPlayerIds?: string[]; onSongEnded?: () => void }) => {
    capturedProps = props
    return <div data-testid="sing-stub" />
  },
}))

describe('SessionPlay', () => {
  beforeEach(() => {
    capturedProps = {}
    useSessionStore.setState({ phase: 'play', selectedSong: SONG, assignedPlayerIds: ['p1'], lastResult: null, songsPlayedThisSession: 0 })
    useHitStore.getState().reset()
    useScoreStore.getState().reset({ players: [{ playerId: 'p1', name: 'Alex', score: 4200, combo: 3, rank: 1 }], combo: 3, rank: ['p1'] })
    // @ts-expect-error -- only the members exercised here are stubbed
    window.api = { audience: { reportScoreState: vi.fn() } }
  })

  it('renders Sing with chartPath/assignedPlayerIds derived from sessionStore', () => {
    render(<SessionPlay />)
    expect(screen.getByTestId('sing-stub')).toBeInTheDocument()
    expect(capturedProps.chartPath).toBe(SONG.path)
    expect(capturedProps.assignedPlayerIds).toEqual(['p1'])
  })

  it('calls sessionStore.finishSong with the accumulated result when the song ends', async () => {
    render(<SessionPlay />)
    const initialHandler = capturedProps.onSongEnded

    act(() => {
      useHitStore.getState().recordHit({ playerId: 'p1', tier: 'epic', noteId: 'note-0', deviationCents: 0, t: Date.now() })
      useHitStore.getState().recordHit({ playerId: 'p1', tier: 'good', noteId: 'note-1', deviationCents: 0, t: Date.now() })
    })

    // SessionPlay re-renders with a fresh onSongEnded closure over the new
    // tallies once useSessionScoreReporting's subscribed setTallies settles.
    await waitFor(() => expect(capturedProps.onSongEnded).not.toBe(initialHandler))

    act(() => {
      capturedProps.onSongEnded?.()
    })

    const state = useSessionStore.getState()
    expect(state.phase).toBe('results')
    expect(state.lastResult).toEqual([
      {
        playerId: 'p1',
        score: 4200,
        epicCount: 1,
        goodCount: 1,
        awfulCount: 0,
        bestLine: null,
        lineCounts: { perfect: 0, great: 0, good: 0, ok: 0 },
      },
    ])
  })

  it('calls sessionStore.finishSong with one result per assigned player when several players are singing at once', async () => {
    useSessionStore.setState({ assignedPlayerIds: ['p1', 'p2'] })
    useScoreStore.getState().reset({
      players: [
        { playerId: 'p1', name: 'Alex', score: 4200, combo: 3, rank: 1 },
        { playerId: 'p2', name: 'Sam', score: 1500, combo: 1, rank: 2 },
      ],
      combo: 3,
      rank: ['p1', 'p2'],
    })

    render(<SessionPlay />)
    const initialHandler = capturedProps.onSongEnded

    act(() => {
      useHitStore.getState().recordHit({ playerId: 'p1', tier: 'epic', noteId: 'note-0', deviationCents: 0, t: Date.now() })
      useHitStore.getState().recordHit({ playerId: 'p2', tier: 'awful', noteId: 'note-1', deviationCents: 0, t: Date.now() })
      // Each singer's line verdicts, which the results summarise.
      useScoreStore.getState().applyHits(
        [],
        [
          { playerId: 'p1', lineIndex: 0, rating: 'great', label: 'Great!', fraction: 0.9, bonusPoints: 0, t: 1 },
          { playerId: 'p1', lineIndex: 1, rating: 'perfect', label: 'Perfect!', fraction: 1, bonusPoints: 0, t: 2 },
        ],
      )
    })

    await waitFor(() => expect(capturedProps.onSongEnded).not.toBe(initialHandler))

    act(() => {
      capturedProps.onSongEnded?.()
    })

    const state = useSessionStore.getState()
    expect(state.phase).toBe('results')
    expect(state.lastResult).toEqual([
      {
        playerId: 'p1',
        score: 4200,
        epicCount: 1,
        goodCount: 0,
        awfulCount: 0,
        bestLine: null,
        lineCounts: { perfect: 1, great: 1, good: 0, ok: 0 },
      },
      { playerId: 'p2', score: 1500, epicCount: 0, goodCount: 0, awfulCount: 1, bestLine: null, lineCounts: { perfect: 0, great: 0, good: 0, ok: 0 } },
    ])
  })

  // Restart from the pause menu: what was sung before it must not reach the results.
  it('starts the tallies over when the song is restarted from the pause menu', async () => {
    render(<SessionPlay />)

    act(() => {
      useHitStore.getState().recordHit({ playerId: 'p1', tier: 'epic', noteId: 'note-0', deviationCents: 0, t: Date.now() })
      useHitStore.getState().recordHit({ playerId: 'p1', tier: 'epic', noteId: 'note-1', deviationCents: 0, t: Date.now() })
    })
    act(() => {
      usePauseStore.getState().pause()
      usePauseStore.getState().restart()
    })
    const afterRestart = capturedProps.onSongEnded
    act(() => {
      useHitStore.getState().recordHit({ playerId: 'p1', tier: 'good', noteId: 'note-0', deviationCents: 0, t: Date.now() })
    })
    await waitFor(() => expect(capturedProps.onSongEnded).not.toBe(afterRestart))

    act(() => {
      capturedProps.onSongEnded?.()
    })

    expect(useSessionStore.getState().lastResult).toEqual([
      {
        playerId: 'p1',
        score: 0,
        epicCount: 0,
        goodCount: 1,
        awfulCount: 0,
        bestLine: null,
        lineCounts: { perfect: 0, great: 0, good: 0, ok: 0 },
      },
    ])
  })

  it('leaves nothing paused when the song screen goes', () => {
    const { unmount } = render(<SessionPlay />)
    act(() => usePauseStore.getState().pause())
    unmount()
    expect(usePauseStore.getState().phase).toBe('running')
  })

  it('pauses background library work while the song is sung, and resumes it when the scene goes', () => {
    const setGameplayActive = vi.fn()
    // @ts-expect-error -- only the members exercised here are stubbed
    window.api = { audience: { reportScoreState: vi.fn() }, library: { setGameplayActive } }

    const { unmount } = render(<SessionPlay />)
    expect(setGameplayActive).toHaveBeenLastCalledWith(true)

    unmount()
    expect(setGameplayActive).toHaveBeenLastCalledWith(false)
  })
})
