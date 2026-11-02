import type { LibraryRoot, LibrarySearchFilters, LibrarySong, ScanErrorEntry, ScanProgress } from '../library/types'
import type { CreatePlayerInput, PlayerProfile, UpdatePlayerInput } from '../players/types'
import type {
  AudioDevice,
  DeviceListChangedPayload,
  MicMonitorSettings,
  MicPermissionStatus,
  PitchBatchPayload,
  RawScopeChunkPayload,
} from '../audio/types'
import type { AudienceDisplaysPayload, AudienceState } from '../audience/types'
import type { LeaderboardEntry, SongHighscoreQuery } from '../session/types'
import type { ConfiguredMicSlot, MicSlot } from '../multiplayer/types'
import type { CalibrationSettings } from '../calibration/types'
import type { WindowDisplayMode } from '../settings/types'
import type { LanguageInfo } from '../i18n/types'

export interface ElectronApi {
  getAppInfo: () => Promise<{
    name: string
    version: string
    electron: string
    chrome: string
    node: string
    platform: string
    arch: string
  }>
  /** Synchronous -- reads the window's own URL, not an IPC round trip (so the role is known before the first render). */
  getWindowRole: () => 'main' | 'audience'
  openFile: (options?: { directory?: boolean }) => Promise<string | null>
  minimize: () => Promise<void>
  /** Quits the whole app (main menu Exit button). */
  quit?: () => void
  toggleMaximize: () => Promise<boolean>
  /**
   * Persisted full-screen/windowed state for the main window (Settings >
   * Graphics > "Windowed mode").
   *
   * Optional because every call site guards it anyway: this namespace is newer
   * than the preload surfaces some test fixtures stub out, and a Settings pane
   * that throws rather than showing a disabled switch would be a worse answer
   * than one that waits.
   */
  window?: {
    getDisplayMode: () => Promise<WindowDisplayMode>
    setWindowed: (windowed: boolean) => Promise<WindowDisplayMode>
    onDisplayModeChanged: (callback: (mode: WindowDisplayMode) => void) => () => void
  }
  ping: (payload: unknown) => void
  onPong: (callback: (data: { received: unknown; at: number }) => void) => () => void
  library: {
    addRoot: (rootPath: string) => Promise<void>
    removeRoot: (rootPath: string) => Promise<void>
    listRoots: () => Promise<LibraryRoot[]>
    rescan: (rootPath: string) => Promise<void>
    search: (filters: LibrarySearchFilters) => Promise<LibrarySong[]>
    getSong: (songPath: string) => Promise<LibrarySong | null>
    listScanErrors: () => Promise<ScanErrorEntry[]>
    onScanProgress: (callback: (progress: ScanProgress) => void) => () => void
    /**
     * A song is (true) or is no longer (false) being sung: the main process
     * pauses library scans, loudness analysis, thumbnail backfill and audio
     * device polling while it is. Fire-and-forget. Optional because preload
     * stubs in tests predate it -- call it as `setGameplayActive?.(...)`.
     */
    setGameplayActive?: (active: boolean) => void
    /**
     * Persist a loudness measurement the renderer made itself
     * (src/audio/songGain.ts) into the library index. Only fills a song that
     * has no measurement yet; invalid numbers are ignored. Resolves true when
     * stored. Optional because preload stubs in tests predate it.
     */
    setLoudness?: (songPath: string, measurement: { integratedLufs: number; truePeakDbtp: number }) => Promise<boolean>
    /** Starred song folder paths. Optional because preload stubs in tests predate it. */
    listFavorites?: () => Promise<string[]>
    setFavorite?: (songPath: string, favorite: boolean) => Promise<boolean>
    /** Count one play of a song (sung or jukebox) for the "Recently sung"/"Most sung" sorts. */
    recordPlay?: (songPath: string, mode: string | null) => Promise<boolean>
  }
  stage: {
    getFixtureChartPath: () => Promise<string>
  }
  players: {
    list: () => Promise<PlayerProfile[]>
    create: (input: CreatePlayerInput) => Promise<PlayerProfile>
    update: (input: UpdatePlayerInput) => Promise<PlayerProfile>
    delete: (id: string) => Promise<void>
    reorder: (orderedIds: string[]) => Promise<void>
    readImportedPhoto: (path: string) => Promise<string>
  }
  audio: {
    listDevices: () => Promise<AudioDevice[]>
    requestPermission: () => Promise<MicPermissionStatus>
    getPermissionStatus: () => Promise<MicPermissionStatus>
    startCapture: (deviceId: string) => Promise<void>
    stopCapture: (deviceId: string) => Promise<void>
    startRawScope: (deviceId: string) => Promise<void>
    stopRawScope: (deviceId: string) => Promise<void>
    /**
     * Live microphone monitoring -- Settings > Audio & Mics > "Karaoke effect".
     *
     * Optional for the same reason `window` above is: this namespace is newer
     * than the preload surfaces some test fixtures stub out, and every call
     * site goes through src/audio/api.ts, which already falls back to the
     * shared default rather than throwing.
     */
    getMicMonitor?: () => Promise<MicMonitorSettings>
    /** Resolves with the setting that was actually stored, which may be clamped. */
    setMicMonitor?: (settings: MicMonitorSettings) => Promise<MicMonitorSettings>
    onPitchBatch: (callback: (payload: PitchBatchPayload) => void) => () => void
    onDeviceListChanged: (callback: (payload: DeviceListChangedPayload) => void) => () => void
    onRawScopeChunk: (callback: (payload: RawScopeChunkPayload) => void) => () => void
  }
  audience: {
    /** A superset of ScoreState: the whole screen the audience window mirrors (src/audience/types.ts). */
    reportScoreState: (state: AudienceState) => void
    listDisplays: () => Promise<AudienceDisplaysPayload>
    setDisplay: (displayId: number) => Promise<void>
    setEnabled: (enabled: boolean) => Promise<void>
    onScoreState: (callback: (state: AudienceState) => void) => () => void
    /**
     * Whether an audience window is open: fires with the current state shortly
     * after subscribing, then on every open/close. Returns the unsubscribe.
     * Optional because preload stubs in tests predate it.
     */
    onWindowPresence?: (callback: (open: boolean) => void) => () => void
  }
  fx: {
    getAssetsDir: () => Promise<string>
  }
  session: {
    /** Null when the session database could not be opened (the night still runs, unrecorded). */
    start: () => Promise<{ id: string; startedAt: number } | null>
    recordEntry: (entry: {
      sessionId: string
      songPath: string
      playerId: string
      score: number
      epicCount: number
      goodCount: number
      awfulCount: number
      difficulty?: 'easy' | 'normal' | 'hard'
    }) => Promise<void>
    listLeaderboard: () => Promise<LeaderboardEntry[]>
    /** Optional: a preload from before per-song highscores has no such method. */
    listSongHighscores?: (query: SongHighscoreQuery) => Promise<LeaderboardEntry[]>
  }
  multiplayer: {
    /** Only the configured slots; unconfigured mics have no stored row. */
    listMicSlots: () => Promise<MicSlot[]>
    saveMicSlot: (slot: ConfiguredMicSlot) => Promise<void>
    clearMicSlot: (slotNumber: number) => Promise<void>
    getCpuUsage: () => Promise<{ percent: number }>
  }
  calibration: {
    get: () => Promise<CalibrationSettings>
    set: (settings: CalibrationSettings) => Promise<CalibrationSettings>
  }
  /**
   * Language packs (src/i18n): one plain .txt file per language, from the
   * bundled languages/ folder and the user's own <userData>/languages folder
   * (which overrides/adds languages). Only language codes cross this boundary.
   *
   * Optional because preload stubs in tests predate it; src/i18n falls back to
   * the language files compiled into the renderer when it is absent.
   */
  i18n?: {
    /** Every installed language. Re-reads both folders on each call. */
    listLanguages: () => Promise<LanguageInfo[]>
    /**
     * One language's texts (key -> text, plural forms as `key.one`/`key.other`),
     * with its own `@fallback`/base-language chain merged in -- English is not.
     * An unknown code resolves `{}`; a malformed code rejects.
     */
    loadLanguage: (code: string) => Promise<Record<string, string>>
    /** Open <userData>/languages in the OS file manager (created if needed). Resolves '' or the OS's error message. */
    openLanguagesFolder: () => Promise<string>
    /** A language file was added, changed or removed. @returns unsubscribe */
    onLanguagesChanged?: (callback: () => void) => () => void
    /** Fire-and-forget: the language now on screen, so the main process's native dialogs match it. */
    setActiveLanguage?: (code: string) => void
  }
}

declare global {
  interface Window {
    api?: ElectronApi
  }
}
