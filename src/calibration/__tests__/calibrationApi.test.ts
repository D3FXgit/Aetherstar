import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as api from '../calibrationApi'
import { DEFAULT_CALIBRATION_SETTINGS } from '../types'

const SETTINGS = {
  outputOffsetMs: 80,
  inputDevices: { 'mic-1': { offsetMs: 12 } },
  players: { 'player-1': { difficulty: 'easy' as const, transpositionSemitones: -1 } },
}

describe('calibration api', () => {
  beforeEach(() => {
    window.api = {
      calibration: {
        get: vi.fn().mockResolvedValue(SETTINGS),
        set: vi.fn().mockResolvedValue(SETTINGS),
      },
    } as unknown as Window['api']
  })

  it('get() returns window.api.calibration.get result', async () => {
    expect(await api.get()).toEqual(SETTINGS)
  })

  it('set() calls window.api.calibration.set with the given settings', async () => {
    await api.set(SETTINGS)
    expect(window.api!.calibration.set).toHaveBeenCalledWith(SETTINGS)
  })
})

describe('calibration api — window.api unavailable (e.g. rendered outside Electron)', () => {
  beforeEach(() => {
    window.api = undefined
  })

  it('get() resolves to the default settings instead of throwing', async () => {
    await expect(api.get()).resolves.toEqual(DEFAULT_CALIBRATION_SETTINGS)
  })

  it('set() resolves instead of throwing', async () => {
    await expect(api.set(SETTINGS)).resolves.toBeUndefined()
  })
})
