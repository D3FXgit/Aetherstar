import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resetPreviewCeilingForTests,
  resolvePreviewTrack,
  STREAMED_MEASURE_DELAY_MS,
  useWebAudioManager,
} from '../useWebAudioManager'
import { createWebAudioManager } from '../webAudioManager'
import { clearSongGainCache } from '../songGain'
import { dbToGain, UNMEASURED_GAIN_DB } from '../loudness'
import { getSong } from '../../library/api'
import { DEFAULT_MIXER_VOLUMES, useAppPreferencesStore } from '../../settings/appPreferencesStore'
import type { TrackInfo } from '../webAudioManager'

vi.mock('../../library/api', () => ({ getSong: vi.fn() }))
vi.mock('../webAudioManager')
// The background measurement of a streamed song decodes it on the shared
// context; here that "decode" is a -12 LUFS tone.
vi.mock('../webAudioApi', () => ({ getSharedAudioContext: () => ({ decodeAudioData: async () => toneBuffer() }) }))

const FOLDER = 'D:/Songs/A#B'
const URL = 'aetherstar-media://roots/D:/Songs/A%23B/song.mp3'
const neverDecoded = { buffer: new Promise<AudioBuffer>(() => {}) }

function toneBuffer(): AudioBuffer {
  const sampleRate = 48_000
  const data = new Float32Array(sampleRate * 2)
  for (let i = 0; i < data.length; i++) data[i] = 10 ** (-12 / 20) * Math.sin((2 * Math.PI * 1000 * i) / sampleRate)
  return { sampleRate, numberOfChannels: 2, length: data.length, duration: 2, getChannelData: () => data } as unknown as AudioBuffer
}

beforeEach(() => {
  localStorage.clear()
  clearSongGainCache()
  resetPreviewCeilingForTests()
  vi.mocked(getSong).mockReset()
  useAppPreferencesStore.setState({ mixer: { ...DEFAULT_MIXER_VOLUMES } })
  vi.mocked(createWebAudioManager).mockReturnValue({
    play: vi.fn(),
    duckTo: vi.fn(),
    restore: vi.fn(),
    crossfadeTo: vi.fn(),
    stop: vi.fn(),
  } as never)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('resolvePreviewTrack', () => {
  it('gives the menu track unity without asking the library', async () => {
    await expect(resolvePreviewTrack('/assets/menu_loop.wav', neverDecoded)).resolves.toBe(1)
    expect(getSong).not.toHaveBeenCalled()
  })

  it('normalises a measured song and passes its #PREVIEWSTART along', async () => {
    vi.mocked(getSong).mockImplementation(async (path) =>
      path === 'D:\\Songs\\A#B' ? ({ path, loudnessLufs: -6, truePeakDbtp: 0, previewStartSec: 33, mp3Path: null } as never) : null,
    )
    const info = (await resolvePreviewTrack(URL, neverDecoded)) as TrackInfo
    expect(info.gain).toBeCloseTo(dbToGain(-12), 10)
    expect(info.previewStartSec).toBe(33)
    expect(info.refinedGain).toBeUndefined()
  })

  it("returns the plain normalisation gain; the stage ceiling is the preview bus's job", async () => {
    vi.mocked(getSong).mockResolvedValue({ path: FOLDER, loudnessLufs: -24, truePeakDbtp: -12 } as never)
    const info = (await resolvePreviewTrack(URL, neverDecoded)) as TrackInfo
    // +6 dB wanted and allowed by the true peak.
    expect(info.gain).toBeCloseTo(dbToGain(6), 6)
  })

  it('starts an unmeasured song at the default and refines it from the decoded buffer', async () => {
    vi.mocked(getSong).mockResolvedValue({ path: FOLDER, loudnessLufs: null, truePeakDbtp: null } as never)
    const info = (await resolvePreviewTrack(URL, { buffer: Promise.resolve(toneBuffer()) })) as TrackInfo
    expect(info.gain).toBeCloseTo(dbToGain(UNMEASURED_GAIN_DB), 10)
    // -12 LUFS against -18: 6 dB down.
    await expect(info.refinedGain).resolves.toBeCloseTo(dbToGain(-6), 1)
  })

  describe('a streamed song (no buffer to measure)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }))
      vi.mocked(getSong).mockResolvedValue({ path: FOLDER, loudnessLufs: null, truePeakDbtp: null, mp3Path: `${FOLDER}/song.mp3` } as never)
    })

    it('starts at the default and is measured in the background once it has stayed on its bus -- never before it starts', async () => {
      useWebAudioManager.getState().play(URL, 'preview')
      const info = (await resolvePreviewTrack(URL, {})) as TrackInfo

      expect(info.gain).toBeCloseTo(dbToGain(UNMEASURED_GAIN_DB), 10)
      // Nothing fetched for measuring while the song is just starting.
      await vi.advanceTimersByTimeAsync(STREAMED_MEASURE_DELAY_MS - 1)
      expect(fetch).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      await expect(info.refinedGain).resolves.toBeCloseTo(dbToGain(-6), 1)
      expect(fetch).toHaveBeenCalledWith(URL)
    })

    it('is not measured at all when it was only browsed past', async () => {
      useWebAudioManager.getState().play(URL, 'preview')
      const info = (await resolvePreviewTrack(URL, {})) as TrackInfo
      useWebAudioManager.getState().crossfadeTo('aetherstar-media://roots/D:/Songs/Other/song.mp3', 220, 'preview')

      await vi.advanceTimersByTimeAsync(STREAMED_MEASURE_DELAY_MS)

      await expect(info.refinedGain).resolves.toBeNull()
      expect(fetch).not.toHaveBeenCalled()
    })
  })
})
