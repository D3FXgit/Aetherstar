import { describe, expect, it, beforeEach, vi } from 'vitest'

const STORAGE_KEY = 'aetherstar:app-preferences'

const FULL_MIXER = { master: 1, music: 1, guideVocals: 1, effects: 1, menuMusic: 1 }

describe('useAppPreferencesStore', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('defaults every preference to its off state and the mixer to full', async () => {
    const { useAppPreferencesStore } = await import('../appPreferencesStore')
    expect(useAppPreferencesStore.getState().perfOverlayVisible).toBe(false)
    expect(useAppPreferencesStore.getState().settingsTabId).toBeNull()
    expect(useAppPreferencesStore.getState().mixer).toEqual(FULL_MIXER)
  })

  it('has no default audio device preference', async () => {
    const { useAppPreferencesStore } = await import('../appPreferencesStore')
    expect('defaultAudioDeviceId' in useAppPreferencesStore.getState()).toBe(false)
    expect('setDefaultAudioDevice' in useAppPreferencesStore.getState()).toBe(false)
  })

  it('persists setPerfOverlayVisible to localStorage on change', async () => {
    const { useAppPreferencesStore } = await import('../appPreferencesStore')
    useAppPreferencesStore.getState().setPerfOverlayVisible(true)

    expect(useAppPreferencesStore.getState().perfOverlayVisible).toBe(true)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      perfOverlayVisible: true,
      settingsTabId: null,
      mixer: FULL_MIXER,
      language: null,
      menuMusicMode: 'library',
    })
  })

  describe('menu music mode', () => {
    it('defaults to songs from the library', async () => {
      const { useAppPreferencesStore } = await import('../appPreferencesStore')
      expect(useAppPreferencesStore.getState().menuMusicMode).toBe('library')
    })

    it('persists a change and reads it back on reload', async () => {
      const first = await import('../appPreferencesStore')
      first.useAppPreferencesStore.getState().setMenuMusicMode('off')
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).menuMusicMode).toBe('off')

      vi.resetModules()
      const second = await import('../appPreferencesStore')
      expect(second.useAppPreferencesStore.getState().menuMusicMode).toBe('off')
    })

    it('ignores an unknown mode, stored or set', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ menuMusicMode: 'radio' }))
      const { useAppPreferencesStore } = await import('../appPreferencesStore')
      expect(useAppPreferencesStore.getState().menuMusicMode).toBe('library')

      useAppPreferencesStore.getState().setMenuMusicMode('loud' as never)
      expect(useAppPreferencesStore.getState().menuMusicMode).toBe('library')
    })
  })

  it('picks up a persisted value on (re-)load, dropping retired keys on the next write', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ defaultAudioDeviceId: 'device-2', perfOverlayVisible: true }))
    const { useAppPreferencesStore } = await import('../appPreferencesStore')

    expect(useAppPreferencesStore.getState().perfOverlayVisible).toBe(true)
    useAppPreferencesStore.getState().setSettingsTabId('x')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).not.toHaveProperty('defaultAudioDeviceId')
  })

  it('remembers the settings pane last looked at', async () => {
    const { useAppPreferencesStore } = await import('../appPreferencesStore')
    useAppPreferencesStore.getState().setSettingsTabId('settings-tab-graphics')

    expect(useAppPreferencesStore.getState().settingsTabId).toBe('settings-tab-graphics')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).settingsTabId).toBe('settings-tab-graphics')
  })

  // A value written before a preference existed is missing that key entirely.
  // Reading it back as `undefined` would hand consumers a value they never
  // expect -- and, for the tab id, blank the Settings scene.
  it('fills in a preference that a previously-stored value predates', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ perfOverlayVisible: true }))
    const { useAppPreferencesStore } = await import('../appPreferencesStore')

    expect(useAppPreferencesStore.getState().settingsTabId).toBeNull()
    expect(useAppPreferencesStore.getState().mixer).toEqual(FULL_MIXER)
  })

  it('falls back to defaults when the persisted value is corrupt, without throwing', async () => {
    localStorage.setItem(STORAGE_KEY, '{ not valid json')
    const { useAppPreferencesStore } = await import('../appPreferencesStore')

    expect(useAppPreferencesStore.getState().perfOverlayVisible).toBe(false)
    expect(useAppPreferencesStore.getState().mixer).toEqual(FULL_MIXER)
  })

  describe('mixer', () => {
    it('persists one slider without touching the others', async () => {
      const { useAppPreferencesStore } = await import('../appPreferencesStore')
      useAppPreferencesStore.getState().setMixerVolume('effects', 0.25)

      expect(useAppPreferencesStore.getState().mixer).toEqual({ ...FULL_MIXER, effects: 0.25 })
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).mixer).toEqual({ ...FULL_MIXER, effects: 0.25 })
    })

    it('clamps a slider to 0..1 and ignores a non-number', async () => {
      const { useAppPreferencesStore } = await import('../appPreferencesStore')
      useAppPreferencesStore.getState().setMixerVolume('music', 3)
      expect(useAppPreferencesStore.getState().mixer.music).toBe(1)
      useAppPreferencesStore.getState().setMixerVolume('music', -1)
      expect(useAppPreferencesStore.getState().mixer.music).toBe(0)
      useAppPreferencesStore.getState().setMixerVolume('music', Number.NaN)
      expect(useAppPreferencesStore.getState().mixer.music).toBe(0)
    })

    it('trusts a stored mixer per channel, so one bad value does not reset the rest', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mixer: { master: 0.5, music: 'loud', effects: 7 } }))
      const { useAppPreferencesStore } = await import('../appPreferencesStore')

      expect(useAppPreferencesStore.getState().mixer).toEqual({ ...FULL_MIXER, master: 0.5, effects: 1 })
    })
  })

  describe('language', () => {
    it('defaults to null ("Automatic" -- follow the system language)', async () => {
      const { useAppPreferencesStore } = await import('../appPreferencesStore')
      expect(useAppPreferencesStore.getState().language).toBeNull()
    })

    it('persists a picked language and restores it on reload', async () => {
      const first = await import('../appPreferencesStore')
      first.useAppPreferencesStore.getState().setLanguage('de')
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).language).toBe('de')

      vi.resetModules()
      const second = await import('../appPreferencesStore')
      expect(second.useAppPreferencesStore.getState().language).toBe('de')
    })

    it('stores anything that is not a language code as null', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ language: '../../evil' }))
      const { useAppPreferencesStore } = await import('../appPreferencesStore')
      expect(useAppPreferencesStore.getState().language).toBeNull()
      useAppPreferencesStore.getState().setLanguage('pt-BR')
      expect(useAppPreferencesStore.getState().language).toBe('pt-BR')
      useAppPreferencesStore.getState().setLanguage('Klingon!')
      expect(useAppPreferencesStore.getState().language).toBeNull()
    })
  })
})
