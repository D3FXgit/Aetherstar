import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { LabSession } from '../LabSession'
import { useSessionStore } from '../../session/sessionStore'
import { useSceneStore } from '../../scenes/sceneStore'

describe('LabSession', () => {
  beforeEach(() => {
    useSessionStore.setState({
      phase: 'idle',
      sessionId: null,
      selectedSong: null,
      assignedPlayerIds: [],
      lastResult: null,
      songsPlayedThisSession: 0,
    })
    useSceneStore.setState({ current: 'lab-session' })
  })

  it('drives the full state machine through mock songs, players and scores, standalone', () => {
    render(<LabSession />)
    expect(screen.getByTestId('lab-session-phase')).toHaveTextContent('idle')

    fireEvent.click(screen.getByText(/mock: enter select/i))
    expect(screen.getByTestId('lab-session-phase')).toHaveTextContent('select')

    fireEvent.click(screen.getByText(/mock: pick song/i))
    expect(screen.getByTestId('lab-session-phase')).toHaveTextContent('assign')
    expect(useSessionStore.getState().selectedSong).not.toBeNull()

    fireEvent.click(screen.getByText(/mock: assign player/i))
    expect(screen.getByTestId('lab-session-phase')).toHaveTextContent('play')
    expect(useSessionStore.getState().assignedPlayerIds).toHaveLength(1)

    fireEvent.click(screen.getByText(/mock: finish song/i))
    expect(screen.getByTestId('lab-session-phase')).toHaveTextContent('results')
    expect(screen.getByTestId('lab-session-result')).toHaveTextContent('4200')

    fireEvent.click(screen.getByText(/mock: view leaderboard/i))
    expect(screen.getByTestId('lab-session-phase')).toHaveTextContent('leaderboard')

    // None of this ever left the lab scene -- no real mic/gameplay engine involved.
    expect(useSceneStore.getState().current).toBe('lab-session')
  })

  it('navigating back to the Dev Lab index works via useSceneStore', () => {
    render(<LabSession />)
    fireEvent.click(screen.getByText(/back to dev lab/i))
    expect(useSceneStore.getState().current).toBe('lab')
  })
})
