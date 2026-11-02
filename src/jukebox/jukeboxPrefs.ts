// The jukebox's player settings -- Shuffle, Repeat and "Autoplay random songs" --
// remembered between nights in localStorage. Every read and write survives a
// missing or broken store: the jukebox then simply starts on the defaults.
import { REPEAT_ORDER, type JukeboxRepeat } from './queueLogic'

export interface JukeboxPrefs {
  shuffle: boolean
  repeat: JukeboxRepeat
  /** Keep playing random songs when the queue runs out. On by default. */
  autoplay: boolean
}

export const DEFAULT_JUKEBOX_PREFS: JukeboxPrefs = { shuffle: false, repeat: 'off', autoplay: true }

const STORAGE_KEY = 'aetherstar.jukebox.prefs'

export function loadJukeboxPrefs(): JukeboxPrefs {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_JUKEBOX_PREFS }
    const parsed = JSON.parse(raw) as Partial<Record<keyof JukeboxPrefs, unknown>>
    return {
      shuffle: typeof parsed.shuffle === 'boolean' ? parsed.shuffle : DEFAULT_JUKEBOX_PREFS.shuffle,
      repeat: REPEAT_ORDER.includes(parsed.repeat as JukeboxRepeat)
        ? (parsed.repeat as JukeboxRepeat)
        : DEFAULT_JUKEBOX_PREFS.repeat,
      autoplay: typeof parsed.autoplay === 'boolean' ? parsed.autoplay : DEFAULT_JUKEBOX_PREFS.autoplay,
    }
  } catch {
    return { ...DEFAULT_JUKEBOX_PREFS }
  }
}

export function saveJukeboxPrefs(prefs: JukeboxPrefs): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Private mode, a full disk: the setting just lasts for this night.
  }
}
