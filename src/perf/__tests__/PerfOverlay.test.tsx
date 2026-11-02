import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PerfOverlay } from '../PerfOverlay'
import * as perfSamplerModule from '../usePerfSampler'

function mockSample(overrides: Partial<ReturnType<typeof perfSamplerModule.usePerfSampler>> = {}) {
  vi.spyOn(perfSamplerModule, 'usePerfSampler').mockReturnValue({
    fps: 60,
    frameTimeMs: 16.6,
    cpuPercent: 12,
    micLatencyMs: 18,
    heapUsedMb: 50,
    ...overrides,
  })
}

describe('PerfOverlay', () => {
  it('renders fps, frame-time, CPU%, and mic-latency readouts', () => {
    mockSample()
    render(<PerfOverlay />)

    expect(screen.getByTestId('perf-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('perf-fps')).toHaveTextContent('60')
    expect(screen.getByTestId('perf-frame-time')).toHaveTextContent('16.6')
    expect(screen.getByTestId('perf-cpu')).toHaveTextContent('12')
    expect(screen.getByTestId('perf-mic-latency')).toHaveTextContent('18')
  })

  it('shows a placeholder for mic latency when no capture is active', () => {
    mockSample({ micLatencyMs: null, cpuPercent: null })
    render(<PerfOverlay />)

    expect(screen.getByTestId('perf-mic-latency')).toHaveTextContent('--')
    expect(screen.getByTestId('perf-cpu')).toHaveTextContent('--')
  })

  it('renders a heap sparkline element when heap samples exist, and omits it when unavailable', () => {
    mockSample({ heapUsedMb: 50 })
    const { rerender } = render(<PerfOverlay />)
    expect(screen.getByTestId('perf-heap-sparkline')).toBeInTheDocument()

    mockSample({ heapUsedMb: null })
    rerender(<PerfOverlay />)
    expect(screen.queryByTestId('perf-heap-sparkline')).not.toBeInTheDocument()
  })
})
