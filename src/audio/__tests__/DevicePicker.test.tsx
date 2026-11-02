import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DevicePicker } from '../DevicePicker'
import { usePitchStore } from '../pitchStore'

const MIC_1 = { id: 'mic-1', name: 'USB Mic', channelCount: 1, sampleRate: 48000 }

describe('DevicePicker', () => {
  beforeEach(() => {
    usePitchStore.setState({
      devices: [MIC_1],
      activeCaptures: {},
      permissionStatus: 'granted',
      startCapture: vi.fn(),
      stopCapture: vi.fn(),
      refreshDevices: vi.fn(),
    })
  })

  it('shows the error state when no devices are found', () => {
    usePitchStore.setState({ devices: [] })
    render(<DevicePicker />)
    expect(screen.getByTestId('glass-error-state')).toBeInTheDocument()
    expect(screen.getByText('No mics found')).toBeInTheDocument()
  })

  it('clicking Rescan on the empty state calls refreshDevices', () => {
    usePitchStore.setState({ devices: [] })
    render(<DevicePicker />)
    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }))
    expect(usePitchStore.getState().refreshDevices).toHaveBeenCalledOnce()
  })

  it('renders each device with a Start control', () => {
    render(<DevicePicker />)
    expect(screen.getByText('USB Mic')).toBeInTheDocument()
    expect(screen.getByText('Start')).toBeInTheDocument()
  })

  it('clicking Start calls startCapture with the device id', () => {
    render(<DevicePicker />)
    fireEvent.click(screen.getByText('Start'))
    expect(usePitchStore.getState().startCapture).toHaveBeenCalledWith('mic-1')
  })

  it('an active device shows Stop, and clicking it calls stopCapture', () => {
    usePitchStore.setState({ activeCaptures: { 'mic-1': { latest: null, samples: [], latencyMs: null } } })
    render(<DevicePicker />)
    fireEvent.click(screen.getByText('Stop'))
    expect(usePitchStore.getState().stopCapture).toHaveBeenCalledWith('mic-1')
  })
})
