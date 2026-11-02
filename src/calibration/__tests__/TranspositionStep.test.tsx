import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranspositionStep } from '../TranspositionStep'
import { usePitchStore } from '../../audio/pitchStore'

afterEach(() => {
  usePitchStore.setState({ activeCaptures: {} })
})

function setLatestHz(deviceId: string, hz: number) {
  act(() => {
    usePitchStore.setState((state) => ({
      activeCaptures: {
        ...state.activeCaptures,
        [deviceId]: { latest: { t: 0, hz, confidence: 1, deviceId }, samples: [], latencyMs: null },
      },
    }))
  })
}

describe('TranspositionStep', () => {
  it('computes and displays a suggested semitone shift once low and high are captured, and reports it via onChange', async () => {
    const onChange = vi.fn()
    const fixturePitches = [60, 66, 72] // center semitone 66

    render(
      <TranspositionStep deviceId="mic-1" fixtureNotePitches={fixturePitches} value={0} onChange={onChange} />,
    )

    // Player's low/high both one octave below the fixture's own range -- suggests +12.
    setLatestHz('mic-1', 440 * Math.pow(2, (48 - 69) / 12))
    await userEvent.click(screen.getByRole('button', { name: /capture low/i }))

    setLatestHz('mic-1', 440 * Math.pow(2, (60 - 69) / 12))
    await userEvent.click(screen.getByRole('button', { name: /capture high/i }))

    expect(screen.getByTestId('transposition-suggestion')).toHaveTextContent('12')
    expect(onChange).toHaveBeenLastCalledWith(12)
  })

  it('lets the player manually adjust the value via onChange', () => {
    const onChange = vi.fn()
    render(<TranspositionStep deviceId="mic-1" fixtureNotePitches={[60, 72]} value={3} onChange={onChange} />)

    const input = screen.getByRole('spinbutton', { name: /shift/i })
    fireEvent.change(input, { target: { value: '5' } })

    expect(onChange).toHaveBeenLastCalledWith(5)
  })
})
