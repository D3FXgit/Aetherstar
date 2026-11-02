import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CalibrationWizard } from '../CalibrationWizard'
import { useCalibrationStore } from '../calibrationStore'
import * as api from '../calibrationApi'
import { DEFAULT_CALIBRATION_SETTINGS } from '../types'
import type { AudioContextLike } from '../../fx/audio/sfxEngine'

vi.mock('../calibrationApi')

function createFakeAudioContext(currentTime: number): AudioContextLike {
  return {
    currentTime,
    createBufferSource: () => ({ buffer: null, connect: vi.fn(), start: vi.fn() }),
    createGain: () => ({ gain: { value: 1 }, connect: vi.fn() }),
    decodeAudioData: () => Promise.resolve({}),
    destination: {},
  }
}

beforeEach(() => {
  useCalibrationStore.setState({ settings: DEFAULT_CALIBRATION_SETTINGS })
  vi.mocked(api.set).mockResolvedValue(undefined)
})

afterEach(async () => {
  const { usePitchStore } = await import('../../audio/pitchStore')
  usePitchStore.setState({ activeCaptures: {} })
})

// Fixed clocks with unrelated origins, like a real session: scheduleClicks
// reads them once per step.
const PERF0 = 95_000
const WALL0 = 1_791_000_000_000
const CLOCKS = { perfNow: () => PERF0, wallNow: () => WALL0 }

async function completeOutputStep(tapDelayMs = 0) {
  fireEvent.click(screen.getByRole('button', { name: /start/i }))
  // jsdom's KeyboardEvent tap is timed by the real performance.now(), so pin it.
  const nowSpy = vi.spyOn(performance, 'now')
  for (let i = 0; i < 2; i++) {
    nowSpy.mockReturnValueOnce(PERF0 + i * 500 + tapDelayMs)
    fireEvent.keyDown(window, { key: ' ' })
  }
  nowSpy.mockRestore()
}

async function completeInputStep(tapDelayMs = 20) {
  fireEvent.click(screen.getByRole('button', { name: /start/i }))
  const samples = [0, 500].flatMap((clickMs) => [
    { t: WALL0 + clickMs + 5, hz: 220, confidence: 0.05, deviceId: 'mic-1' },
    { t: WALL0 + clickMs + tapDelayMs, hz: 220, confidence: 0.9, deviceId: 'mic-1' },
  ])
  const { usePitchStore } = await import('../../audio/pitchStore')
  act(() => {
    usePitchStore.setState({
      activeCaptures: { 'mic-1': { latest: samples[samples.length - 1], samples, latencyMs: null } },
    })
  })
}

describe('CalibrationWizard', () => {
  it('walks output -> input -> difficulty -> transposition -> apply, persisting the assembled settings', async () => {
    const audioContext = createFakeAudioContext(0)

    render(
      <CalibrationWizard
        audioContext={audioContext}
        clickBuffer={{}}
        deviceId="mic-1"
        playerId="player-1"
        fixtureNotePitches={[60, 72]}
        beatCount={2}
        intervalSec={0.5}
        clocks={CLOCKS}
      />,
    )

    expect(screen.getByTestId('output-latency-step')).toBeInTheDocument()
    await completeOutputStep()

    expect(await screen.findByTestId('input-latency-step')).toBeInTheDocument()
    await completeInputStep()

    expect(await screen.findByTestId('difficulty-step')).toBeInTheDocument()
    // Both dials (speaker delay and mic delay) show once both measurements are done.
    expect(screen.getAllByTestId('glass-dial-value')).toHaveLength(2)
    await userEvent.click(screen.getByRole('radio', { name: /hard/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))

    expect(screen.getByTestId('transposition-step')).toBeInTheDocument()
    expect(screen.getAllByTestId('glass-dial-value')).toHaveLength(2)
    fireEvent.change(screen.getByRole('spinbutton', { name: /shift/i }), { target: { value: '5' } })
    await userEvent.click(screen.getByRole('button', { name: /apply/i }))

    expect(api.set).toHaveBeenLastCalledWith({
      outputOffsetMs: expect.any(Number),
      inputDevices: { 'mic-1': { offsetMs: expect.any(Number) } },
      players: { 'player-1': { difficulty: 'hard', transpositionSemitones: 5 } },
    })

    expect(screen.getByRole('button', { name: /run again/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /run again/i }))
    expect(screen.getByTestId('output-latency-step')).toBeInTheDocument()
  })

  it('reset restores this device/player entry to defaults', async () => {
    useCalibrationStore.setState({
      settings: {
        outputOffsetMs: 80,
        inputDevices: { 'mic-1': { offsetMs: 30 } },
        players: { 'player-1': { difficulty: 'hard', transpositionSemitones: 4 } },
      },
    })
    const audioContext = createFakeAudioContext(0)

    render(
      <CalibrationWizard
        audioContext={audioContext}
        clickBuffer={{}}
        deviceId="mic-1"
        playerId="player-1"
        fixtureNotePitches={[60, 72]}
        beatCount={2}
        intervalSec={0.5}
        clocks={CLOCKS}
      />,
    )

    await completeOutputStep()
    await completeInputStep()
    await userEvent.click(await screen.findByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /apply/i }))

    await userEvent.click(screen.getByRole('button', { name: /reset/i }))

    expect(api.set).toHaveBeenLastCalledWith({
      outputOffsetMs: 0,
      inputDevices: { 'mic-1': { offsetMs: 0 } },
      players: { 'player-1': { difficulty: 'normal', transpositionSemitones: 0 } },
    })
  })

  it('stores the mic delay net of the speaker delay its click travelled through', async () => {
    vi.mocked(api.get).mockResolvedValue(DEFAULT_CALIBRATION_SETTINGS)
    useCalibrationStore.setState({ loaded: true })
    render(
      <CalibrationWizard
        audioContext={createFakeAudioContext(12.3)}
        clickBuffer={{}}
        deviceId="mic-1"
        playerId="player-1"
        fixtureNotePitches={[60, 72]}
        beatCount={2}
        intervalSec={0.5}
        clocks={CLOCKS}
      />,
    )

    // Speaker step: key taps 80 ms after each commanded click.
    await completeOutputStep(80)
    await screen.findByTestId('input-latency-step')
    // Mic step: voice taps 110 ms after each click = 80 speaker + 30 mic.
    await completeInputStep(110)
    await userEvent.click(await screen.findByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /apply/i }))

    const saved = vi.mocked(api.set).mock.lastCall![0]
    expect(saved.outputOffsetMs).toBeCloseTo(80, 5)
    expect(saved.inputDevices['mic-1'].offsetMs).toBeCloseTo(30, 5)
  })
})
