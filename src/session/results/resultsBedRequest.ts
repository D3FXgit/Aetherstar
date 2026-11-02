// Which song the results bed (src/audio/resultsBed.ts) plays: the one the
// session just sang -- `selectedSong`, which the session keeps through the
// results and leaderboard phases and clears on "New song" / leaving the night.
import type { LibrarySong } from '../../library/types'
import { toLibraryMediaUrl } from '../../library/mediaUrl'
import { previewAudioPath } from '../previewAudioPath'

export interface ResultsBedRequest {
  /** The media URL of the song's audio: the full mix, else the instrumental (as its preview). */
  track: string
  /** The chart's #PREVIEWSTART, when the library row carries it; null lets the engine choose. */
  previewStartSec: number | null
}

/** The results bed for `song`, or null when there is no song or nothing of it to play. */
export function resultsBedRequestFor(song: LibrarySong | null | undefined): ResultsBedRequest | null {
  const path = previewAudioPath(song ?? null)
  if (!path) return null
  const start = song?.previewStartSec
  return {
    track: toLibraryMediaUrl(path),
    previewStartSec: typeof start === 'number' && Number.isFinite(start) && start >= 0 ? start : null,
  }
}
