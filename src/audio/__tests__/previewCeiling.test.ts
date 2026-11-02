import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  menuMusicBusGain,
  mixerBinding,
  previewBusGain,
  resetPreviewCeilingForTests,
  resolvePreviewTrack,
  resultsBusGain,
  useWebAudioManager,
} from '../useWebAudioManager'
import { createWebAudioManager } from '../webAudioManager'
import type { TrackInfo } from '../webAudioManager'
import type { AudioManager } from '../audioManagerContract'
import { clearSongGainCache } from '../songGain'
import { dbToGain } from '../loudness'
import { getSong } from '../../library/api'
import { DEFAULT_MIXER_VOLUMES, useAppPreferencesStore } from '../../settings/appPreferencesStore'
import { getMixerGain } from '../mixer'

vi.mock('../webAudioManager')
vi.mock('../../library/api', () => ({ getSong: vi.fn() }))

const URL = 'aetherstar-media://roots/D:/Songs/Quiet/song.mp3'
const neverDecoded = { buffer: new Promise<AudioBuffer>(() => {}) }

beforeEach(() => {
  localStorage.clear()
  clearSongGainCache()
  resetPreviewCeilingForTests()
  useAppPreferencesStore.setState({ mixer: { ...DEFAULT_MIXER_VOLUMES } })
  vi.mocked(createWebAudioManager).mockReturnValue({
    play: vi.fn(),
    duckTo: vi.fn(),
    restore: vi.fn(),
    crossfadeTo: vi.fn(),
    stop: vi.fn(),
  } as never)
  // A quiet song: +6 dB of normalisation, with the true-peak headroom for it.
  vi.mocked(getSong).mockResolvedValue({ path: 'D:/Songs/Quiet', loudnessLufs: -24, truePeakDbtp: -12 } as never)
})

/** What actually reaches the speakers for the preview: track gain x bus gain. */
async function startPreview(): Promise<number> {
  useWebAudioManager.getState().play(URL, 'preview')
  const info = (await resolvePreviewTrack(URL, neverDecoded)) as TrackInfo
  return info.gain
}

describe('the preview stage ceiling', () => {
  it('holds normalisation x Music at or under 1 when the slider is raised mid-preview', async () => {
    useAppPreferencesStore.getState().setMixerVolume('music', 0.5)
    const trackGain = await startPreview()
    expect(trackGain).toBeCloseTo(dbToGain(6), 6)
    // -12 dB slider, +6 dB boost: the full boost, well under the ceiling.
    expect(trackGain * previewBusGain()).toBeCloseTo(dbToGain(6) * getMixerGain('music'), 6)

    const listener = vi.fn()
    const unsubscribe = mixerBinding.subscribe(listener)
    useAppPreferencesStore.getState().setMixerVolume('music', 1)
    expect(listener).toHaveBeenCalled()
    // The bus the engine re-reads on that change: capped, so the product is
    // exactly the stage element's ceiling, not +6 dB over it.
    expect(trackGain * mixerBinding.gainFor('preview')).toBeCloseTo(1, 6)
    unsubscribe()
  })

  it('matches the stage level again when the slider comes back down', async () => {
    const trackGain = await startPreview()
    expect(trackGain * previewBusGain()).toBeCloseTo(1, 6)
    useAppPreferencesStore.getState().setMixerVolume('music', 0.5)
    // Stage: min(normalisation x music, 1).
    expect(trackGain * previewBusGain()).toBeCloseTo(Math.min(dbToGain(6) * getMixerGain('music'), 1), 6)
  })

  it('leaves the menu-music bus uncapped by a preview', async () => {
    await startPreview()
    expect(mixerBinding.gainFor('music')).toBe(getMixerGain('menuMusic'))
  })

  it('tells the engine to re-ramp the preview bus once a new preview resolves', async () => {
    const listener = vi.fn()
    const unsubscribe = mixerBinding.subscribe(listener)
    await startPreview()
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })
})

describe('the menu-music ceiling (a library song as menu music)', () => {
  it('caps normalisation x Menu music at 1, exactly as a preview is capped', async () => {
    useWebAudioManager.getState().crossfadeTo(URL, 1200, 'music')
    const { gain } = (await resolvePreviewTrack(URL, neverDecoded)) as TrackInfo
    expect(gain).toBeCloseTo(dbToGain(6), 6)

    expect(gain * menuMusicBusGain()).toBeCloseTo(1, 6)
    expect(mixerBinding.gainFor('music')).toBe(menuMusicBusGain())

    useAppPreferencesStore.getState().setMixerVolume('menuMusic', 0.5)
    expect(gain * menuMusicBusGain()).toBeCloseTo(Math.min(dbToGain(6) * getMixerGain('menuMusic'), 1), 6)
  })

  it('lifts the cap again for the bundled loop, which is never boosted', async () => {
    useWebAudioManager.getState().crossfadeTo(URL, 1200, 'music')
    await resolvePreviewTrack(URL, neverDecoded)
    expect(menuMusicBusGain()).toBeLessThan(getMixerGain('menuMusic'))

    useWebAudioManager.getState().play('/assets/menu_loop.wav', 'music')

    expect(menuMusicBusGain()).toBe(getMixerGain('menuMusic'))
  })
})

describe('the results bed ceiling (the sung song behind the results screen)', () => {
  it('follows the Music slider (x Master), capped like a preview, and leaves the other buses alone', async () => {
    useWebAudioManager.getState().crossfadeTo(URL, 1500, 'results')
    const { gain } = (await resolvePreviewTrack(URL, neverDecoded)) as TrackInfo
    expect(gain).toBeCloseTo(dbToGain(6), 6)

    expect(gain * resultsBusGain()).toBeCloseTo(1, 6)
    expect(mixerBinding.gainFor('results')).toBe(resultsBusGain())
    expect(mixerBinding.gainFor('music')).toBe(getMixerGain('menuMusic'))

    useAppPreferencesStore.getState().setMixerVolume('music', 0.5)
    expect(gain * resultsBusGain()).toBeCloseTo(Math.min(dbToGain(6) * getMixerGain('music'), 1), 6)

    useAppPreferencesStore.getState().setMixerVolume('master', 0)
    expect(resultsBusGain()).toBe(0)
  })
})

describe('the ceilings follow a song handed between the menu bus and the preview bus', () => {
  /** The engine the store built (it is built once, on its first action, and cached). */
  function cachedEngine(): AudioManager {
    useWebAudioManager.getState().stop(0, 'results')
    return vi.mocked(createWebAudioManager).mock.results[0].value as AudioManager
  }

  it('caps the preview bus for the handed-over song, and lifts the menu cap', async () => {
    const engine = cachedEngine()
    engine.transfer = vi.fn(() => ({ track: URL, durationSec: 200, positionSec: 80 }))
    useWebAudioManager.getState().crossfadeTo(URL, 1200, 'music')
    const { gain } = (await resolvePreviewTrack(URL, neverDecoded)) as TrackInfo
    expect(gain * menuMusicBusGain()).toBeCloseTo(1, 6)

    const moved = useWebAudioManager.getState().transfer!('music', 'preview', 400, { track: URL })

    expect(moved).toMatchObject({ track: URL })
    expect(engine.transfer).toHaveBeenCalledWith('music', 'preview', 400, { track: URL })
    // The same ceiling as if the preview had been started from scratch...
    expect(gain * previewBusGain()).toBeCloseTo(1, 6)
    // ...and the menu bus is no longer capped for a song it no longer plays.
    expect(menuMusicBusGain()).toBe(getMixerGain('menuMusic'))
  })

  it('changes nothing when there was nothing to hand over', async () => {
    const engine = cachedEngine()
    engine.transfer = vi.fn(() => null)
    useWebAudioManager.getState().crossfadeTo(URL, 1200, 'music')
    await resolvePreviewTrack(URL, neverDecoded)
    const menuBefore = menuMusicBusGain()

    expect(useWebAudioManager.getState().transfer!('music', 'preview', 400)).toBeNull()

    expect(menuMusicBusGain()).toBe(menuBefore)
    expect(previewBusGain()).toBe(getMixerGain('music'))
  })
})
