import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LabMic } from '../LabMic'
import { usePitchStore } from '../../audio/pitchStore'
import { useRawScopeStore } from '../../audio/rawScopeStore'
import { useSceneStore } from '../../scenes/sceneStore'

const MIC_1 = { id: 'mic-1', name: 'USB Mic', channelCount: 1, sampleRate: 48000 }

describe('LabMic', () => {
  beforeEach(() => {
    usePitchStore.setState({
      devices: [MIC_1],
      activeCaptures: {},
      permissionStatus: 'granted',
      requestPermission: vi.fn().mockResolvedValue(undefined),
      refreshDevices: vi.fn().mockResolvedValue(undefined),
      startCapture: vi.fn(),
      stopCapture: vi.fn(),
      subscribeToEvents: vi.fn().mockReturnValue(() => {}),
    })
    useRawScopeStore.setState({
      activeDeviceId: null,
      latestChunk: null,
      startScope: vi.fn().mockResolvedValue(undefined),
      stopScope: vi.fn().mockResolvedValue(undefined),
      subscribeToChunks: vi.fn().mockReturnValue(() => {}),
    })
    useSceneStore.setState({ current: 'lab-mic' })
  })

  it('renders the device picker and raw buffer scope standalone', () => {
    render(<LabMic />)
    expect(screen.getByTestId('device-picker')).toBeInTheDocument()
    expect(screen.getByTestId('raw-buffer-scope')).toBeInTheDocument()
  })

  it('the scope toggle is disabled until a device is actively capturing', () => {
    render(<LabMic />)
    expect(screen.getByText('Start scope')).toBeDisabled()
  })

  it('clicking Start scope calls startScope once a device is capturing', () => {
    usePitchStore.setState({ activeCaptures: { 'mic-1': { latest: null, samples: [], latencyMs: null } } })
    render(<LabMic />)
    fireEvent.click(screen.getByText('Start scope'))
    expect(useRawScopeStore.getState().startScope).toHaveBeenCalledWith('mic-1')
  })

  it('navigating back to lab works via useSceneStore', () => {
    render(<LabMic />)
    fireEvent.click(screen.getByText('← Back to Dev Lab'))
    expect(useSceneStore.getState().current).toBe('lab')
  })
})
