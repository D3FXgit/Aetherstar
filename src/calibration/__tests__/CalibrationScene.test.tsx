import { render, screen } from '@testing-library/react'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { CalibrationScene } from '../CalibrationScene'
import { usePitchStore } from '../../audio/pitchStore'
import { usePlayersStore } from '../../players/store'
import { useCalibrationStore } from '../calibrationStore'

/**
 * jsdom has no Web Audio. The scene builds a real `AudioContext` and a click
 * buffer on mount (they are handed to the wizard), so a minimal stand-in is
 * needed before it can be rendered at all.
 */
class StubAudioContext {
  sampleRate = 48000
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length)
    return { getChannelData: () => data }
  }
}

describe('CalibrationScene', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', StubAudioContext)
    useCalibrationStore.setState({ target: null })
    usePlayersStore.setState({ players: [], load: vi.fn() })
    usePitchStore.setState({
      devices: [],
      activeCaptures: {},
      permissionStatus: 'granted',
      requestPermission: vi.fn().mockResolvedValue(undefined),
      refreshDevices: vi.fn().mockResolvedValue(undefined),
      startCapture: vi.fn(),
      stopCapture: vi.fn(),
      subscribeToEvents: vi.fn().mockReturnValue(() => {}),
    })
  })

  // With no microphone and no player there is nothing on this screen to press
  // *except* the way out, so the way out has to be part of the screen.
  it('carries Back in its own header on the setup branch, which has no other control', () => {
    render(<CalibrationScene />)

    expect(screen.getByTestId('calibration-scene-setup')).toBeInTheDocument()
    const row = screen.getByTestId('scene-title-bar')
    expect(row).toContainElement(screen.getByRole('button', { name: 'Back' }))
    expect(row).toContainElement(screen.getByRole('heading', { level: 1, name: 'Calibration' }))
  })

  it('names the screen exactly once', () => {
    render(<CalibrationScene />)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})
