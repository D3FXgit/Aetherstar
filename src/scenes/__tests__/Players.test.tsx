import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Players } from '../Players'
import { usePlayersStore } from '../../players/store'

beforeEach(() => {
  usePlayersStore.setState({ players: [], load: vi.fn() })
})

describe('Players scene', () => {
  it('renders the real Roster', () => {
    render(<Players />)

    expect(screen.getByRole('button', { name: 'Add player' })).toBeInTheDocument()
  })

  // This screen is opted out of the shell's fallback bar (sceneChrome.ts), so
  // the header it draws for itself is now the *only* way back off it. With an
  // empty roster it is also a screen whose only other control is "Add player",
  // which is exactly the state the user screenshotted: one floating pill in the
  // corner, one button in the middle, and nothing naming the screen.
  it('names itself and carries its own Back, even with an empty roster', () => {
    render(<Players />)

    expect(screen.getByRole('heading', { level: 1, name: 'Players' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })
})
