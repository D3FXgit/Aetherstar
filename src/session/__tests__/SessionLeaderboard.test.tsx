import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionLeaderboard } from '../SessionLeaderboard'
import { useSceneStore } from '../../scenes/sceneStore'
import { useSessionStore } from '../sessionStore'
import { BackAuthorityProvider } from '../../scenes/SceneHeader'
import type { LeaderboardEntry } from '../types'

const ENTRY: LeaderboardEntry = {
  sessionId: 's1',
  songPath: '/library/nova',
  songTitle: 'Paper Satellites',
  songArtist: 'Nova Lane',
  playerId: 'p1',
  score: 4200,
  epicCount: 5,
  goodCount: 2,
  awfulCount: 1,
  playedAt: 1,
}

describe('SessionLeaderboard', () => {
  beforeEach(() => {
    useSceneStore.setState({ current: 'session-leaderboard' })
    window.api = {
      session: {
        start: vi.fn(),
        recordEntry: vi.fn(),
        listLeaderboard: vi.fn().mockResolvedValue([ENTRY]),
      },
    } as unknown as Window['api']
  })

  it('renders one row per leaderboard entry with song/score', async () => {
    render(<SessionLeaderboard />)
    await waitFor(() => expect(screen.getByText(/Paper Satellites/)).toBeInTheDocument())
    expect(screen.getByText('4,200')).toBeInTheDocument()
  })

  it('shows an empty state when nothing has been played yet', async () => {
    window.api!.session.listLeaderboard = vi.fn().mockResolvedValue([])
    render(<SessionLeaderboard />)
    await waitFor(() => expect(screen.getByText(/no songs played/i)).toBeInTheDocument())
  })

  // The standalone library browser was a dead end (nothing could be sung from
  // it), so the way onward from here is back into song selection.
  it('sends "Pick a song" back into song selection, not to a library browser', async () => {
    window.api!.session.listLeaderboard = vi.fn().mockResolvedValue([])
    useSessionStore.setState({ phase: 'leaderboard', mode: 'classic' })
    render(<SessionLeaderboard />)

    fireEvent.click(await screen.findByRole('button', { name: 'Pick a song' }))

    expect(useSessionStore.getState().phase).toBe('select')
    expect(useSceneStore.getState().current).toBe('session-select')
    expect(screen.queryByRole('button', { name: /browse the library/i })).not.toBeInTheDocument()
  })

  it('draws no backdrop blur on the rows of a long list', async () => {
    render(<SessionLeaderboard />)
    const rows = await screen.findAllByTestId('leaderboard-row')
    for (const row of rows) expect(row.className).not.toMatch(/backdrop-blur/)
  })

  // The per-screen half of the coverage proof: sceneChrome lists
  // 'session-leaderboard' as drawing its own Back, so the shell no longer puts
  // a bar over it and this button is the only way out.
  it('draws the shell Back control in its own header row', async () => {
    const onBack = vi.fn()
    render(
      <BackAuthorityProvider onBack={onBack}>
        <SessionLeaderboard />
      </BackAuthorityProvider>,
    )
    await waitFor(() => expect(screen.getByText(/Paper Satellites/)).toBeInTheDocument())

    const back = screen.getByRole('button', { name: 'Back' })
    // Leading, and on the title's own row rather than floating above the panel.
    expect(back.closest('header')).toHaveTextContent('Leaderboard')

    fireEvent.click(back)

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
