import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { TapToIdentifyButton } from '../TapToIdentifyButton'
import { usePitchStore } from '../../audio/pitchStore'
import type { DeviceCaptureState } from '../../audio/types'

vi.mock('../../audio/pitchStore', () => ({
  // No live streams here: useTapToIdentify falls back to the hand-seeded summaries.
  getCaptureStream: () => undefined,
  freshLatestPitch: () => null,
  usePitchStore: {
    getState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

type Listener = (state: { activeCaptures: Record<string, DeviceCaptureState> }) => void

describe('TapToIdentifyButton', () => {
  let listeners: Listener[]
  let activeCaptures: Record<string, DeviceCaptureState>
  let startCapture: ReturnType<typeof vi.fn>
  let stopCapture: ReturnType<typeof vi.fn>
  let onIdentified: ReturnType<typeof vi.fn<(deviceId: string) => void>>

  beforeEach(() => {
    listeners = []
    activeCaptures = {}
    startCapture = vi.fn()
    stopCapture = vi.fn()
    onIdentified = vi.fn<(deviceId: string) => void>()

    vi.mocked(usePitchStore.getState).mockImplementation(
      () => ({ activeCaptures, startCapture, stopCapture }) as unknown as ReturnType<typeof usePitchStore.getState>,
    )
    vi.mocked(usePitchStore.subscribe).mockImplementation(((listener: Listener) => {
      listeners.push(listener)
      return () => {
        listeners = listeners.filter((l) => l !== listener)
      }
    }) as typeof usePitchStore.subscribe)
  })

  function emitConfidence(deviceId: string, confidence: number) {
    activeCaptures[deviceId] = { latest: { t: Date.now(), hz: 200, confidence, deviceId }, samples: [], latencyMs: 0 }
    listeners.forEach((listener) => listener({ activeCaptures }))
  }

  it('renders an idle "Tap to identify" button', () => {
    render(<TapToIdentifyButton candidateDeviceIds={['dev-1', 'dev-2']} onIdentified={onIdentified} />)

    expect(screen.getByRole('button', { name: /tap to identify/i })).toBeInTheDocument()
  })

  it('clicking starts capture on every candidate and shows a Listening state with Cancel', () => {
    render(<TapToIdentifyButton candidateDeviceIds={['dev-1', 'dev-2']} onIdentified={onIdentified} />)

    fireEvent.click(screen.getByRole('button', { name: /tap to identify/i }))

    expect(startCapture).toHaveBeenCalledWith('dev-1')
    expect(startCapture).toHaveBeenCalledWith('dev-2')
    expect(screen.getByText(/listening/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('a confidence event crossing the threshold calls onIdentified and returns to idle', async () => {
    render(<TapToIdentifyButton candidateDeviceIds={['dev-1', 'dev-2']} onIdentified={onIdentified} />)
    fireEvent.click(screen.getByRole('button', { name: /tap to identify/i }))

    await act(async () => {
      emitConfidence('dev-2', 0.9)
    })

    expect(onIdentified).toHaveBeenCalledWith('dev-2')
    expect(screen.getByRole('button', { name: /tap to identify/i })).toBeInTheDocument()
    expect(screen.queryByText(/listening/i)).not.toBeInTheDocument()
  })

  it('clicking Cancel before any tap stops every candidate and returns to idle', () => {
    render(<TapToIdentifyButton candidateDeviceIds={['dev-1', 'dev-2']} onIdentified={onIdentified} />)
    fireEvent.click(screen.getByRole('button', { name: /tap to identify/i }))

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(stopCapture).toHaveBeenCalledWith('dev-1')
    expect(stopCapture).toHaveBeenCalledWith('dev-2')
    expect(screen.getByRole('button', { name: /tap to identify/i })).toBeInTheDocument()
  })

  it('a confidence event arriving after Cancel does not call onIdentified (stale-response guard)', async () => {
    render(<TapToIdentifyButton candidateDeviceIds={['dev-1', 'dev-2']} onIdentified={onIdentified} />)
    fireEvent.click(screen.getByRole('button', { name: /tap to identify/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    await act(async () => {
      emitConfidence('dev-2', 0.9)
    })

    expect(onIdentified).not.toHaveBeenCalled()
  })
})
