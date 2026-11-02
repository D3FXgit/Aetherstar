import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { MotionGlobalConfig } from 'framer-motion'
import { AudienceLiveLeaderboard, OVERTAKE_BANNER_MS } from '../AudienceLiveLeaderboard'
import { setLanguage, t } from '../../i18n'
import type { AudienceSinger } from '../types'
import type { PlayerScore } from '../../contracts/types'

const SINGERS: AudienceSinger[] = [
  { playerId: 'p1', name: 'Alex', micNumber: 1, avatarUrl: '' },
  { playerId: 'p2', name: 'Sam', micNumber: 2, avatarUrl: '' },
]

describe('AudienceLiveLeaderboard', () => {
  it('renders live score cards for all singers', () => {
    const players: PlayerScore[] = [
      { playerId: 'p1', name: 'Alex', score: 2500, combo: 2, rank: 1 },
      { playerId: 'p2', name: 'Sam', score: 1800, combo: 1, rank: 2 },
    ]

    render(<AudienceLiveLeaderboard singers={SINGERS} players={players} />)

    const scores = screen.getAllByTestId('audience-live-score')
    expect(scores).toHaveLength(2)
    expect(screen.getByText('2,500')).toBeInTheDocument()
    expect(screen.getByText('1,800')).toBeInTheDocument()
  })

  it('ranks singers dynamically by score with podium crowns and badges', () => {
    const players: PlayerScore[] = [
      { playerId: 'p1', name: 'Alex', score: 2500, combo: 5, rank: 1 },
      { playerId: 'p2', name: 'Sam', score: 3200, combo: 2, rank: 2 },
    ]

    render(<AudienceLiveLeaderboard singers={SINGERS} players={players} />)

    const scores = screen.getAllByTestId('audience-live-score')
    // Sam should be 1st because score is 3200 > 2500
    expect(scores[0]).toHaveAttribute('data-mic-number', '2')
    expect(scores[0]).toHaveTextContent('Sam')
    expect(scores[0]).toHaveTextContent(t('audience.live.place.first'))

    // Alex should be 2nd
    expect(scores[1]).toHaveAttribute('data-mic-number', '1')
    expect(scores[1]).toHaveTextContent('Alex')
    expect(scores[1]).toHaveTextContent(t('audience.live.place.second'))
    // Alex's diff from leader is -700
    expect(scores[1]).toHaveTextContent('-700')
  })

  it('never displays a combo, even if a legacy sender still provides one (scoring has no combo)', () => {
    const players: PlayerScore[] = [
      { playerId: 'p1', name: 'Alex', score: 2500, combo: 8, rank: 1 },
      { playerId: 'p2', name: 'Sam', score: 1200, combo: 1, rank: 2 },
    ]

    render(<AudienceLiveLeaderboard singers={SINGERS} players={players} />)

    expect(screen.queryByText(/8x/)).not.toBeInTheDocument()
    expect(screen.queryByText(/🔥/)).not.toBeInTheDocument()
  })

  it('renders nothing when singers list is empty', () => {
    const { container } = render(<AudienceLiveLeaderboard singers={[]} players={[]} />)
    expect(container.firstChild).toBeNull()
  })

  describe('overtake banner', () => {
    afterEach(() => {
      vi.useRealTimers()
      MotionGlobalConfig.skipAnimations = false
    })

    // Keyed on a fresh leader object, every score tick would re-run the effect
    // and its cleanup would cancel the dismiss timer, so the banner never left.
    it('clears after its timeout even while scores keep ticking', async () => {
      vi.useFakeTimers()
      MotionGlobalConfig.skipAnimations = true
      const scores = (alex: number, sam: number): PlayerScore[] => [
        { playerId: 'p1', name: 'Alex', score: alex, combo: 0, rank: 1 },
        { playerId: 'p2', name: 'Sam', score: sam, combo: 0, rank: 2 },
      ]

      const { rerender } = render(<AudienceLiveLeaderboard singers={SINGERS} players={scores(500, 100)} />)
      expect(screen.queryByTestId('audience-overtake-banner')).not.toBeInTheDocument()

      rerender(<AudienceLiveLeaderboard singers={SINGERS} players={scores(500, 900)} />)
      expect(screen.getByTestId('audience-overtake-banner')).toHaveTextContent(t('audience.live.newLeader', { name: 'Sam' }))

      // Score ticks with the same leader, each a brand-new players array.
      for (let tick = 1; tick <= 5; tick++) {
        act(() => vi.advanceTimersByTime(OVERTAKE_BANNER_MS / 10))
        rerender(<AudienceLiveLeaderboard singers={SINGERS} players={scores(500 + tick, 900 + tick * 10)} />)
      }

      // Past the dismiss deadline, then let AnimatePresence finish the exit.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(OVERTAKE_BANNER_MS)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(screen.queryByTestId('audience-overtake-banner')).not.toBeInTheDocument()
    })
  })

  it('tolerates a score payload with no combo field (combo is leaving the contract)', () => {
    const players = [
      { playerId: 'p1', name: 'Alex', score: 2500, rank: 1 },
      { playerId: 'p2', name: 'Sam', score: 1200, rank: 2 },
    ] as unknown as PlayerScore[]

    render(<AudienceLiveLeaderboard singers={SINGERS} players={players} />)

    expect(screen.getByText('2,500')).toBeInTheDocument()
    expect(screen.queryByText(/🔥/)).not.toBeInTheDocument()
  })

  it('draws the score bar with a transform, and no card blurs the video behind it', () => {
    const players: PlayerScore[] = [
      { playerId: 'p1', name: 'Alex', score: 2500, combo: 0, rank: 1 },
      { playerId: 'p2', name: 'Sam', score: 1250, combo: 0, rank: 2 },
    ]
    render(<AudienceLiveLeaderboard singers={SINGERS} players={players} />)

    for (const bar of screen.getAllByTestId('audience-live-score-bar')) {
      expect(bar.style.transformOrigin).toBe('left center')
      expect(bar.style.width).toBe('')
    }
    for (const card of screen.getAllByTestId('audience-live-score')) {
      expect(card.className).not.toMatch(/backdrop-blur|transition-all/)
    }
  })

  describe('in German', () => {
    afterEach(async () => {
      await setLanguage(null)
    })

    it('labels the places in German and leaves the singer names alone', async () => {
      await act(() => setLanguage('de'))
      const players: PlayerScore[] = [
        { playerId: 'p1', name: 'Alex', score: 2500, combo: 0, rank: 1 },
        { playerId: 'p2', name: 'Sam', score: 1250, combo: 0, rank: 2 },
      ]
      render(<AudienceLiveLeaderboard singers={SINGERS} players={players} />)

      const cards = screen.getAllByTestId('audience-live-score')
      expect(within(cards[0]).getByText('1.')).toBeInTheDocument()
      expect(cards[0]).toHaveTextContent('Alex')
      expect(within(cards[1]).getByText('2.')).toBeInTheDocument()
      expect(cards[1]).toHaveTextContent('Sam')
    })
  })
})
