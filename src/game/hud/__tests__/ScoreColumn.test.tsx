import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { micLabel } from '../../../multiplayer/slots'
import { ScoreColumn } from '../ScoreColumn'
import { usePlayersStore } from '../../../players/store'
import { useHitStore } from '../../state/useHitStore'
import { useScoreStore } from '../../state/useScoreStore'
import { micRimColor } from '../../../design/tokens'

/**
 * The live score cards, stacked down the right edge of the singer view.
 *
 * Everything on them is real state pulled from the shared stores -- the score
 * and line verdicts from useScoreStore, the name and avatar from the roster --
 * so the column is only responsible for pairing each
 * singer with the microphone the caller says they are on, and for keeping the
 * caller's order.
 */
describe('ScoreColumn', () => {
  beforeEach(() => {
    usePlayersStore.setState({
      players: [
        { id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' },
        { id: 'p2', name: 'Sam', color: 'gold', avatarUrl: '' },
      ],
    })
    useHitStore.getState().reset()
    useScoreStore.getState().reset({
      players: [
        { playerId: 'p1', name: 'Alex', score: 148320, combo: 24, rank: 1 },
        { playerId: 'p2', name: 'Sam', score: 74160, combo: 3, rank: 2 },
      ],
      combo: 24,
      rank: ['p1', 'p2'],
    })
  })

  it('renders one card per singer, in the given order, from the shared score store', () => {
    render(
      <ScoreColumn
        entries={[
          { playerId: 'p1', micNumber: 1 },
          { playerId: 'p2', micNumber: 2 },
        ]}
      />,
    )

    const cards = screen.getAllByTestId('gameplay-hud')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByTestId('hud-score')).toHaveTextContent('148,320')
    expect(within(cards[1]).getByTestId('hud-score')).toHaveTextContent('74,160')
  })

  /**
   * The caller stacks these to match the order of the lanes, so a card is
   * always level-ish with the lane it counts. The column must not re-sort them
   * by score, roster or anything else.
   */
  it('keeps the caller\'s order rather than re-sorting by score or roster', () => {
    render(
      <ScoreColumn
        entries={[
          { playerId: 'p2', micNumber: 2 },
          { playerId: 'p1', micNumber: 1 },
        ]}
      />,
    )

    const cards = screen.getAllByTestId('gameplay-hud')
    expect(cards.map((node) => node.dataset.slotNumber)).toEqual(['2', '1'])
  })

  /**
   * Identity follows the *microphone*, and the mic number is what identifies a
   * singer -- the colour only reinforces it (HIG: never convey information with
   * colour alone). The number here has to be the mic the caller's lane is
   * actually reading from, spelled the same way every other screen spells it.
   */
  it('names each singer\'s microphone on their card, in the same words as their lane', () => {
    render(<ScoreColumn entries={[{ playerId: 'p2', micNumber: 5 }]} />)

    expect(screen.getByTestId('hud-slot-badge')).toHaveTextContent(micLabel(5))
    expect(screen.getByTestId('gameplay-hud').dataset.slotNumber).toBe('5')
  })

  it('rims each card in its mic\'s colour, so it matches that singer\'s lane', () => {
    render(<ScoreColumn entries={[{ playerId: 'p1', micNumber: 2 }]} />)
    expect(screen.getByTestId('hud-rim').style.background).toContain(micRimColor(1).slice(0, 12))
  })

  it('shows no combo -- scoring has none', () => {
    render(<ScoreColumn entries={[{ playerId: 'p1', micNumber: 1 }]} />)
    expect(screen.queryByTestId('hud-combo')).not.toBeInTheDocument()
  })

  it('names each singer from the roster, so a card is not just a number', () => {
    render(<ScoreColumn entries={[{ playerId: 'p1', micNumber: 1 }]} />)
    expect(screen.getByTestId('player-badge')).toBeInTheDocument()
  })

  it('skips a player id the score store has no entry for', () => {
    render(
      <ScoreColumn
        entries={[
          { playerId: 'p1', micNumber: 1 },
          { playerId: 'ghost', micNumber: 2 },
        ]}
      />,
    )
    expect(screen.getAllByTestId('gameplay-hud')).toHaveLength(1)
  })

  /**
   * A finished line belongs to exactly one singer. Popping its verdict on
   * every card would tell seven other people they had just sung something
   * they did not sing.
   */
  it('pops the line verdict only on the card of the singer whose line ended', () => {
    useScoreStore.getState().applyHits(
      [],
      [{ playerId: 'p2', lineIndex: 0, rating: 'perfect', label: 'Perfect!', fraction: 1, bonusPoints: 0, t: 1 }],
    )

    render(
      <ScoreColumn
        entries={[
          { playerId: 'p1', micNumber: 1 },
          { playerId: 'p2', micNumber: 2 },
        ]}
      />,
    )

    const cards = screen.getAllByTestId('gameplay-hud')
    expect(within(cards[0]).queryByTestId('line-rating-pop')).not.toBeInTheDocument()
    expect(within(cards[1]).getByTestId('line-rating-pop')).toHaveTextContent('Perfect!')
  })

  /**
   * A card that only appears once its singer is in the roster would leave the
   * Dev Lab and a mid-session roster edit showing a lane with no score at all.
   */
  it('still renders a card for a scored singer the roster has never heard of', () => {
    usePlayersStore.setState({ players: [] })
    render(<ScoreColumn entries={[{ playerId: 'p1', micNumber: 1 }]} />)

    expect(screen.getByTestId('hud-score')).toHaveTextContent('148,320')
  })
})
