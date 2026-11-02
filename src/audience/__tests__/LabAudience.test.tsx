import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LabAudience } from '../LabAudience'
import { useScoreStore } from '../../contracts/mocks/stores'

describe('LabAudience', () => {
  it('adding a mock player via the control panel updates useScoreStore (the same real state-sync path a session would use)', async () => {
    useScoreStore.setState({ players: [], combo: 0, rank: [] })
    render(<LabAudience />)

    await userEvent.click(screen.getByRole('button', { name: /add mock player/i }))

    expect(useScoreStore.getState().players.length).toBe(1)
  })

  it('bumping a player score via the control panel increases that player\'s score in useScoreStore', async () => {
    useScoreStore.setState({
      players: [{ playerId: 'lab-1', name: 'Lab One', score: 0, combo: 0, rank: 1 }],
      combo: 0,
      rank: ['lab-1'],
    })
    render(<LabAudience />)

    await userEvent.click(screen.getByRole('button', { name: /\+100/i }))

    expect(useScoreStore.getState().players[0].score).toBe(100)
  })
})
