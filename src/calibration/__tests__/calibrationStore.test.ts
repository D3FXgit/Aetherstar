import { describe, expect, it, vi, beforeEach } from 'vitest'
import { difficultyForPlayer, useCalibrationStore } from '../calibrationStore'
import * as api from '../calibrationApi'
import { DEFAULT_CALIBRATION_SETTINGS } from '../types'

vi.mock('../calibrationApi')

const LOADED_SETTINGS = {
  outputOffsetMs: 40,
  inputDevices: { 'mic-1': { offsetMs: 10 } },
  players: { 'player-1': { difficulty: 'normal' as const, transpositionSemitones: 0 } },
}

beforeEach(() => {
  useCalibrationStore.setState({ settings: DEFAULT_CALIBRATION_SETTINGS, target: null })
  vi.mocked(api.get).mockResolvedValue(LOADED_SETTINGS)
  vi.mocked(api.set).mockResolvedValue(undefined)
})

describe('useCalibrationStore', () => {
  it('load() populates settings from api.get', async () => {
    await useCalibrationStore.getState().load()
    expect(useCalibrationStore.getState().settings).toEqual(LOADED_SETTINGS)
  })

  it('setOutputOffset() merges outputOffsetMs and persists the full settings', async () => {
    await useCalibrationStore.getState().load()
    await useCalibrationStore.getState().setOutputOffset(99)

    expect(useCalibrationStore.getState().settings.outputOffsetMs).toBe(99)
    expect(api.set).toHaveBeenCalledWith({ ...LOADED_SETTINGS, outputOffsetMs: 99 })
  })

  it('setInputDeviceOffset() merges one device entry without touching others', async () => {
    await useCalibrationStore.getState().load()
    await useCalibrationStore.getState().setInputDeviceOffset('mic-2', 25)

    expect(useCalibrationStore.getState().settings.inputDevices).toEqual({
      'mic-1': { offsetMs: 10 },
      'mic-2': { offsetMs: 25 },
    })
    expect(api.set).toHaveBeenCalledWith({
      ...LOADED_SETTINGS,
      inputDevices: { 'mic-1': { offsetMs: 10 }, 'mic-2': { offsetMs: 25 } },
    })
  })

  it('setPlayerCalibration() merges one player entry without touching others', async () => {
    await useCalibrationStore.getState().load()
    await useCalibrationStore.getState().setPlayerCalibration('player-2', { difficulty: 'hard', transpositionSemitones: -3 })

    expect(useCalibrationStore.getState().settings.players).toEqual({
      'player-1': { difficulty: 'normal', transpositionSemitones: 0 },
      'player-2': { difficulty: 'hard', transpositionSemitones: -3 },
    })
  })
})

describe('useCalibrationStore offset bounds', () => {
  it('clamps measured offsets to ±1000 ms before keeping or persisting them', async () => {
    await useCalibrationStore.getState().load()
    await useCalibrationStore.getState().setOutputOffset(183_250)
    await useCalibrationStore.getState().setInputDeviceOffset('mic-1', -1.79e12)

    const { settings } = useCalibrationStore.getState()
    expect(settings.outputOffsetMs).toBe(1000)
    expect(settings.inputDevices['mic-1']).toEqual({ offsetMs: -1000 })
    expect(api.set).toHaveBeenLastCalledWith(expect.objectContaining({ outputOffsetMs: 1000 }))
  })

  it('treats implausible saved offsets (the old mixed-clock values) as never measured on load', async () => {
    vi.mocked(api.get).mockResolvedValue({
      outputOffsetMs: 183_250,
      inputDevices: { 'mic-1': { offsetMs: 1.79e12 }, 'mic-2': { offsetMs: 25 } },
      players: {},
    })
    await useCalibrationStore.getState().load()
    expect(useCalibrationStore.getState().settings).toEqual({
      outputOffsetMs: 0,
      inputDevices: { 'mic-2': { offsetMs: 25 } },
      players: {},
    })
  })
})

describe('useCalibrationStore calibration target', () => {
  it('starts with no target, so CalibrationScene keeps its own device/player fallback', () => {
    expect(useCalibrationStore.getState().target).toBeNull()
  })

  it('setTarget() records the player and device a caller wants calibrated', () => {
    useCalibrationStore.getState().setTarget({ playerId: 'p3', deviceId: 'dev-2' })

    expect(useCalibrationStore.getState().target).toEqual({ playerId: 'p3', deviceId: 'dev-2' })
  })

  it('setTarget(null) clears the target', () => {
    useCalibrationStore.getState().setTarget({ playerId: 'p3', deviceId: 'dev-2' })
    useCalibrationStore.getState().setTarget(null)

    expect(useCalibrationStore.getState().target).toBeNull()
  })
})

describe('useCalibrationStore loading before writing', () => {
  beforeEach(() => {
    useCalibrationStore.setState({ settings: DEFAULT_CALIBRATION_SETTINGS, loaded: false, target: null })
  })

  it('a write before any load reads the saved settings first instead of overwriting them with defaults', async () => {
    await useCalibrationStore.getState().setPlayerDifficulty('player-2', 'easy')

    expect(api.get).toHaveBeenCalled()
    expect(api.set).toHaveBeenCalledWith({
      ...LOADED_SETTINGS,
      players: {
        'player-1': { difficulty: 'normal', transpositionSemitones: 0 },
        'player-2': { difficulty: 'easy', transpositionSemitones: 0 },
      },
    })
  })

  it('setPlayerDifficulty() keeps the singer transposition', async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...LOADED_SETTINGS,
      players: { 'player-1': { difficulty: 'normal', transpositionSemitones: -2 } },
    })
    await useCalibrationStore.getState().setPlayerDifficulty('player-1', 'hard')

    expect(useCalibrationStore.getState().settings.players['player-1']).toEqual({ difficulty: 'hard', transpositionSemitones: -2 })
  })

  it('ensureLoaded() reads once for concurrent callers', async () => {
    vi.mocked(api.get).mockClear()
    await Promise.all([useCalibrationStore.getState().ensureLoaded(), useCalibrationStore.getState().ensureLoaded()])
    await useCalibrationStore.getState().ensureLoaded()

    expect(api.get).toHaveBeenCalledTimes(1)
  })

  it('difficultyForPlayer() defaults to normal', () => {
    expect(difficultyForPlayer(DEFAULT_CALIBRATION_SETTINGS, 'nobody')).toBe('normal')
    expect(difficultyForPlayer(LOADED_SETTINGS, 'player-1')).toBe('normal')
  })
})
