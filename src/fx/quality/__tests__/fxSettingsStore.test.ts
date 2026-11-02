import { describe, expect, it, beforeEach, vi } from 'vitest'

const STORAGE_KEY = 'aetherstar:fx-settings'

describe('useFxSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('defaults reduceEffects to false', async () => {
    const { useFxSettingsStore } = await import('../fxSettingsStore')
    expect(useFxSettingsStore.getState().reduceEffects).toBe(false)
  })

  it('persists reduceEffects to localStorage on change', async () => {
    const { useFxSettingsStore } = await import('../fxSettingsStore')
    useFxSettingsStore.getState().setReduceEffects(true)

    expect(useFxSettingsStore.getState().reduceEffects).toBe(true)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ reduceEffects: true })
  })

  it('picks up a persisted value on (re-)load', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ reduceEffects: true }))
    const { useFxSettingsStore } = await import('../fxSettingsStore')

    expect(useFxSettingsStore.getState().reduceEffects).toBe(true)
  })
})
