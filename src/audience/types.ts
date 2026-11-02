import type { HitTier, ScoreState } from '../contracts/types'
import type { SessionMode } from '../session/types'

export interface DisplayInfo {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  isPrimary: boolean
}

export interface AudienceDisplaysPayload {
  displays: DisplayInfo[]
  selectedDisplayId: number | null
  /** Whether the audience (second-screen) window is turned on -- opt-in, default off. */
  enabled: boolean
}

/**
 * Which screen the audience display is currently mirroring.
 *
 * The audience window shows the same screen the host is on, minus everything
 * interactive -- so this is derived from the host's *scene*, not invented here:
 *
 *   idle        the main screen, without the buttons
 *   lineup      the chosen song, cover centred, with the singers picked so far
 *   play        the singer view: the song, the lyrics, the live scores
 *   results     the celebration, without the buttons
 *   scoreboard  the bare ranked table -- the Dev Lab's route, and the fallback
 *               for any host that reports scores without a scene
 */
export type AudienceView = 'idle' | 'lineup' | 'play' | 'results' | 'scoreboard'

/** Enough of the chosen song for the audience window to draw it and load its chart itself. */
export interface AudienceSong {
  /** The song *folder* -- what `useChartLoader` takes, so the audience can render the real lyrics. */
  path: string
  title: string
  artist: string
  /** A resolved `aetherstar-media://` thumbnail URL, or null when the song has no cover. */
  coverUrl: string | null
  /** The relative video path, if known. */
  videoPath?: string | null
}

/**
 * One singer, as the audience sees them.
 *
 * The **mic number is the identifier**; the rim colour derived from it is only
 * reinforcement, never the sole difference between two people (the same
 * constraint the host screens are held to -- see src/design/tokens.ts's
 * micRimColor).
 */
export interface AudienceSinger {
  /** Null when the pick was mirrored by name and matched no stored profile. */
  playerId: string | null
  name: string
  /** 1-based, and it is the physical input number -- see src/multiplayer/slots.ts. */
  micNumber: number
  avatarUrl: string
}

export interface AudienceResultRow extends AudienceSinger {
  score: number
  epicCount: number
  goodCount: number
  awfulCount: number
  bestLine: string | null
}

/** Line/syllable-boundary playback position, mirrored from the host's stage store. */
export interface AudienceLyricState {
  currentLineIndex: number
  activeSyllableIndex: number
}

/**
 * Where the host's song clock is -- **an anchor, not a position**.
 *
 * The audience window has to scroll a note lane and play a backdrop video, both
 * of which need a position *per frame*. A 34 ms-coalesced IPC channel cannot
 * carry one: it drops intermediate values by design, so a lane driven straight
 * off arriving payloads would stutter at exactly the rate the relay happens to
 * fire. So what is sent is an anchor -- a reading, and when it was taken -- and
 * the audience runs its own real-time clock from it (see ./useAudienceStageClock.ts).
 *
 * `atEpochMs` is `Date.now()`, deliberately, where everything else timing-shaped
 * in this app uses `performance.now()`: the two windows are two renderer
 * *processes*, and `performance.now()` is measured from each process's own
 * origin, so the host's is meaningless here. `Date.now()` is the one clock both
 * processes share, and they are by construction the same machine.
 */
export interface AudiencePlayback {
  /** The host clock element's `currentTime`, in milliseconds into the audio file. */
  positionMs: number
  /** `Date.now()` on the host at the instant `positionMs` was read. */
  atEpochMs: number
  /** True while the host's clock element is not advancing (countdown, pause, ended). */
  paused: boolean
  /**
   * True while the host has the pause menu (or its resume lead-in) up -- told
   * apart from a plain stopped clock so the audience can say the song is paused.
   */
  pausedByHost?: boolean
  /** Bumped when the host restarts the song, so the audience starts its note trail over. */
  epoch?: number
  /**
   * The speaker-delay calibration (outputOffsetMs) the host folds into the
   * chart's #GAP before judging and drawing. The audience adds it to its own
   * copy of the chart's gap for the lanes and lyrics, so they stay on the
   * host's notes; the backdrop video keeps following the raw `positionMs`.
   * Absent (an older host) reads as 0.
   */
  gapOffsetMs?: number
}

/**
 * One judged note, flattened for the wire.
 *
 * Notes *positions* are free on the audience side -- it loads the same chart --
 * but whether a note was sung, by whom, and how much of it, exists only in the
 * host's judging loop. This is that, and only the recent tail of it: a clear
 * matters until the note has scrolled off the left of the lane, which is about a
 * second and a half of chart.
 */
export interface AudienceNoteClear {
  /** `flattenNotes`' deterministic id, in the id space of *this player's* filtered lines. */
  noteId: string
  playerId: string
  tier: HitTier
  /** 0..1 partial credit, as `judgeNote` measured it. Absent means fully credited. */
  credit?: number
}

/**
 * The whole audience payload, broadcast over `AUDIENCE_SCORE_STATE`.
 *
 * A *superset* of `ScoreState` rather than a new channel: the relay
 * (electron/windows/state-broadcaster.cjs) already coalesces whatever is
 * reported to one send per frame, and score-only readers (the Dev Lab,
 * `useAudienceScoreState`) keep working on the same fields.
 */
export interface AudienceState extends ScoreState {
  view: AudienceView
  mode?: SessionMode
  song: AudienceSong | null
  /** The singers picked so far -- filling in one at a time during the line-up. */
  singers: AudienceSinger[]
  results: AudienceResultRow[]
  lyrics: AudienceLyricState | null
  /** The clock anchor the audience runs its lanes and its backdrop video from. Null off the `play` view. */
  playback: AudiencePlayback | null
  /**
   * Whether the host has any microphone slot actually configured.
   *
   * The audience's lanes have to be *the host's* lanes. On a configured rig
   * that is one lane per singer, which the line-up already describes -- but with
   * nothing configured `MultiplayerGameplay` deliberately collapses to a single
   * fallback lane singing the whole chart, and a television showing four lanes
   * beside a host showing one is simply wrong. One boolean is the whole
   * difference, so it is sent rather than guessed.
   */
  micRigConfigured: boolean
  /**
   * The recent tail of the host's judged notes, oldest first.
   *
   * Bounded (see `AUDIENCE_CLEAR_WINDOW`) because the payload is re-sent whole
   * on every publish -- an unbounded history would grow the message all song.
   * Replayed into the audience window's own hit store, which is what lets the
   * *real* `NoteLane` clear its notes here exactly as it does on the host.
   */
  clears: AudienceNoteClear[]
  /**
   * Wire-format only: set by the host when `clears` is identical to what it
   * sent in the last few messages, in which case `clears` is sent empty and
   * the audience keeps the ones it already holds (see audienceBroadcast.ts).
   * `normalizeAudienceState` strips it; no component ever sees it.
   */
  clearsUnchanged?: true
  /**
   * Where each singer's pitch indicator is heading, in semitones.
   *
   * A semitone rather than a pixel, and a target rather than a position -- see
   * ./pitchMirror.ts for both reasons. Empty off the `play` view, and empty for
   * any singer who is not making a pitch at this instant.
   */
  pitches: AudienceSingerPitch[]
}

/** One singer's live pitch indicator, as the television is told about it. */
export interface AudienceSingerPitch {
  playerId: string
  /**
   * The host's *display* semitone -- already snapped to the note under the
   * playhead where the host snapped it, so both screens draw the rule in the
   * same place relative to the same pill.
   */
  semitone: number
}

/**
 * How many recent judgements ride along in each payload.
 *
 * A clear only has to arrive before its note leaves the lane. The lane shows
 * about 22 beats behind the playhead (35% of ~1500px at 24px/beat), which is
 * ~1.3 s at a fast chart and ~3 s at a slow one; 96 covers both at eight singers
 * even in the pathological case, and costs about 7 KB per message.
 *
 * Losses are cheap anyway: the audience replays into a hit store that *keeps*
 * what it has seen, so a clear only needs to land once in a window that is
 * re-sent ten times a second.
 */
export const AUDIENCE_CLEAR_WINDOW = 96

export const EMPTY_AUDIENCE_STATE: AudienceState = {
  view: 'idle',
  players: [],
  combo: 0,
  rank: [],
  song: null,
  singers: [],
  results: [],
  lyrics: null,
  playback: null,
  micRigConfigured: false,
  clears: [],
  pitches: [],
}
