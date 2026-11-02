import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LabIndex } from '../LabIndex'
import { useHitStore, usePitchStore, useScoreStore } from '../../contracts/mocks/stores'
import { useSceneStore } from '../../scenes/sceneStore'

describe('LabIndex', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    usePitchStore.getState().stop()
    useHitStore.getState().stop()
    useScoreStore.getState().stop()
    vi.useRealTimers()
  })

  it('renders the Dev Lab heading', () => {
    render(<LabIndex />)
    expect(screen.getByText('Dev Lab')).toBeInTheDocument()
  })

  it('starts the mock streams on mount and shows their live output', () => {
    render(<LabIndex />)

    // Pitch/hit have no data until their first tick; score shows its seed immediately.
    expect(screen.getByTestId('lab-pitch-value')).toHaveTextContent('waiting for data')
    expect(screen.getByTestId('lab-hit-value')).toHaveTextContent('waiting for data')
    expect(screen.getByTestId('lab-score-value')).toHaveTextContent('Lab Player: 0')

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(screen.getByTestId('lab-pitch-value')).toHaveTextContent(/Hz/)
    expect(screen.getByTestId('lab-hit-value')).toHaveTextContent(/epic|good|awful/)
    expect(screen.getByTestId('lab-score-value')).not.toHaveTextContent('waiting for data')
  })

  it('navigates to the Stage lab when its entry is clicked', async () => {
    // userEvent's internal delays rely on real timers; this test's fake
    // timers (from beforeEach) are only needed for the mock-stream test above.
    vi.useRealTimers()
    render(<LabIndex />)

    await userEvent.click(screen.getByRole('button', { name: /stage/i }))

    expect(useSceneStore.getState().current).toBe('lab-stage')
  })

  it('navigates to the FX lab when its entry is clicked', async () => {
    vi.useRealTimers()
    render(<LabIndex />)

    await userEvent.click(screen.getByRole('button', { name: /fx/i }))

    expect(useSceneStore.getState().current).toBe('lab-fx')
  })

  it('navigates to the Multiplayer lab when its entry is clicked', async () => {
    vi.useRealTimers()
    render(<LabIndex />)

    await userEvent.click(screen.getByRole('button', { name: /multiplayer/i }))

    expect(useSceneStore.getState().current).toBe('lab-multiplayer')
  })

  it('navigates to the Calibration lab when its entry is clicked', async () => {
    vi.useRealTimers()
    render(<LabIndex />)

    await userEvent.click(screen.getByRole('button', { name: /calibration/i }))

    expect(useSceneStore.getState().current).toBe('lab-calibration')
  })
})
