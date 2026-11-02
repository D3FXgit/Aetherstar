/**
 * Whether the main window is running in a window rather than full screen, and
 * the platform whose escape hatch the Settings copy has to name.
 *
 * The platform travels with the value because the *way out* of full screen is
 * platform-specific and has to be said on screen: macOS has the green button
 * and Control-Command-F; Windows has only this toggle. Read from
 * `process.platform` in the main process rather than sniffed from the user
 * agent, so it is the real one.
 */
export interface WindowDisplayMode {
  windowed: boolean
  platform: string
}

/** The volume mixer's channels. See src/audio/mixer.ts for what each one feeds. */
export type MixerChannel = 'master' | 'music' | 'guideVocals' | 'effects' | 'menuMusic'

/** Slider positions, 0..1 each. Not gains: src/audio/mixer.ts maps a position to a gain. */
export type MixerVolumes = Record<MixerChannel, number>

/**
 * What plays behind the menus: random songs from the user's library (the
 * default), the bundled loop (menu_music/menu_loop.wav), or nothing.
 * src/audio/menuMusic.ts plays it; App.tsx decides when.
 */
export type MenuMusicMode = 'library' | 'builtin' | 'off'

export interface AppPreferences {
  /**
   * Developer frame-time overlay. A diagnostic, not a preference, so Settings
   * has no switch for it; App.tsx reads it and the Dev Lab sets it.
   */
  perfOverlayVisible: boolean
  /**
   * The Settings pane last looked at.
   *
   * People adjust related settings more than once, so reopening on the pane they
   * were last using saves them re-finding it.
   */
  settingsTabId: string | null
  /** The volume mixer (Settings > Audio). Applied live; loudness normalisation sits underneath it. */
  mixer: MixerVolumes
  /**
   * The language picked in Settings > Graphics > Language, as a language code
   * (`de`, `pt-BR`), or null for "Automatic" -- follow the system language.
   * src/i18n applies it; a code whose file has since disappeared falls back to
   * the system language rather than leaving the app untranslatable.
   */
  language: string | null
  /** Settings > Audio & Mics > Menu music. See MenuMusicMode. */
  menuMusicMode: MenuMusicMode
}
