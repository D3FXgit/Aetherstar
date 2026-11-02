// Resolves a song's loudness measurement for whatever plays it, keyed by the
// song folder: memory cache, then the library index (ffmpeg scan), then a
// renderer measurement kept in localStorage. Until one exists, playback uses
// loudness.ts's default and the song is measured in the background.
import { getSong, whenGameplayIdle } from '../library/api'
import type { LibrarySong } from '../library/types'
import { toLibraryMediaUrl } from '../library/mediaUrl'
import { computeLoudnessGain, hasLoudnessMeasurement, MAX_ELEMENT_GAIN, type SongLoudness } from './loudness'
import { measureAudioBufferLoudness, type LoudnessMeasurement, type MeasurableBuffer } from './loudnessMeter'
import { getSharedAudioContext } from './webAudioApi'

/** What playback needs to know about one song. */
export interface SongAudioInfo {
  loudnessLufs: number | null
  truePeakDbtp: number | null
  /** #PREVIEWSTART, in seconds, when the library row carries it. */
  previewStartSec: number | null
  /** The file the loudness should be measured from: the full mix, else the instrumental. */
  audioPath: string | null
  /** The index's own key for this song, when the index knows it -- used to persist a renderer measurement. */
  indexPath: string | null
}

/** Nothing known: the conservative default gain (see loudness.ts). */
export const UNKNOWN_LOUDNESS: SongLoudness = { loudnessLufs: null, truePeakDbtp: null }

const UNKNOWN_INFO: SongAudioInfo = { loudnessLufs: null, truePeakDbtp: null, previewStartSec: null, audioPath: null, indexPath: null }

// ---------------------------------------------------------------------------
// URL and key handling

const MEDIA_URL = /^(?:aetherstar-media|app-media):\/\/([^/\\]*)(.*)$/i
const KNOWN_HOSTS = /^(roots|media|exact)(.+)$/i
const URL_DRIVE_PREFIX = /^[/\\][A-Za-z]:[/\\]/
const DRIVE_PATH = /^[A-Za-z]:[/\\]/
const BARE_DRIVE = /^[A-Za-z]:$/

function decodePath(raw: string): string {
  try {
    // decodeURIComponent, not decodeURI: decodeURI leaves reserved escapes
    // such as %23 (#) and %3F (?) encoded, and both are legal in folder names.
    return decodeURIComponent(raw)
  } catch {
    try {
      return decodeURI(raw)
    } catch {
      return raw
    }
  }
}

/**
 * The song folder a media URL belongs to.
 *
 * Library media reaches the renderer only through the privileged schemes, so
 * anything else -- the bundled menu track, a fingerprinted Vite asset, a blob:
 * -- returns null and costs no lookup. Handles every shape in circulation:
 *
 *   aetherstar-media://roots/Users/me/Songs/A - B/x.mp3       (macOS)
 *   aetherstar-media://roots/D:/Songs/a%23b/x.mp3             (encoded, Windows)
 *   aetherstar-media://rootsD:\Songs\A - B\x.mp3              (legacy: no slash after the host)
 *   app-media://media/D:/Songs/A - B/x.mp3                    (stage media)
 *
 * A Windows path comes back without the URL's leading slash (`D:/Songs/a#b`).
 */
export function songFolderForMedia(url: string | null | undefined): string | null {
  if (!url) return null
  const match = url.match(MEDIA_URL)
  if (!match) return null

  let rest = match[2]
  // Legacy shape: the absolute path was glued straight onto the host, so a
  // drive letter ended up inside it ("rootsD:"). Peel the known host off.
  const glued = match[1].match(KNOWN_HOSTS)
  if (glued) rest = glued[2] + rest
  if (!rest) return null

  let filePath = decodePath(rest)
  // "/D:/Songs/x": that slash belongs to the URL, not to the path.
  if (URL_DRIVE_PREFIX.test(filePath)) filePath = filePath.slice(1)

  const separator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  if (separator <= 0) return null
  const folder = filePath.slice(0, separator)
  if (BARE_DRIVE.test(folder)) return null
  return folder
}

function isWindowsPath(folder: string): boolean {
  return DRIVE_PATH.test(folder) || folder.startsWith('\\\\')
}

/** The cache key: one spelling per folder, whichever separators and drive-letter case it arrived with. */
export function songFolderKey(folder: string): string {
  const forward = folder.replace(/\\/g, '/').replace(/\/+$/, '')
  return isWindowsPath(folder) ? forward.toLowerCase() : forward
}

/**
 * Spellings to ask the index for, most likely first. The index is keyed by
 * whatever `path.join` produced in the scan worker -- backslashes on Windows --
 * while a folder recovered from a URL has forward slashes.
 */
export function songFolderLookupCandidates(folder: string): string[] {
  const candidates = [folder]
  if (isWindowsPath(folder)) candidates.push(folder.replace(/\//g, '\\'), folder.replace(/\\/g, '/'))
  return [...new Set(candidates)]
}

// ---------------------------------------------------------------------------
// Renderer measurements, persisted

const MEASUREMENTS_KEY = 'aetherstar:loudness-measurements'
const MAX_STORED_MEASUREMENTS = 20_000

type StoredMeasurements = Record<string, { i: number; p: number }>

let stored: StoredMeasurements | null = null

function readStored(): StoredMeasurements {
  if (stored) return stored
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(MEASUREMENTS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    stored = parsed && typeof parsed === 'object' ? (parsed as StoredMeasurements) : {}
  } catch {
    stored = {}
  }
  return stored
}

function storedMeasurement(key: string): SongLoudness | null {
  const entry = readStored()[key]
  if (!entry || !Number.isFinite(entry.i) || !Number.isFinite(entry.p)) return null
  return { loudnessLufs: entry.i, truePeakDbtp: entry.p }
}

function writeStored(key: string, measurement: LoudnessMeasurement): void {
  const all = readStored()
  all[key] = { i: Math.round(measurement.integratedLufs * 100) / 100, p: Math.round(measurement.truePeakDbtp * 100) / 100 }
  const keys = Object.keys(all)
  if (keys.length > MAX_STORED_MEASUREMENTS) delete all[keys[0]]
  try {
    localStorage.setItem(MEASUREMENTS_KEY, JSON.stringify(all))
  } catch {
    // Full or blocked storage: the measurement still holds for this session.
  }
}

type PersistLoudness = (songPath: string, measurement: LoudnessMeasurement) => unknown

/**
 * The IPC that writes a renderer measurement into the library index, when the
 * main process exposes one (`window.api.library.setLoudness`). Optional: until
 * it exists, localStorage is the persistence.
 */
function persistToIndex(): PersistLoudness | null {
  const holder = globalThis as { window?: { api?: { library?: { setLoudness?: PersistLoudness } } } }
  return holder.window?.api?.library?.setLoudness ?? null
}

// ---------------------------------------------------------------------------
// Cache and lookups

/** Index lookups, keyed by songFolderKey. */
const infoCache = new Map<string, SongAudioInfo>()
/** In-flight index lookups. */
const pending = new Map<string, Promise<SongAudioInfo>>()
/** In-flight renderer measurements. */
const measuring = new Map<string, Promise<SongLoudness | null>>()
/** Folder key to the listeners told when a new measurement lands. */
const listeners = new Map<string, Set<(loudness: SongLoudness) => void>>()

function pickLoudness(info: SongAudioInfo | null, key: string): SongLoudness | null {
  if (info && hasLoudnessMeasurement(info)) return { loudnessLufs: info.loudnessLufs, truePeakDbtp: info.truePeakDbtp }
  return storedMeasurement(key)
}

function toInfo(song: LibrarySong | null): SongAudioInfo {
  if (!song) return UNKNOWN_INFO
  const previewStart = (song as LibrarySong & { previewStartSec?: unknown }).previewStartSec
  return {
    loudnessLufs: song.loudnessLufs ?? null,
    truePeakDbtp: song.truePeakDbtp ?? null,
    previewStartSec: typeof previewStart === 'number' && Number.isFinite(previewStart) && previewStart >= 0 ? previewStart : null,
    audioPath: song.mp3Path ?? song.instrumentalPath ?? null,
    indexPath: song.path ?? null,
  }
}

async function lookupIndex(folder: string): Promise<LibrarySong | null> {
  for (const candidate of songFolderLookupCandidates(folder)) {
    const song = await getSong(candidate)
    if (song) return song
  }
  return null
}

/** Everything the index knows about a song folder. Never rejects. */
export async function loadSongInfo(songFolder: string | null | undefined): Promise<SongAudioInfo> {
  if (!songFolder) return UNKNOWN_INFO
  const key = songFolderKey(songFolder)

  const cached = infoCache.get(key)
  if (cached) return cached

  const inFlight = pending.get(key)
  if (inFlight) return inFlight

  const lookup = lookupIndex(songFolder)
    .then((song) => {
      const info = toInfo(song)
      // A song the index does not know is not cached: it may be scanned later
      // this session, and an unknown answer is cheap to ask again. A failed
      // lookup lands in the catch below and is not cached either.
      if (song) infoCache.set(key, info)
      return info
    })
    .catch(() => UNKNOWN_INFO)
    .finally(() => {
      pending.delete(key)
    })

  pending.set(key, lookup)
  return lookup
}

/**
 * The measurement for a song folder, if one is known without waiting.
 *
 * Lets a component that is about to start playback open at the right level
 * instead of correcting itself audibly: on any remount within a session, and on
 * any song measured in an earlier session, the answer is already here.
 */
export function peekSongLoudness(songFolder: string | null | undefined): SongLoudness | null {
  if (!songFolder) return null
  const key = songFolderKey(songFolder)
  return pickLoudness(infoCache.get(key) ?? null, key)
}

/** The measurement for a song folder, or the unknown default. Never rejects. */
export async function loadSongLoudness(songFolder: string | null | undefined): Promise<SongLoudness> {
  if (!songFolder) return UNKNOWN_LOUDNESS
  const info = await loadSongInfo(songFolder)
  return pickLoudness(info, songFolderKey(songFolder)) ?? UNKNOWN_LOUDNESS
}

/** Called with each new measurement for this folder. Returns the unsubscribe. */
export function subscribeSongLoudness(songFolder: string, listener: (loudness: SongLoudness) => void): () => void {
  const key = songFolderKey(songFolder)
  const set = listeners.get(key) ?? new Set<(loudness: SongLoudness) => void>()
  listeners.set(key, set)
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0 && listeners.get(key) === set) listeners.delete(key)
  }
}

/** Stores a renderer measurement everywhere it belongs and tells anyone listening. */
export function rememberSongMeasurement(songFolder: string, measurement: LoudnessMeasurement): SongLoudness {
  const key = songFolderKey(songFolder)
  writeStored(key, measurement)
  const loudness: SongLoudness = { loudnessLufs: measurement.integratedLufs, truePeakDbtp: measurement.truePeakDbtp }

  const info = infoCache.get(key)
  if (info && !hasLoudnessMeasurement(info)) {
    infoCache.set(key, { ...info, loudnessLufs: measurement.integratedLufs, truePeakDbtp: measurement.truePeakDbtp })
  }

  const persist = persistToIndex()
  if (persist) {
    try {
      void Promise.resolve(persist(info?.indexPath ?? songFolder, measurement)).catch(() => {})
    } catch {
      // A failed write leaves localStorage as the record.
    }
  }

  listeners.get(key)?.forEach((listener) => listener(loudness))
  return loudness
}

/**
 * Measures a buffer the caller already decoded (the preview bus does), unless
 * the song is already measured. Resolves to the measurement now in force.
 */
export function measureSongFromBuffer(songFolder: string, buffer: MeasurableBuffer): Promise<SongLoudness | null> {
  const key = songFolderKey(songFolder)
  const known = peekSongLoudness(songFolder)
  if (known) return Promise.resolve(known)
  const inFlight = measuring.get(key)
  if (inFlight) return inFlight

  const run = measureAudioBufferLoudness(buffer)
    .then((measurement) => (measurement ? rememberSongMeasurement(songFolder, measurement) : null))
    .catch(() => null)
    .finally(() => {
      measuring.delete(key)
    })
  measuring.set(key, run)
  return run
}

export interface AnalyseOptions {
  /** A media URL for the song's audio. Defaults to the index's mix (else instrumental) path. */
  mediaUrl?: string | null
  /**
   * Resolves when heavy work is fine. Defaults to `whenGameplayIdle`
   * (src/library/api.ts): no fetch + decode of a whole song while one is sung.
   */
  whenIdle?: () => Promise<void>
  fetchBytes?: (url: string) => Promise<ArrayBuffer>
  decode?: (data: ArrayBuffer) => Promise<MeasurableBuffer>
}

async function defaultFetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (response.ok === false) throw new Error(`fetch failed: ${response.status}`)
  return response.arrayBuffer()
}

function defaultDecode(data: ArrayBuffer): Promise<MeasurableBuffer> {
  return getSharedAudioContext().decodeAudioData(data)
}

/**
 * Never rejects. A test double of '../library/api' without this export (a
 * vi.mock factory throws on access to a missing one) counts as idle.
 */
async function defaultWhenIdle(): Promise<void> {
  try {
    await whenGameplayIdle()
  } catch {
    // No gameplay signal available: nothing to wait for.
  }
}

/**
 * Fetches, decodes and measures a song that has no measurement yet. For the
 * stage, which plays through an `<audio>` element and so never holds decoded
 * samples of its own. Never rejects; resolves null when nothing could be
 * measured.
 *
 * Deferred while a song is being sung: the stage asks for this at mount, which
 * is exactly when gameplay starts, and fetching + decoding a whole song (tens
 * of MB of PCM, on the renderer) would then compete with the lyrics, notes and
 * pitch display. The work waits for gameplay to end -- checked again before
 * the decode, in case the next song started meanwhile -- and the result is
 * remembered for the next play. The song in progress keeps whatever level it
 * opened at (the conservative unmeasured default). Measuring from a preview's
 * already-decoded buffer (measureSongFromBuffer) is unaffected.
 */
export async function analyseSongLoudness(
  songFolder: string | null | undefined,
  options: AnalyseOptions = {},
): Promise<SongLoudness | null> {
  if (!songFolder) return null
  const known = await loadSongLoudness(songFolder)
  if (hasLoudnessMeasurement(known)) return known

  const key = songFolderKey(songFolder)
  const inFlight = measuring.get(key)
  if (inFlight) return inFlight

  const { fetchBytes = defaultFetchBytes, decode = defaultDecode, whenIdle = defaultWhenIdle } = options
  const run = (async () => {
    await whenIdle()
    // Measured while waiting (a preview, the scan's index)? Nothing to do.
    const settled = peekSongLoudness(songFolder)
    if (settled) return settled
    const info = await loadSongInfo(songFolder)
    const url = options.mediaUrl ?? (info.audioPath ? toLibraryMediaUrl(info.audioPath) : null)
    if (!url) return null
    const bytes = await fetchBytes(url)
    await whenIdle()
    const buffer = await decode(bytes)
    const measurement = await measureAudioBufferLoudness(buffer)
    return measurement ? rememberSongMeasurement(songFolder, measurement) : null
  })()
    .catch(() => null)
    .finally(() => {
      measuring.delete(key)
    })
  measuring.set(key, run)
  return run
}

/**
 * The linear normalisation gain for the file at `mediaUrl`. Anything that is
 * not library media -- the menu track, a bundled asset -- comes back as 1.
 */
export async function resolveSongGain(mediaUrl: string, maxGain: number = MAX_ELEMENT_GAIN): Promise<number> {
  const folder = songFolderForMedia(mediaUrl)
  if (!folder) return 1
  const loudness = await loadSongLoudness(folder)
  return computeLoudnessGain({ ...loudness, maxGain })
}

/** Test seam: forget every cached lookup and measurement. */
export function clearSongGainCache(): void {
  infoCache.clear()
  pending.clear()
  measuring.clear()
  listeners.clear()
  stored = null
}