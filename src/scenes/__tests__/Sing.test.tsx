import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Sing } from '../Sing'
import { resetChartCacheForTests } from '../../stage/chart/useChartLoader'
import { usePitchStore } from '../../audio/pitchStore'
import { useMultiplayerStore } from '../../multiplayer/store'
import { toMicSlotArray } from '../../multiplayer/types'
import { useCalibrationStore } from '../../calibration/calibrationStore'
import { DEFAULT_CALIBRATION_SETTINGS } from '../../calibration/types'

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/sample-song/notes.txt',
)
const raw = readFileSync(FIXTURE_PATH, 'utf-8')
const ABSOLUTE_FIXTURE_PATH = '/abs/fixtures/sample-song/notes.txt'

describe('Sing', () => {
  beforeEach(() => {
    usePitchStore.setState({ devices: [], permissionStatus: 'not-determined', activeCaptures: {} })
    useMultiplayerStore.setState({ slots: toMicSlotArray([]), bindings: [], runningCaptureKeys: [], captureHolders: [] })
    useCalibrationStore.setState({ settings: DEFAULT_CALIBRATION_SETTINGS })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete window.api
    // The chart cache is a module-level singleton that outlives both the React
    // tree and this test's `fetch` stub (see useChartLoader).
    resetChartCacheForTests()
  })

  it('loads the fixture chart via window.api and renders the real Stage', async () => {
    // @ts-expect-error -- only the members Sing.tsx actually uses are stubbed
    window.api = {
      stage: { getFixtureChartPath: vi.fn().mockResolvedValue(ABSOLUTE_FIXTURE_PATH) },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(raw) }))

    render(<Sing />)

    await waitFor(() => expect(screen.getAllByTestId('lyric-line').length).toBeGreaterThan(0))
    expect(screen.getByText(/Wake/)).toBeInTheDocument()
  })

  // Gameplay starts its own capture and reports mic health in the lane, so the
  // overlay must mount even when no capture is running yet.
  it('mounts gameplay even with no capture running, so it can start its own', async () => {
    // @ts-expect-error -- only the members Sing.tsx actually uses are stubbed
    window.api = {
      stage: { getFixtureChartPath: vi.fn().mockResolvedValue(ABSOLUTE_FIXTURE_PATH) },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(raw) }))

    render(<Sing />)

    await waitFor(() => expect(screen.getAllByTestId('lyric-line').length).toBeGreaterThan(0))
    expect(screen.getByTestId('gameplay')).toBeInTheDocument()
    expect(screen.queryByTestId('no-mic-active')).not.toBeInTheDocument()
  })

  it('uses the chartPath prop instead of window.api.stage.getFixtureChartPath when provided', async () => {
    const getFixtureChartPath = vi.fn().mockResolvedValue('/should/not/be/used.txt')
    // @ts-expect-error -- only the members Sing.tsx actually uses are stubbed
    window.api = { stage: { getFixtureChartPath } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(raw) }))

    render(<Sing chartPath={ABSOLUTE_FIXTURE_PATH} />)

    await waitFor(() => expect(screen.getAllByTestId('lyric-line').length).toBeGreaterThan(0))
    expect(getFixtureChartPath).not.toHaveBeenCalled()
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`app-media://media${ABSOLUTE_FIXTURE_PATH}`)
  })

  it('threads onSongEnded through to Stage', async () => {
    const onSongEnded = vi.fn()
    // @ts-expect-error -- only the members Sing.tsx actually uses are stubbed
    window.api = { stage: { getFixtureChartPath: vi.fn().mockResolvedValue(ABSOLUTE_FIXTURE_PATH) } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(raw) }))

    render(<Sing onSongEnded={onSongEnded} />)

    await waitFor(() => expect(screen.getAllByTestId('lyric-line').length).toBeGreaterThan(0))
    const audio = document.querySelector('audio')
    expect(audio).not.toBeNull()
    fireEvent(audio!, new Event('ended'))
    expect(onSongEnded).toHaveBeenCalledOnce()
  })

  it('renders Gameplay alongside Stage when a pitch capture is active', async () => {
    usePitchStore.setState({
      activeCaptures: { 'dev-1': { latest: null, samples: [], latencyMs: null } },
    })
    // @ts-expect-error -- only the members Sing.tsx actually uses are stubbed
    window.api = {
      stage: { getFixtureChartPath: vi.fn().mockResolvedValue(ABSOLUTE_FIXTURE_PATH) },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(raw) }))

    render(<Sing />)

    await waitFor(() => expect(screen.getAllByTestId('lyric-line').length).toBeGreaterThan(0))
    expect(screen.getByTestId('gameplay')).toBeInTheDocument()
    expect(screen.queryByTestId('no-mic-active')).not.toBeInTheDocument()
  })

  it('renders one Gameplay per configured mic when 2+ mics are set up', async () => {
    const twoMics = [
      { slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 },
      { slotNumber: 2, deviceId: 'dev-2', channelIndex: 0 },
    ]
    useMultiplayerStore.setState({ slots: toMicSlotArray(twoMics), bindings: twoMics })
    usePitchStore.setState({
      activeCaptures: {
        'dev-1': { latest: null, samples: [], latencyMs: null },
        'dev-2': { latest: null, samples: [], latencyMs: null },
      },
    })
    // The gameplay overlay reloads the mic configuration from persistence on
    // mount (so a song reached without ever opening Settings still knows its
    // inputs), so the bridge has to return the same two mics.
    window.api = {
      stage: { getFixtureChartPath: vi.fn().mockResolvedValue(ABSOLUTE_FIXTURE_PATH) },
      multiplayer: { listMicSlots: vi.fn().mockResolvedValue(twoMics) },
      // only the members Sing.tsx and the gameplay overlay actually use are stubbed
    } as unknown as Window['api']
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(raw) }))

    render(<Sing />)

    await waitFor(() => expect(screen.getAllByTestId('lyric-line').length).toBeGreaterThan(0))
    expect(screen.getAllByTestId('gameplay').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByTestId('no-mic-active')).not.toBeInTheDocument()
  })

  it('renders Gameplay (not "no mic active") when a mic is set up even with no active capture yet', async () => {
    const oneMic = [{ slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 }]
    useMultiplayerStore.setState({ slots: toMicSlotArray(oneMic), bindings: oneMic })
    window.api = {
      stage: { getFixtureChartPath: vi.fn().mockResolvedValue(ABSOLUTE_FIXTURE_PATH) },
      multiplayer: { listMicSlots: vi.fn().mockResolvedValue(oneMic) },
      // only the members Sing.tsx and the gameplay overlay actually use are stubbed
    } as unknown as Window['api']
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(raw) }))

    render(<Sing />)

    await waitFor(() => expect(screen.getAllByTestId('lyric-line').length).toBeGreaterThan(0))
    expect(screen.getByTestId('gameplay')).toBeInTheDocument()
    expect(screen.queryByTestId('no-mic-active')).not.toBeInTheDocument()
  })

  // The lead-in only shows in the last three seconds before the first note
  // (the fixture's first note is beat 0, i.e. #GAP = 6.0 s). The saved
  // output-latency offset moves that note -- and so the lead-in -- later by
  // exactly the offset.
  it('shifts the lead-in countdown by the saved output-latency offset', async () => {
    // @ts-expect-error -- only the members Sing.tsx actually uses are stubbed
    window.api = {
      stage: { getFixtureChartPath: vi.fn().mockResolvedValue(ABSOLUTE_FIXTURE_PATH) },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(raw) }))

    const seekClockTo = (ms: number) => {
      const audio = document.querySelector<HTMLAudioElement>('audio[data-testid="stage-clock-audio"]')!
      Object.defineProperty(audio, 'currentTime', { value: ms / 1000, configurable: true, writable: true })
    }
    // 2.5 s before the uncalibrated first note.
    const leadInMs = 6000 - 2500

    const { unmount } = render(<Sing />)
    await waitFor(() => expect(screen.getAllByTestId('lyric-line').length).toBeGreaterThan(0))
    seekClockTo(leadInMs)
    await waitFor(() => expect(screen.getByTestId('stage-countdown')).toHaveTextContent('3'))
    unmount()

    useCalibrationStore.setState({ settings: { ...DEFAULT_CALIBRATION_SETTINGS, outputOffsetMs: 800 } })
    render(<Sing />)
    await waitFor(() => expect(screen.getAllByTestId('lyric-line').length).toBeGreaterThan(0))

    // The same instant is now 3.3 s out: too early for the lead-in.
    seekClockTo(leadInMs)
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(screen.queryByTestId('stage-countdown')).not.toBeInTheDocument()

    // 800 ms later it counts in exactly as the uncalibrated song did.
    seekClockTo(leadInMs + 800)
    await waitFor(() => expect(screen.getByTestId('stage-countdown')).toHaveTextContent('3'))
  })

  // A corrupt or legacy saved offset (the old mixed-clock calibration stored
  // minutes) must never push the song by more than the 1000 ms bound.
  it('clamps an out-of-range saved output offset to ±1000 ms where it is applied', async () => {
    // @ts-expect-error -- only the members Sing.tsx actually uses are stubbed
    window.api = {
      stage: { getFixtureChartPath: vi.fn().mockResolvedValue(ABSOLUTE_FIXTURE_PATH) },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(raw) }))
    const seekClockTo = (ms: number) => {
      const audio = document.querySelector<HTMLAudioElement>('audio[data-testid="stage-clock-audio"]')!
      Object.defineProperty(audio, 'currentTime', { value: ms / 1000, configurable: true, writable: true })
    }

    useCalibrationStore.setState({ settings: { ...DEFAULT_CALIBRATION_SETTINGS, outputOffsetMs: 183_250 } })
    render(<Sing />)
    await waitFor(() => expect(screen.getAllByTestId('lyric-line').length).toBeGreaterThan(0))

    // First note at 6.0 s + 1 s (clamped): 2.5 s before it, the count-in.
    seekClockTo(6000 + 1000 - 2500)
    await waitFor(() => expect(screen.getByTestId('stage-countdown')).toHaveTextContent('3'))
  })

  it('renders a GlassErrorState when the chart fails to load', async () => {
    // @ts-expect-error -- only the members Sing.tsx actually uses are stubbed
    window.api = {
      stage: { getFixtureChartPath: vi.fn().mockResolvedValue(ABSOLUTE_FIXTURE_PATH) },
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected token')))

    render(<Sing />)

    await waitFor(() => expect(screen.getByTestId('glass-error-state')).toBeInTheDocument())
    expect(screen.getByText(/Unexpected token/)).toBeInTheDocument()
  })

  it('shows the same clean error state -- never a crash -- for a malformed chart the parser cannot make singable', async () => {
    // @ts-expect-error -- only the members Sing.tsx actually uses are stubbed
    window.api = { stage: { getFixtureChartPath: vi.fn().mockResolvedValue(ABSOLUTE_FIXTURE_PATH) } }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('this file is not an UltraStar chart at all') }),
    )

    render(<Sing />)

    await waitFor(() => expect(screen.getByTestId('glass-error-state')).toBeInTheDocument())
    expect(screen.queryByTestId('error-boundary-fallback')).not.toBeInTheDocument()
    expect(screen.getByText(/BPM/i)).toBeInTheDocument()
  })

  it('does not blow up when the preload surface has no stage API at all (no chartPath given)', async () => {
    // @ts-expect-error -- deliberately missing `stage`
    window.api = { getAppInfo: vi.fn() }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(() => render(<Sing />)).not.toThrow()
    await waitFor(() => expect(screen.getByText('Loading…')).toBeInTheDocument())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('contains a rejected fixture-path promise instead of letting it escape as an unhandled rejection', async () => {
    // @ts-expect-error -- only the members Sing.tsx actually uses are stubbed
    window.api = { stage: { getFixtureChartPath: vi.fn().mockRejectedValue(new Error('ipc gone')) } }
    vi.stubGlobal('fetch', vi.fn())
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<Sing />)

    await waitFor(() =>
      expect(
        errorSpy.mock.calls.some((call) => typeof call[0] === 'string' && call[0].includes('ipc gone')),
      ).toBe(true),
    )
    errorSpy.mockRestore()
  })
})
