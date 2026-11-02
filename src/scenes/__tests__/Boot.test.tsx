import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Boot } from '../Boot'
import { usePitchStore } from '../../audio/pitchStore'
import { useSceneStore } from '../sceneStore'

describe('Boot', () => {
  let resolveListDevices: (devices: { id: string; name: string; channelCount: number; sampleRate: number }[]) => void

  beforeEach(() => {
    usePitchStore.setState({ devices: [] })
    useSceneStore.setState({ current: 'boot' })
    const listDevicesPromise = new Promise<{ id: string; name: string; channelCount: number; sampleRate: number }[]>(
      (resolve) => {
        resolveListDevices = resolve
      },
    )
    // @ts-expect-error -- only the fields Boot/Home touch matter for this test
    window.api = {
      audio: { listDevices: vi.fn().mockReturnValue(listDevicesPromise) },
      getAppInfo: vi.fn().mockResolvedValue({ platform: 'darwin' }),
      onPong: vi.fn().mockReturnValue(() => {}),
    } as Window['api']
  })

  afterEach(() => {
    delete window.api
  })

  it('shows the sweep animation and stays on the boot scene before devices resolve', () => {
    render(<Boot />)
    expect(screen.getByTestId('boot-sweep')).toBeInTheDocument()
    expect(useSceneStore.getState().current).toBe('boot')
  })

  it('hides the sweep and navigates to Home once devices resolve', async () => {
    render(<Boot />)
    resolveListDevices([{ id: 'mic-1', name: 'USB Mic', channelCount: 1, sampleRate: 48000 }])
    await waitFor(() => expect(useSceneStore.getState().current).toBe('home'))
    expect(screen.queryByTestId('boot-sweep')).not.toBeInTheDocument()
  })

  // Before the first scan answers there is no honest count to show, so the
  // splash says it is looking rather than claiming "No mic found".
  it('says it is looking for mics before devices resolve', () => {
    render(<Boot />)
    expect(screen.getByTestId('boot-status')).toHaveTextContent('Looking for mics…')
  })

  it('never names the audio backend in the readout', () => {
    render(<Boot />)
    expect(screen.getByTestId('boot-status').textContent).not.toMatch(/WASAPI|CORE AUDIO|ALSA/)
  })

  it("reflects usePitchStore's device count in the status readout reactively", () => {
    render(<Boot />)
    // Simulate a device-list-changed event arriving before readiness resolves --
    // the readout reads usePitchStore().devices.length live, not a one-shot snapshot.
    act(() => {
      usePitchStore.setState({
        devices: [
          { id: 'mic-1', name: 'USB Mic', channelCount: 1, sampleRate: 48000 },
          { id: 'mic-2', name: 'Interface In 1', channelCount: 1, sampleRate: 48000 },
        ],
      })
    })
    expect(screen.getByTestId('boot-status')).toHaveTextContent('2 mics ready')
  })
})
