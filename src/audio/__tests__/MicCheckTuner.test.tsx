import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MicCheckTuner } from '../MicCheckTuner'
import { getCaptureStream, usePitchStore, type CaptureStream } from '../pitchStore'

vi.mock('../pitchStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pitchStore')>()
  return { ...actual, getCaptureStream: vi.fn(() => undefined) }
})

const MIC_1 = { id: 'mic-1', name: 'USB Mic', channelCount: 1, sampleRate: 48000 }

describe('MicCheckTuner', () => {
  beforeEach(() => {
    vi.mocked(getCaptureStream).mockReset().mockReturnValue(undefined)
    usePitchStore.setState({ devices: [MIC_1], activeCaptures: {}, permissionStatus: 'granted' })
  })

  it('renders the device name and a placeholder note name before any sample arrives', () => {
    render(<MicCheckTuner device={MIC_1} />)
    expect(screen.getByText('USB Mic')).toBeInTheDocument()
    expect(screen.getByTestId('tuner-note-name').textContent).toBe('--')
    expect(screen.getByTestId('tuner-latency').textContent).toBe('-- ms')
  })

  it('renders needle/VU-meter/pitch-trace elements', () => {
    render(<MicCheckTuner device={MIC_1} />)
    expect(screen.getByTestId('tuner-needle')).toBeInTheDocument()
    expect(screen.getByTestId('tuner-vu-meter')).toBeInTheDocument()
    expect(screen.getByTestId('tuner-pitch-trace')).toBeInTheDocument()
  })

  it('updates note-name and latency text from a new sample via the store subscription', () => {
    render(<MicCheckTuner device={MIC_1} />)
    act(() => {
      usePitchStore.setState({
        activeCaptures: {
          'mic-1': { latest: { t: 1000, hz: 440, confidence: 0.9, deviceId: 'mic-1' }, samples: [], latencyMs: 5 },
        },
      })
    })
    expect(screen.getByTestId('tuner-note-name').textContent).toBe('A4')
    expect(screen.getByTestId('tuner-latency').textContent).toBe('5 ms')
  })

  it('a sample updates the pitch-trace polyline points attribute', () => {
    render(<MicCheckTuner device={MIC_1} />)
    const polyline = document.querySelector('[data-testid="tuner-pitch-trace"] polyline')
    expect(polyline?.getAttribute('points')).toBe('')

    act(() => {
      usePitchStore.setState({
        activeCaptures: {
          'mic-1': { latest: { t: 1000, hz: 440, confidence: 0.9, deviceId: 'mic-1' }, samples: [], latencyMs: 5 },
        },
      })
    })
    expect(polyline?.getAttribute('points')).not.toBe('')
  })

  it('ignores updates for a different device id', () => {
    render(<MicCheckTuner device={MIC_1} />)
    act(() => {
      usePitchStore.setState({
        activeCaptures: {
          'mic-2': { latest: { t: 1000, hz: 440, confidence: 0.9, deviceId: 'mic-2' }, samples: [], latencyMs: 5 },
        },
      })
    })
    expect(screen.getByTestId('tuner-note-name').textContent).toBe('--')
  })

  // `latest` is never cleared by silence: reading it directly froze the tuner
  // on the last note sung. The live stream's age decides instead.
  it('lets go of the last note once the live pitch goes stale', () => {
    const sample = { t: 1000, hz: 440, confidence: 0.9, deviceId: 'mic-1' }
    const stream = { latest: sample, latestAt: Date.now() } as CaptureStream
    vi.mocked(getCaptureStream).mockImplementation((key) => (key === 'mic-1' ? stream : undefined))
    render(<MicCheckTuner device={MIC_1} />)

    act(() => {
      usePitchStore.setState({ activeCaptures: { 'mic-1': { latest: sample, samples: [], latencyMs: 5 } } })
    })
    expect(screen.getByTestId('tuner-note-name').textContent).toBe('A4')

    // Silence: batches keep arriving (level-only), `latest` still holds the old note.
    stream.latestAt = Date.now() - 1000
    act(() => {
      usePitchStore.setState({ activeCaptures: { 'mic-1': { latest: sample, samples: [], latencyMs: 6 } } })
    })
    expect(screen.getByTestId('tuner-note-name').textContent).toBe('--')
    expect(screen.getByTestId('tuner-latency').textContent).toBe('6 ms')
  })
})
