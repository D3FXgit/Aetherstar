// Who owns the song preview.
//
// The preview used to be owned by the Song Selector's mount lifecycle: an
// effect started it, the cleanup stopped it. That made "keep the chosen song
// playing through Player Selection" inexpressible -- the screen unmounts on
// the way there, so the preview necessarily died with it.
//
// So ownership moves out of the screen and into the *session*. This store
// holds one thing: which track the session currently wants audible on the
// `preview` bus. The Song Selector only ever *requests* (it is the thing that
// knows what the user is browsing); App.tsx -- still the single audio policy
// site -- is the only place that calls play/stop, keyed on this value plus the
// current scene. Navigating from `session-select` to `session-assign` changes
// neither, so nothing is torn down and nothing is started: the same source
// keeps playing, at the same position, with no second one layered over it.
import { create } from 'zustand'
import { SONG_SELECTED_PEAK_OFFSET_MS } from './sfxAssets'

/**
 * The everyday preview fade: swapping between two songs while browsing, and
 * leaving the selector for anywhere that isn't the launch path.
 */
export const PREVIEW_BROWSE_FADE_MS = 300

/**
 * How long the preview takes to reach silence when the session commits to a
 * song and the start transition begins.
 *
 * That transition opens with `assets/sfx/song_selected.wav`, which reaches
 * full level 300 ms after its first sample (`SONG_SELECTED_PEAK_OFFSET_MS`,
 * measured from the file -- see its comment for the envelope). The preview
 * therefore has to be *at* zero inside that window, not merely fading, so the
 * fade is 250 ms: it lands ~50 ms clear of the peak, while still being long
 * enough to read as a fade rather than the hard cut a 0 ms stop would give.
 */
export const PREVIEW_LAUNCH_FADE_MS = SONG_SELECTED_PEAK_OFFSET_MS - 50

/**
 * How long the menu music takes to go away when a song preview takes over.
 *
 * The requirement is "stops immediately", and this is a `stop` -- the source is
 * torn down, not held at zero gain the way `duckTo` leaves it. The 180 ms is
 * only there because a 0 ms stop is an audible click at whatever sample value
 * the track happened to be on; at this length nobody hears a fade, they hear
 * the music end.
 */
export const MENU_MUSIC_STOP_MS = 180

/**
 * The crossfade from one song preview into the next while browsing: picking
 * another song, or the selector moving on by itself when a preview has played
 * to its end. Equal-power (two different songs), and just long enough to read
 * as a quick blend rather than a hard cut: picking a song has to feel instant,
 * and the song picked starts within ~150 ms (it is streamed, not decoded first
 * -- see webAudioManager.ts), so a long fade on top of that would be the
 * slowest part of the switch.
 */
export const PREVIEW_CROSSFADE_MS = 220

/**
 * How long the level glides when the very same song changes hands between the
 * menu music and the preview (Home <-> Song Select). Nothing restarts and
 * nothing is crossfaded -- the source is handed over -- so this is only the
 * glide between the Menu music and Music slider levels when they differ.
 */
export const PREVIEW_HANDOVER_MS = 400

export interface PreviewRequestOptions {
  /** The chart's #PREVIEWSTART, in seconds, when known. Hand it to `play(track, 'preview', { previewStartSec })`. */
  previewStartSec?: number | null
  /**
   * Loop the preview (the default), or play it once to the end of the song and
   * then report it as ended (`endedTrack`) so the requester can move on. The
   * Song Selector asks for the latter; Party Draw keeps the loop.
   */
  loop?: boolean
}

interface SongPreviewStore {
  /** The `aetherstar-media://` URL the session wants on the preview bus, or null for silence. */
  track: string | null
  /** Where that preview should start, in seconds, or null to let the engine choose. */
  previewStartSec: number | null
  /** Whether that preview loops. Only read when the preview (re)starts. */
  loop: boolean
  /**
   * The requested track once it has played out to its end (a non-looping
   * preview), else null. Cleared by the next request. Written by the policy
   * site (App.tsx) from the engine's end-of-track callback.
   */
  endedTrack: string | null
  requestPreview: (track: string | null, options?: PreviewRequestOptions) => void
  clearPreview: () => void
  /** The preview of `track` reached the end of its audio. Ignored unless it is still the requested track. */
  notifyEnded: (track: string) => void
}

function validStart(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export const useSongPreviewStore = create<SongPreviewStore>((set) => ({
  track: null,
  previewStartSec: null,
  loop: true,
  endedTrack: null,
  // Returning the *same* state object when the track is unchanged is load
  // bearing, not a micro-optimisation: zustand skips notifying subscribers on
  // an identical next state, and a notification is precisely what would make
  // the policy site stop and restart a preview that is already playing the
  // right thing. Re-rendering the selector, or arriving on it again, therefore
  // cannot restart the audio.
  requestPreview: (track, options) =>
    set((state) => {
      const previewStartSec = track === null ? null : validStart(options?.previewStartSec)
      const loop = options?.loop !== false
      if (state.track === track && state.previewStartSec === previewStartSec && state.loop === loop) return state
      // The same track re-requested keeps its "ended" mark: asking again for a
      // song that has already played out must not make it look fresh.
      return { track, previewStartSec, loop, endedTrack: state.track === track ? state.endedTrack : null }
    }),
  clearPreview: () =>
    set((state) => (state.track === null ? state : { track: null, previewStartSec: null, loop: true, endedTrack: null })),
  notifyEnded: (track) =>
    set((state) => (state.track !== track || state.endedTrack === track ? state : { endedTrack: track })),
}))
