import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { getMixerGain, mixerGainFrom, sliderToGain, subscribeMixer, useMixerGain } from '../mixer'
import { DEFAULT_MIXER_VOLUMES, useAppPreferencesStore } from '../../settings/appPreferencesStore'

afterEach(() => {
  useAppPreferencesStore.setState({ mixer: { ...DEFAULT_MIXER_VOLUMES } })
})

describe('sliderToGain', () => {
  it('maps the ends to silence and unity', () => {
    expect(sliderToGain(0)).toBe(0)
    expect(sliderToGain(1)).toBe(1)
  })

  it('puts half way at -12 dB, which is how a volume control is expected to feel', () => {
    expect(20 * Math.log10(sliderToGain(0.5))).toBeCloseTo(-12.04, 1)
  })

  it('never returns a gain outside 0..1', () => {
    expect(sliderToGain(-1)).toBe(0)
    expect(sliderToGain(3)).toBe(1)
    expect(sliderToGain(Number.NaN)).toBe(0)
  })
})

describe('mixer gains', () => {
  it('multiplies each channel by master', () => {
    const volumes = { ...DEFAULT_MIXER_VOLUMES, master: 0.5, effects: 0.5 }
    expect(mixerGainFrom(volumes, 'effects')).toBeCloseTo(0.0625, 10)
    expect(mixerGainFrom(volumes, 'music')).toBeCloseTo(0.25, 10)
    expect(mixerGainFrom(volumes, 'master')).toBeCloseTo(0.25, 10)
  })

  it('reads live from the preferences store', () => {
    useAppPreferencesStore.getState().setMixerVolume('menuMusic', 0.5)
    expect(getMixerGain('menuMusic')).toBeCloseTo(0.25, 10)
  })

  it('notifies on mixer changes only', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeMixer(listener)
    useAppPreferencesStore.getState().setSettingsTabId('anything')
    expect(listener).not.toHaveBeenCalled()
    useAppPreferencesStore.getState().setMixerVolume('music', 0.4)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('useMixerGain re-renders when a slider moves', () => {
    const { result } = renderHook(() => useMixerGain('guideVocals'))
    expect(result.current).toBe(1)
    act(() => useAppPreferencesStore.getState().setMixerVolume('guideVocals', 0))
    expect(result.current).toBe(0)
  })
})