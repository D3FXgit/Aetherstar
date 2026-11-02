import { describe, expect, it, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { LabCalibration } from '../LabCalibration'
import { useCalibrationStore } from '../../calibration/calibrationStore'
import { usePitchStore } from '../../audio/pitchStore'
import * as calibrationApi from '../../calibration/calibrationApi'
import { DEFAULT_CALIBRATION_SETTINGS } from '../../calibration/types'

vi.mock('../../calibration/calibrationApi')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const chartRaw = readFileSync(path.join(ROOT, 'fixtures/sample-song/notes.txt'), 'utf-8')
const ABSOLUTE_FIXTURE_PATH = '/abs/fixtures/sample-song/notes.txt'

// Mirrors LabCalibration's LAB_BEAT_COUNT / LAB_INTERVAL_SEC.
const LAB_BEAT_COUNT = 2
const LAB_INTERVAL_MS = 300
// Unrelated clock origins, like a real session: performance.now() counts from
// page load, Date.now() is epoch ms.
const PERF0 = 95_000
const WALL0 = 1_791_000_000_000
const OUTPUT_TAP_DELAY_MS = 40
const INPUT_TAP_DELAY_MS = 70

/** Runs `fn` with `clock.now()` (performance or Date) returning `value`, then restores it. */
function pinClock(clock: { now: () => number }, value: number, fn: () => void) {
  const spy = vi.spyOn(clock, 'now').mockReturnValue(value)
  try {
    fn()
  } finally {
    spy.mockRestore()
  }
}

describe('LabCalibration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete window.api
    useCalibrationStore.setState({ settings: DEFAULT_CALIBRATION_SETTINGS })
    usePitchStore.setState({ activeCaptures: {} })
  })

  it('runs the full wizard against fixture/mock data, mic- and AudioContext-free, and persists the assembled settings', async () => {
    // @ts-expect-error -- only the members LabCalibration actually uses are stubbed
    window.api = { stage: { getFixtureChartPath: vi.fn().mockResolvedValue(ABSOLUTE_FIXTURE_PATH) } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(chartRaw) }))
    vi.mocked(calibrationApi.set).mockResolvedValue(undefined)

    render(<LabCalibration />)

    await waitFor(() => expect(screen.getByTestId('output-latency-step')).toBeInTheDocument())
    // The lab runs on the real clocks (no injected CalibrationClocks), so pin
    // them: the speaker step schedules clicks on, and reads key taps from,
    // performance.now(); taps land OUTPUT_TAP_DELAY_MS after each click.
    pinClock(performance, PERF0, () => fireEvent.click(screen.getByRole('button', { name: /start/i })))
    for (let i = 0; i < LAB_BEAT_COUNT; i++) {
      pinClock(performance, PERF0 + i * LAB_INTERVAL_MS + OUTPUT_TAP_DELAY_MS, () =>
        fireEvent.keyDown(window, { key: ' ' }),
      )
    }

    await waitFor(() => expect(screen.getByTestId('input-latency-step')).toBeInTheDocument())
    // The mic step schedules on the epoch timeline native PitchSample.t uses.
    pinClock(Date, WALL0, () => fireEvent.click(screen.getByRole('button', { name: /start/i })))
    // LabCalibration's intervalSec (0.3) is wider than detectTapTimestamps'
    // default 200ms refractory window, so the two clicks get distinct taps.
    // The capture buffer still holds a voiced frame from before Start; it
    // predates wallStartMs and must not count as the first tap.
    const staleSample = { t: WALL0 - 400, hz: 220, confidence: 0.9, deviceId: 'lab-mock-mic' }
    const samples = [
      staleSample,
      ...[0, LAB_INTERVAL_MS].flatMap((clickMs) => [
        { t: WALL0 + clickMs + 40, hz: 220, confidence: 0.05, deviceId: 'lab-mock-mic' },
        { t: WALL0 + clickMs + INPUT_TAP_DELAY_MS, hz: 220, confidence: 0.9, deviceId: 'lab-mock-mic' },
      ]),
    ]
    act(() => {
      usePitchStore.setState({
        activeCaptures: { 'lab-mock-mic': { latest: samples[samples.length - 1], samples, latencyMs: null } },
      })
    })

    await waitFor(() => expect(screen.getByTestId('difficulty-step')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => expect(screen.getByTestId('transposition-step')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /apply/i }))

    // Speaker offset as tapped; mic offset stored net of the speaker offset.
    await waitFor(() =>
      expect(calibrationApi.set).toHaveBeenLastCalledWith({
        outputOffsetMs: OUTPUT_TAP_DELAY_MS,
        inputDevices: { 'lab-mock-mic': { offsetMs: INPUT_TAP_DELAY_MS - OUTPUT_TAP_DELAY_MS } },
        players: { 'lab-mock-player': { difficulty: 'normal', transpositionSemitones: 0 } },
      }),
    )
  })

  it('shows the output-latency step immediately, even before the fixture chart loads', () => {
    // No window.api at all -- the fixture chart never resolves, matching a pure
    // browser preview (no Electron). The wizard's first two steps don't need
    // fixtureNotePitches (only TranspositionStep does), so gating the entire
    // wizard behind chart-load would needlessly block them.
    render(<LabCalibration />)

    expect(screen.getByTestId('output-latency-step')).toBeInTheDocument()
  })
})
