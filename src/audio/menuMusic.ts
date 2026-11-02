// What plays on the `music` bus behind the menus.
//
// App.tsx's audio policy still decides *when* menu music plays (which scenes,
// ducking under gameplay, stopping for a song preview); this module decides
// *what*: by default a rotation of random songs from the user's own library,
// else the bundled loop (menu_music/menu_loop.wav).
//
// A library song is played the way a song preview is -- same file, same
// loudness normalisation (the engine's track resolver, useWebAudioManager.ts),
// same start point (#PREVIEWSTART, else the preview heuristic) -- but on the
// menu bus, so the Menu music slider sets its level. It plays once, not looped:
// at its end, or MENU_SONG_MAX_SEC after its start point, it crossfades into
// another random song.
//
// Song Select hands the song over rather than restarting it: entering it with a
// library song playing preselects that song, and the very source moves from
// the menu bus to the preview bus (handMenuMusicToPreview); leaving it for Home
// moves whatever is previewing back the same way (takeOverPreviewAsMenuMusic),
// which then plays out and is followed by a random song as usual.
//
// The bundled loop is the fallback whenever the library has nothing to offer:
// no songs yet, no bridge (the browser preview), or every pick failing to load.
//
// Nothing here scans or decodes the library. Candidates come from the song
// list the library already holds (or one database read for it), and only the
// one song about to play is ever loaded -- streamed by the engine through a
// media element, so the menus never wait for it.
import { create } from 'zustand'
import type { AudioManager, PlayOptions } from './audioManagerContract'
import { PREVIEW_HANDOVER_MS } from './songPreviewStore'
import { menuSongUrl } from './menuTrack'
import * as libraryApi from '../library/api'
import { useLibraryStore } from '../library/useLibraryStore'
import { toLibraryMediaUrl } from '../library/mediaUrl'
import type { LibrarySearchFilters, LibrarySong } from '../library/types'

/** The longest a library song plays as menu music before the next one takes over, from its start point. */
export const MENU_SONG_MAX_SEC = 90

/** The crossfade from one menu song into the next (or into the bundled loop). */
export const MENU_SONG_CROSSFADE_MS = 3000

/**
 * The fade-in of the first song after silence. A song opens mid-track, at
 * whatever sample its start point lands on, so it is faded in rather than cut
 * in -- a hard start there is an audible click.
 */
export const MENU_SONG_FADE_IN_MS = 1200

/** How many of the most recent menu songs a new pick avoids (fewer on a small library). */
export const MENU_SONG_RECENT_COUNT = 5

/** Picks in a row that may fail to load before the bundled loop takes over. */
export const MENU_SONG_MAX_ATTEMPTS = 3

export interface MenuMusicNowPlaying {
  title: string
  artist: string
}

interface MenuMusicState {
  /** The library song playing behind the menus, or null (silence, or the bundled loop). */
  nowPlaying: MenuMusicNowPlaying | null
  /** What the menu bus is playing right now. */
  source: 'library' | 'builtin' | null
  /**
   * The media URL of the library song playing (the same URL its preview
   * plays), or null. What Song Select matches against to preselect the song.
   */
  track: string | null
}

/** Read by the Home screen's "Now playing" line and by Song Select. Written only by this module. */
export const useMenuMusicStore = create<MenuMusicState>(() => ({ nowPlaying: null, source: null, track: null }))

const SILENT: MenuMusicState = { nowPlaying: null, source: null, track: null }

/** The file a song plays from: the full mix, else the instrumental stem (as its preview does). */
function songAudioPath(song: LibrarySong): string | null {
  return song.mp3Path ?? song.instrumentalPath ?? null
}

/** Whether a library row can play as menu music at all. */
export function isMenuSongCandidate(song: LibrarySong): boolean {
  return song.isPlayable && Boolean(songAudioPath(song))
}

/**
 * A random playable song, avoiding the recently played ones and any that have
 * already failed to load this session.
 *
 * The recent list is a preference, not a rule: on a library too small to
 * avoid them all, a recent song is still better than falling back to the loop
 * -- except the one that just played, whenever anything else is available.
 */
export function pickMenuSong(
  songs: readonly LibrarySong[],
  recent: readonly string[],
  failed: ReadonlySet<string> = new Set(),
  random: () => number = Math.random,
): LibrarySong | null {
  const playable = songs.filter((song) => isMenuSongCandidate(song) && !failed.has(song.path))
  if (playable.length === 0) return null

  const avoidCount = Math.min(MENU_SONG_RECENT_COUNT, Math.floor(playable.length / 2))
  const avoid = new Set(avoidCount > 0 ? recent.slice(-avoidCount) : [])
  const last = recent.at(-1)
  if (last !== undefined && playable.length > 1) avoid.add(last)

  const fresh = playable.filter((song) => !avoid.has(song.path))
  const pool = fresh.length > 0 ? fresh : playable
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length))
  return pool[index]
}

// ---------------------------------------------------------------------------
// Candidates

/** Library filters that narrow the song list; a list read under any of them is not "the library". */
function isNarrowed(filters: LibrarySearchFilters): boolean {
  return Boolean(filters.query?.trim() || filters.language || filters.edition || filters.duetOnly || filters.hasVideoOnly || filters.favoritesOnly)
}

/** Our own read of the whole library, kept until the library store reads it again. */
let ownList: LibrarySong[] | null = null

/**
 * The songs to pick from: the library list the app already holds when it is
 * the whole library, else one database read (cached). Never rejects. An empty
 * answer is not cached, so a library added later is picked up next time.
 */
async function loadCandidates(): Promise<LibrarySong[]> {
  const { searchBase, filters } = useLibraryStore.getState()
  if (searchBase && searchBase.songs.length > 0 && !isNarrowed(filters)) return searchBase.songs
  if (ownList) return ownList
  try {
    const songs = await libraryApi.search({})
    if (Array.isArray(songs) && songs.length > 0) ownList = songs
    return Array.isArray(songs) ? songs : []
  } catch {
    return []
  }
}

// A rescan or any other fresh read means our copy may be stale.
useLibraryStore.subscribe((state, previous) => {
  if (state.searchBase !== previous.searchBase || state.roots !== previous.roots) ownList = null
})

// ---------------------------------------------------------------------------
// Playback

/** Bumped by every start and stop: a callback holding an older value belongs to music that was stopped. */
let session = 0
let advanceTimer: ReturnType<typeof setTimeout> | null = null
/** Song paths played as menu music, oldest first. */
const recent: string[] = []
/** Song paths that failed to load this session; never picked again. */
const failed = new Set<string>()

function clearAdvanceTimer(): void {
  if (advanceTimer !== null) clearTimeout(advanceTimer)
  advanceTimer = null
}

function rememberRecent(path: string): void {
  const existing = recent.indexOf(path)
  if (existing !== -1) recent.splice(existing, 1)
  recent.push(path)
  if (recent.length > MENU_SONG_RECENT_COUNT * 4) recent.splice(0, recent.length - MENU_SONG_RECENT_COUNT * 4)
}

function playBuiltin(audio: AudioManager, crossfade: boolean): void {
  clearAdvanceTimer()
  useMenuMusicStore.setState({ nowPlaying: null, source: 'builtin', track: null })
  if (crossfade) audio.crossfadeTo(menuSongUrl, MENU_SONG_CROSSFADE_MS, 'music')
  else audio.play(menuSongUrl, 'music')
}

/**
 * How long after a song's start the next one should begin crossfading in: at
 * MENU_SONG_MAX_SEC, or at the song's end, less the crossfade -- so the fade
 * is finished by the time the song would stop.
 */
export function menuSongAdvanceDelayMs(durationSec: number, offsetSec: number): number {
  const remaining = Number.isFinite(durationSec) ? Math.max(0, durationSec - offsetSec) : MENU_SONG_MAX_SEC
  const playFor = Math.min(remaining, MENU_SONG_MAX_SEC)
  return Math.max(0, Math.round(playFor * 1000) - MENU_SONG_CROSSFADE_MS)
}

/**
 * Picks and starts one library song. `crossfade` says whether something is
 * already playing on the bus (the previous song) that it should fade over.
 */
async function playLibrarySong(audio: AudioManager, mine: number, attempt: number, crossfade: boolean): Promise<void> {
  const candidates = await loadCandidates()
  if (mine !== session) return

  const song = attempt < MENU_SONG_MAX_ATTEMPTS ? pickMenuSong(candidates, recent, failed) : null
  const path = song ? songAudioPath(song) : null
  if (!song || !path) {
    playBuiltin(audio, crossfade)
    return
  }
  rememberRecent(song.path)
  const track = toLibraryMediaUrl(path)

  const options: PlayOptions = {
    previewStartSec: song.previewStartSec ?? null,
    startAtPreview: true,
    loop: false,
    cache: false,
    onStarted: ({ durationSec, offsetSec }) => {
      if (mine !== session) return
      useMenuMusicStore.setState({ nowPlaying: { title: song.title, artist: song.artist }, source: 'library', track })
      scheduleAdvance(audio, mine, menuSongAdvanceDelayMs(durationSec, offsetSec))
    },
    onError: () => {
      if (mine !== session) return
      failed.add(song.path)
      void playLibrarySong(audio, mine, attempt + 1, crossfade)
    },
  }
  audio.crossfadeTo(track, crossfade ? MENU_SONG_CROSSFADE_MS : MENU_SONG_FADE_IN_MS, 'music', options)
}

/** Crossfade into the next random song after `delayMs`, unless the music has moved on by then. */
function scheduleAdvance(audio: AudioManager, mine: number, delayMs: number): void {
  clearAdvanceTimer()
  advanceTimer = setTimeout(() => {
    advanceTimer = null
    if (mine === session) void playLibrarySong(audio, mine, 0, true)
  }, delayMs)
}

/**
 * Start menu music on the `music` bus from silence: a random library song (or,
 * failing that, the bundled loop) for `library`, the bundled loop for
 * `builtin`. Returns at once; a library song is chosen and loaded in the
 * background.
 */
export function startMenuMusic(audio: AudioManager, mode: 'library' | 'builtin'): void {
  clearAdvanceTimer()
  const mine = ++session
  if (mode === 'builtin') {
    playBuiltin(audio, false)
    return
  }
  useMenuMusicStore.setState(SILENT)
  void playLibrarySong(audio, mine, 0, false)
}

/** Fade the menu music out over `ms` and forget it: no further song will follow. */
export function stopMenuMusic(audio: AudioManager, ms: number): void {
  clearAdvanceTimer()
  session++
  useMenuMusicStore.setState(SILENT)
  audio.stop(ms, 'music')
}

// ---------------------------------------------------------------------------
// Handover to and from the song preview

/**
 * Song Select asked to preview `track`, and it is the library song the menu is
 * playing: hand that very source over to the preview bus instead of stopping
 * it and starting the same song again. The menu rotation is retired as if
 * stopped (nothing follows it), but no sample is lost -- the song carries on
 * as the preview, at the same position, at the preview bus's level.
 *
 * `onEnded` is the preview's end-of-track callback. The source is a menu song,
 * which never loops, so it plays to the end of the song like a Song Select
 * preview should.
 *
 * Returns false when the menu is not playing `track` (or the engine cannot
 * hand over), leaving everything untouched for the ordinary stop/play.
 */
export function handMenuMusicToPreview(audio: AudioManager, track: string, onEnded?: () => void): boolean {
  const state = useMenuMusicStore.getState()
  if (state.source !== 'library' || state.track !== track || !audio.transfer) return false
  const moved = audio.transfer('music', 'preview', PREVIEW_HANDOVER_MS, { track, loop: false, onEnded })
  if (!moved) return false
  clearAdvanceTimer()
  session++
  useMenuMusicStore.setState(SILENT)
  return true
}

/** The library song whose audio is `track`, from the lists already in memory. */
function findSongByTrack(track: string): LibrarySong | null {
  const { results, searchBase } = useLibraryStore.getState()
  for (const list of [results, searchBase?.songs, ownList]) {
    const found = list?.find((song) => {
      const path = songAudioPath(song)
      return path !== null && toLibraryMediaUrl(path) === track
    })
    if (found) return found
  }
  return null
}

/**
 * Leaving Song Select for the menus with `track` previewing: take that very
 * source over as the menu music -- no restart, no crossfade -- show it as now
 * playing, and let it play to the end of the song (no loop), from where the
 * rotation carries on with a random song as usual.
 *
 * Returns false (nothing changed) when the preview is not a library song or
 * is no longer playing -- it may have played out already -- so the caller
 * starts the menu music the ordinary way.
 */
export function takeOverPreviewAsMenuMusic(audio: AudioManager, track: string): boolean {
  if (!audio.transfer) return false
  const song = findSongByTrack(track)
  if (!song || !isMenuSongCandidate(song)) return false
  const moved = audio.transfer('preview', 'music', PREVIEW_HANDOVER_MS, { track, loop: false })
  if (!moved) return false

  clearAdvanceTimer()
  const mine = ++session
  rememberRecent(song.path)
  useMenuMusicStore.setState({ nowPlaying: { title: song.title, artist: song.artist }, source: 'library', track })
  // To the end of the song: it has been chosen and listened to, so it is not
  // cut off at the rotation's per-song cap.
  const remainingSec = Number.isFinite(moved.durationSec)
    ? Math.max(0, moved.durationSec - moved.positionSec)
    : MENU_SONG_MAX_SEC
  scheduleAdvance(audio, mine, Math.max(0, Math.round(remainingSec * 1000) - MENU_SONG_CROSSFADE_MS))
  return true
}

/** Test seam: forget the rotation, the cached list and any pending crossfade. */
export function resetMenuMusicForTests(): void {
  clearAdvanceTimer()
  session++
  recent.length = 0
  failed.clear()
  ownList = null
  useMenuMusicStore.setState(SILENT)
}
