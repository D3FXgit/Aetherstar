import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MicCheck } from '../MicCheck'
import { usePitchStore } from '../pitchStore'

const MIC_1 = { id: 'mic-1', name: 'USB Mic', channelCount: 1, sampleRate: 48000 }
const MIC_2 = { id: 'mic-2', name: 'Interface In 1', channelCount: 1, sampleRate: 48000 }

describe('MicCheck', () => {
  beforeEach(() => {
    usePitchStore.setState({
      devices: [MIC_1, MIC_2],
      activeCaptures: {},
      permissionStatus: 'granted',
      requestPermission: vi.fn().mockResolvedValue(undefined),
      refreshDevices: vi.fn().mockResolvedValue(undefined),
      startCapture: vi.fn(),
      stopCapture: vi.fn(),
      subscribeToEvents: vi.fn().mockReturnValue(() => {}),
    })
  })

  it('renders the device picker', () => {
    render(<MicCheck />)
    expect(screen.getByTestId('device-picker')).toBeInTheDocument()
  })

  it('renders one independent tuner per active capture', () => {
    usePitchStore.setState({
      activeCaptures: {
        'mic-1': { latest: null, samples: [], latencyMs: null },
        'mic-2': { latest: null, samples: [], latencyMs: null },
      },
    })
    render(<MicCheck />)
    expect(screen.getAllByTestId('mic-check-tuner')).toHaveLength(2)
  })

  it('renders no tuners section when nothing is capturing', () => {
    render(<MicCheck />)
    expect(screen.queryByTestId('mic-check-tuners')).not.toBeInTheDocument()
  })

  it('renders PermissionErrorState instead of the picker when permission is denied', () => {
    usePitchStore.setState({ permissionStatus: 'denied' })
    render(<MicCheck />)
    expect(screen.queryByTestId('device-picker')).not.toBeInTheDocument()
    expect(screen.getByTestId('permission-error-state')).toBeInTheDocument()
  })

  // Self-headed scene (src/scenes/sceneChrome.ts): its own header row is the
  // only way off it.
  it('leads its own header row with Back, before the "Mic check" title', () => {
    render(<MicCheck />)

    const row = screen.getByTestId('scene-title-bar')
    expect(row).toContainElement(screen.getByRole('button', { name: 'Back' }))
    expect(row).toContainElement(screen.getByRole('heading', { level: 1, name: 'Mic check' }))
  })

  // The branch with nothing else on it: if the header is not part of this
  // branch too, a user who denied microphone access is stuck.
  it('still carries Back on the permission-denied branch, which has no other control', () => {
    usePitchStore.setState({ permissionStatus: 'denied' })
    render(<MicCheck />)

    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })
})
