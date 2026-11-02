import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { LATE_MEASUREMENT_RAMP_MS, useSongGain } from '../useSongGain'
import { clearSongGainCache, rememberSongMeasurement } from '../songGain'
import { dbToGain, UNMEASURED_GAIN_DB } from '../loudness'
import { getSong } from '../../library/api'
import { DEFAULT_MIXER_VOLUMES, useAppPreferencesStore } from '../../settings/appPreferencesStore'

vi.mock('../../library/api', () => ({ getSong: vi.fn() }))

const FOLDER = '/lib/Artist - Title'

beforeEach(() => {
  localStorage.clear()
  clearSongGainCache()
  vi.mocked(getSong).mockReset()
  useAppPreferencesStore.setState({ mixer: { ...DEFAULT_MIXER_VOLUMES } })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useSongGain', () => {
  it('applies the first answer from the index at once', async () => {
    vi.mocked(getSong).mockResolvedValue({ path: FOLDER, loudnessLufs: -6, truePeakDbtp: 0 } as never)
    const { result } = renderHook(() => useSongGain(FOLDER))
    await waitFor(() => expect(result.current).toBeCloseTo(dbToGain(-12), 6))
  })

  it('opens at the conservative default while nothing is known', () => {
    vi.mocked(getSong).mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useSongGain(FOLDER))
    expect(result.current).toBeCloseTo(dbToGain(UNMEASURED_GAIN_DB), 10)
  })

  it('puts the Music slider on top of normalisation, live', async () => {
    vi.mocked(getSong).mockResolvedValue({ path: FOLDER, loudnessLufs: -18, truePeakDbtp: -6 } as never)
    const { result } = renderHook(() => useSongGain(FOLDER))
    await waitFor(() => expect(result.current).toBeCloseTo(1, 6))

    act(() => useAppPreferencesStore.getState().setMixerVolume('music', 0.5))
    expect(result.current).toBeCloseTo(0.25, 6)
  })

  it('follows Guide vocals, not Music, for the vocal stem', async () => {
    vi.mocked(getSong).mockResolvedValue({ path: FOLDER, loudnessLufs: -18, truePeakDbtp: -6 } as never)
    useAppPreferencesStore.getState().setMixerVolume('music', 0)
    const { result } = renderHook(() => useSongGain(FOLDER, null, { channel: 'guideVocals' }))
    await waitFor(() => expect(result.current).toBeCloseTo(1, 6))
  })

  it('uses the headroom a turned-down slider leaves to lift a quiet song', async () => {
    vi.mocked(getSong).mockResolvedValue({ path: FOLDER, loudnessLufs: -21, truePeakDbtp: -10 } as never)
    useAppPreferencesStore.getState().setMixerVolume('music', 0.5)
    const { result } = renderHook(() => useSongGain(FOLDER))
    // +3 dB of normalisation on a -12 dB slider: -9 dB, not -12.
    await waitFor(() => expect(20 * Math.log10(result.current)).toBeCloseTo(-9, 1))
  })

  it('fades in a measurement that lands after the level settled, instead of stepping', async () => {
    vi.mocked(getSong).mockResolvedValue({ path: FOLDER, loudnessLufs: null, truePeakDbtp: null, mp3Path: null } as never)
    const { result } = renderHook(() => useSongGain(FOLDER))
    await waitFor(() => expect(getSong).toHaveBeenCalled())
    await act(async () => {
      await Promise.resolve()
    })
    const before = result.current
    expect(before).toBeCloseTo(dbToGain(UNMEASURED_GAIN_DB), 6)

    vi.useFakeTimers()
    // A hot song: -6 LUFS wants -12 dB.
    act(() => {
      rememberSongMeasurement(FOLDER, { integratedLufs: -6, truePeakDbtp: 0 })
    })
    act(() => {
      vi.advanceTimersByTime(LATE_MEASUREMENT_RAMP_MS / 3)
    })
    const midway = result.current
    expect(midway).toBeLessThan(before)
    expect(midway).toBeGreaterThan(dbToGain(-12))

    act(() => {
      vi.advanceTimersByTime(LATE_MEASUREMENT_RAMP_MS)
    })
    expect(result.current).toBeCloseTo(dbToGain(-12), 6)
  })
})