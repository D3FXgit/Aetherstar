// Renderer-side library types, kept separate from electron/library's JSDoc
// typedefs because src/ cannot type-import from electron/.

export interface LibrarySong {
  path: string
  artist: string
  title: string
  language?: string
  edition?: string
  durationMs: number
  thumbnailPath: string | null
  mp3Path: string | null
  /**
   * Separated a-cappella / backing tracks (#VOCALS / #INSTRUMENTAL), when the
   * song ships them. Optional and additive: every existing consumer of this
   * type predates stems and must keep compiling untouched.
   */
  vocalsPath?: string | null
  instrumentalPath?: string | null
  videoPath: string | null
  bpm: number
  gap: number
  hasVideo: boolean
  /** True only when both stems resolved -- the pair playback can duck the guide vocal with. */
  hasStems?: boolean
  hasCover: boolean
  isDuet: boolean
  isPlayable: boolean
  addedAt: number
  /**
   * EBU R 128 integrated loudness of this song's audio, measured by the scan
   * worker's loudness pass, or null when it has never been analysed.
   *
   * Null is load-bearing: it means "leave this song's level exactly as it is",
   * which is what keeps an un-rescanned library playing unchanged. See
   * src/audio/loudness.ts.
   */
  loudnessLufs?: number | null
  /** True peak in dBTP from the same measurement. Only ever used to keep a boost from clipping. */
  truePeakDbtp?: number | null
  /**
   * The chart's #PREVIEWSTART in seconds -- where the song-select preview
   * should start -- or null/absent when the chart has none (the preview then
   * picks its own start). Libraries indexed before this existed get it filled
   * on their next rescan.
   */
  previewStartSec?: number | null
}

export interface LibraryRoot {
  path: string
  addedAt: number
}

export interface ScanProgress {
  rootPath: string
  /**
   * Which pass this progress belongs to. Absent for the metadata pass (which
   * is every scan there has ever been), `'loudness'` for the EBU R 128 backfill
   * that runs behind it once the library is already browsable.
   */
  phase?: 'loudness'
  songsFound: number
  songsParsed: number
  currentPath: string | null
  done: boolean
  errorCount: number
}

export interface ScanErrorEntry {
  path: string
  reason: string
  timestamp: number
}

export type LibrarySortOrder = 'artist' | 'title' | 'recent' | 'recentlySung' | 'mostSung'

export interface LibrarySearchFilters {
  query?: string
  language?: string
  edition?: string
  duetOnly?: boolean
  hasVideoOnly?: boolean
  /** Only songs the user has starred. */
  favoritesOnly?: boolean
  sort?: LibrarySortOrder
}
