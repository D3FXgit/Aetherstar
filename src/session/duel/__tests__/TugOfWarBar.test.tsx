import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { TugOfWarBar } from '../TugOfWarBar'
import { useScoreStore } from '../../../game/state/useScoreStore'
import { usePlayersStore } from '../../../players/store'

describe('TugOfWarBar', () => {
  beforeEach(() => {
    usePlayersStore.setState({
      players: [
        { id: 'p1', name: 'Alice', color: '#ff3b30', avatarUrl: '', songsSung: 0, bestScore: 0 },
        { id: 'p2', name: 'Bob', color: '#38bdf8', avatarUrl: '', songsSung: 0, bestScore: 0 },
      ],
    })
    useScoreStore.setState({
      players: [
        { playerId: 'p1', name: 'Alice', score: 2500, combo: 5, rank: 1 },
        { playerId: 'p2', name: 'Bob', score: 2000, combo: 2, rank: 2 },
      ],
      combo: 5,
      rank: ['p1', 'p2'],
    })
  })

  it('renders both player names and scores', () => {
    render(<TugOfWarBar player1Id="p1" player2Id="p2" />)

    expect(screen.getByTestId('tug-of-war-bar')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('2,500')).toBeInTheDocument()
    expect(screen.getByText('2,000')).toBeInTheDocument()
  })

  it('renders leader and lead differential pill', () => {
    render(<TugOfWarBar player1Id="p1" player2Id="p2" />)

    expect(screen.getByText('Alice +500 pts')).toBeInTheDocument()
  })

  it('says tied when scores are identical', () => {
    useScoreStore.setState({
      players: [
        { playerId: 'p1', name: 'Alice', score: 3000, combo: 0, rank: 1 },
        { playerId: 'p2', name: 'Bob', score: 3000, combo: 0, rank: 1 },
      ],
      combo: 0,
      rank: ['p1', 'p2'],
    })

    render(<TugOfWarBar player1Id="p1" player2Id="p2" />)

    expect(screen.getByText('Tied')).toBeInTheDocument()
  })
})
