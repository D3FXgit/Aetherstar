import { create } from 'zustand'
import type { AppPreferences, MenuMusicMode, MixerChannel, MixerVolumes } from './types'

// Same shape as src/fx/quality/fxSettingsStore.ts: localStorage, no IPC, for
// the preferences with no other home.
const STORAGE_KEY = 'aetherstar:app-preferences'
/** Exported so src/i18n can follow a language change made in another window (the `storage` event). */
export const APP_PREFERENCES_STORAGE_KEY = STORAGE_KEY

export const MIXER_CHANNELS: readonly MixerChannel[] = ['master', 'music', 'guideVocals', 'effects', 'menuMusic']

export const DEFAULT_MIXER_VOLUMES: MixerVolumes = {
  master: 1,
  music: 1,
  guideVocals: 1,
  effects: 1,
  menuMusic: 1,
}

export const MENU_MUSIC_MODES: readonly MenuMusicMode[] = ['library', 'builtin', 'off']

const DEFAULT_PREFERENCES: AppPreferences = {
  perfOverlayVisible: false,
  settingsTabId: null,
  mixer: { ...DEFAULT_MIXER_VOLUMES },
  language: null,
  menuMusicMode: 'library',
}

/** Same shape as src/i18n's language codes; anything else stored is treated as "Automatic". */
const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/

function sanitizeLanguage(value: unknown): string | null {
  return typeof value === 'string' && LANGUAGE_CODE_PATTERN.test(value) ? value : null
}

function sanitizeMenuMusicMode(value: unknown): MenuMusicMode {
  return MENU_MUSIC_MODES.includes(value as MenuMusicMode) ? (value as MenuMusicMode) : DEFAULT_PREFERENCES.menuMusicMode
}

interface AppPreferencesState extends AppPreferences {
  setPerfOverlayVisible: (visible: boolean) => void
  setSettingsTabId: (id: string) => void
  /** One mixer slider. Clamped to 0..1; a non-number is ignored. */
  setMixerVolume: (channel: MixerChannel, value: number) => void
  /** A language code, or null for "Automatic" (system language). An invalid code is stored as null. */
  setLanguage: (code: string | null) => void
  /** What plays behind the menus. An unknown value is ignored. */
  setMenuMusicMode: (mode: MenuMusicMode) => void
}

function clampUnit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

/** A stored mixer is trusted per channel, never whole: one bad value must not reset the other four. */
function sanitizeMixer(stored: unknown): MixerVolumes {
  const source = stored && typeof stored === 'object' ? (stored as Partial<Record<MixerChannel, unknown>>) : {}
  const mixer = { ...DEFAULT_MIXER_VOLUMES }
  for (const channel of MIXER_CHANNELS) mixer[channel] = clampUnit(source[channel], DEFAULT_MIXER_VOLUMES[channel])
  return mixer
}

function readPersisted(): AppPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PREFERENCES, mixer: { ...DEFAULT_MIXER_VOLUMES } }
    const parsed = JSON.parse(raw) as Partial<AppPreferences> & Record<string, unknown>
    // Spread over the defaults rather than trusting the parsed object whole: a
    // value stored before a preference existed is missing that key entirely.
    // Only known keys are kept, so a retired preference (defaultAudioDeviceId)
    // drops out of storage on the next write.
    return {
      perfOverlayVisible: typeof parsed.perfOverlayVisible === 'boolean' ? parsed.perfOverlayVisible : DEFAULT_PREFERENCES.perfOverlayVisible,
      settingsTabId: typeof parsed.settingsTabId === 'string' ? parsed.settingsTabId : DEFAULT_PREFERENCES.settingsTabId,
      mixer: sanitizeMixer(parsed.mixer),
      language: sanitizeLanguage(parsed.language),
      menuMusicMode: sanitizeMenuMusicMode(parsed.menuMusicMode),
    }
  } catch {
    return { ...DEFAULT_PREFERENCES, mixer: { ...DEFAULT_MIXER_VOLUMES } }
  }
}

function writePersisted(preferences: AppPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Storage full or blocked: the preference still applies for this session.
  }
}

export const useAppPreferencesStore = create<AppPreferencesState>((set, get) => {
  /** Persist and publish one changed preference, leaving the rest exactly as they are. */
  function update(patch: Partial<AppPreferences>): void {
    const { perfOverlayVisible, settingsTabId, mixer, language, menuMusicMode } = get()
    const next: AppPreferences = { perfOverlayVisible, settingsTabId, mixer, language, menuMusicMode, ...patch }
    writePersisted(next)
    set(next)
  }

  return {
    ...readPersisted(),
    setPerfOverlayVisible: (visible) => update({ perfOverlayVisible: visible }),
    setSettingsTabId: (id) => update({ settingsTabId: id }),
    setMixerVolume: (channel, value) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return
      const current = get().mixer
      const clamped = Math.min(1, Math.max(0, value))
      if (current[channel] === clamped) return
      update({ mixer: { ...current, [channel]: clamped } })
    },
    setLanguage: (code) => {
      const next = sanitizeLanguage(code)
      if (get().language === next) return
      update({ language: next })
    },
    setMenuMusicMode: (mode) => {
      if (!MENU_MUSIC_MODES.includes(mode) || get().menuMusicMode === mode) return
      update({ menuMusicMode: mode })
    },
  }
})
