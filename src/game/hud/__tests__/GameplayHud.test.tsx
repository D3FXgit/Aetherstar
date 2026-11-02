import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { GameplayHud } from '../GameplayHud'
import { LINE_RATING_POP_MS } from '../lineRatingStyle'
import { micLabel } from '../../../multiplayer/slots'
import type { PlayerProfile, PlayerScore } from '../../../contracts/types'
import type { LineRatingEvent } from '../../types'

const PLAYER_SCORE: PlayerScore = { playerId: 'p1', name: 'Alex', score: 1230, combo: 4, rank: 1 }
const PLAYER_PROFILE: PlayerProfile = { id: 'p1', name: 'Alex', avatarUrl: '', color: 'coral' }

function rating(overrides: Partial<LineRatingEvent> = {}): LineRatingEvent {
  return { playerId: 'p1', lineIndex: 0, rating: 'great', label: 'Great!', fraction: 0.85, bonusPoints: 10, t: 1, ...overrides }
}

describe('GameplayHud', () => {
  it('renders the score and the real PlayerBadge, and no combo', () => {
    render(<GameplayHud playerScore={PLAYER_SCORE} playerProfile={PLAYER_PROFILE} />)

    expect(screen.getByTestId('hud-score')).toHaveTextContent('1,230')
    expect(screen.getByTestId('player-badge')).toBeInTheDocument()
    expect(screen.queryByTestId('hud-combo')).not.toBeInTheDocument()
  })

  it('pops the line verdict when a line ends, then clears it', () => {
    vi.useFakeTimers()
    try {
      render(<GameplayHud playerScore={PLAYER_SCORE} playerProfile={PLAYER_PROFILE} lineRating={rating()} />)
      expect(screen.getByTestId('line-rating-pop')).toHaveTextContent('Great!')
      expect(screen.getByTestId('line-rating-pop').dataset.rating).toBe('great')

      act(() => {
        vi.advanceTimersByTime(LINE_RATING_POP_MS + 10)
      })
      expect(screen.queryByTestId('line-rating-pop')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says nothing for a poor line', () => {
    render(
      <GameplayHud playerScore={PLAYER_SCORE} playerProfile={PLAYER_PROFILE} lineRating={rating({ rating: 'poor', label: null })} />,
    )
    expect(screen.queryByTestId('line-rating-pop')).not.toBeInTheDocument()
  })

  it('names the microphone in the same words as every other screen, never "P3"', () => {
    render(<GameplayHud playerScore={PLAYER_SCORE} playerProfile={PLAYER_PROFILE} slotNumber={3} />)

    const badge = screen.getByTestId('hud-slot-badge')
    expect(badge).toHaveTextContent(micLabel(3))
    expect(badge.textContent).not.toMatch(/^P\d/)
  })

  it('carries the mic\'s rim colour as reinforcement for the number', () => {
    render(<GameplayHud playerScore={PLAYER_SCORE} playerProfile={PLAYER_PROFILE} slotNumber={2} accentColor="rgb(0, 200, 120)" />)

    expect(screen.getByTestId('hud-rim').style.background).toContain('rgb(0, 200, 120)')
    expect(screen.getByTestId('gameplay-hud').dataset.slotNumber).toBe('2')
  })

  it('falls back to the score\'s name when the roster has no profile', () => {
    render(<GameplayHud playerScore={PLAYER_SCORE} />)
    expect(screen.getByTestId('player-badge')).toBeInTheDocument()
  })

  it('prints the score as a whole, grouped number', () => {
    render(<GameplayHud playerScore={{ ...PLAYER_SCORE, score: 8820.000000000002 }} playerProfile={PLAYER_PROFILE} />)

    expect(screen.getByTestId('hud-score')).toHaveTextContent('8,820')
    expect(screen.getByTestId('hud-score').textContent).not.toContain('.')
  })

  /**
   * Up to eight of these sit over playing video for the length of a song, and
   * a backdrop blur there re-filters the video every frame (it roughly halved
   * the frame rate). The card uses a solid translucent fill instead.
   */
  it('uses no backdrop filter at all, only a dark translucent fill', () => {
    render(<GameplayHud playerScore={PLAYER_SCORE} playerProfile={PLAYER_PROFILE} />)

    const card = screen.getByTestId('gameplay-hud')
    expect(card.className).not.toMatch(/backdrop-/)
    expect(card.className).toMatch(/bg-black\//)
  })
})
