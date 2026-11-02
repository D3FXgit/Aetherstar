// --- Song chart ---

export interface SongMeta {
  artist: string
  title: string
  /** The full mix, from #AUDIO (current) or #MP3 (legacy). Empty on a stems-only chart. */
  mp3Path: string
  /**
   * Separated a-cappella track (#VOCALS), when the chart ships one. Optional
   * because the overwhelming majority of charts have no stems at all and
   * every playback path must work without them.
   */
  vocalsPath?: string
  /** Separated backing track (#INSTRUMENTAL), when the chart ships one. */
  instrumentalPath?: string
  videoPath?: string
  coverPath?: string
  /** `#BACKGROUND`: a full-screen background image, the fallback when there is no playable video. */
  backgroundPath?: string
  bpm: number
  gap: number
  videoGap: number
  /**
   * `#VOLUME`: a linear per-song level multiplier the chart author declared.
   *
   * Optional, and undefined (not 1) when the tag is absent, because those are
   * different statements: "the author said nothing" leaves the song's level to
   * the measured normalisation alone, while `#VOLUME:1` is an explicit "leave
   * it alone" that happens to be a no-op. See src/audio/loudness.ts.
   */
  volume?: number
  language?: string
  edition?: string
  /**
   * `#START`, converted to milliseconds: how far into the audio playback
   * should begin (skips an intro). The tag itself is in seconds; this field is
   * ms so it pairs with `endMs`. Undefined when the tag is absent or unreadable.
   */
  startMs?: number
  /** `#END`: milliseconds into the audio at which the song should end. Undefined when absent. */
  endMs?: number
  /** `#PREVIEWSTART`: seconds into the audio the library preview should start from. Undefined when absent. */
  previewStartSec?: number
  /** `#MEDLEYSTARTBEAT`: first beat of the chart's medley excerpt. Undefined when absent. */
  medleyStartBeat?: number
  /** `#MEDLEYENDBEAT`: last beat of the chart's medley excerpt. Undefined when absent. */
  medleyEndBeat?: number
  /**
   * `#CALCMEDLEY`: whether a medley excerpt may be computed automatically.
   * Undefined when the tag is absent (UltraStar's default is "yes"); `false`
   * for `#CALCMEDLEY:OFF` / `NO` / `0` / `FALSE`.
   */
  calcMedley?: boolean
}

/**
 * - `normal` (`:`) / `golden` (`*`): pitched notes; golden beats are worth double.
 * - `freestyle` (`F`): unscored -- worth 0, excluded from the maximum, no feedback.
 * - `rap` (`R`) / `goldenRap` (`G`): pitch-free notes scored on voiced activity
 *   at any pitch; golden rap beats are worth double.
 */
export type NoteKind = 'normal' | 'golden' | 'freestyle' | 'rap' | 'goldenRap'

export interface SongNote {
  kind: NoteKind
  startBeat: number
  length: number
  /** Raw UltraStar relative-pitch integer, as authored in the .txt (not converted to MIDI). */
  pitch: number
  syllable: string
}

/**
 * Which singer a line belongs to. `solo` is sung by everyone -- it is also
 * what an UltraStar `P3` ("both") section parses to in a duet.
 */
export type SongPart = 'solo' | 'p1' | 'p2'

export interface SongLine {
  part: SongPart
  notes: SongNote[]
  /** Beat position of the line's trailing '-' marker, if the chart has one. */
  lineBreakBeat?: number
}

export interface SongChart {
  meta: SongMeta
  lines: SongLine[]
}

// --- Real-time streams ---

export interface PitchSample {
  t: number
  hz: number
  confidence: number
  deviceId: string
  /**
   * Input level for this frame: RMS amplitude of the analysis window, 0..1.
   *
   * Distinct from `confidence`, which is a YIN periodicity score and says
   * nothing about loudness -- a shouted "shhh" scores near zero and a whispered
   * hum near one, so confidence cannot drive an input meter. `rms` can.
   *
   * Optional because it only exists on samples produced by the native bridge;
   * the hand-written fixtures and mocks that predate it don't set it, and
   * nothing reading the pitch stream should have to care.
   */
  rms?: number
}

export type HitTier = 'epic' | 'good' | 'awful'

export interface HitEvent {
  playerId: string
  tier: HitTier
  noteId: string
  deviationCents: number
  t: number
}

// --- Scoring & players ---

export interface PlayerScore {
  playerId: string
  name: string
  /**
   * Whole points, 0..10,000 per singer per song (the usual party karaoke / UltraStar scale):
   * up to 9,000 from notes and 1,000 from line bonuses, always measured
   * against the notes of the part this singer actually sings.
   */
  score: number
  /**
   * @deprecated Scoring has no combo any more (party-karaoke-style model). The real
   * score store always writes 0; the field stays only so existing producers
   * and consumers keep compiling. Do not display it.
   */
  combo: number
  rank: number
}

export interface ScoreState {
  players: PlayerScore[]
  /** @deprecated Always 0 -- see `PlayerScore.combo`. */
  combo: number
  /** playerIds in rank order, index 0 = leader. */
  rank: string[]
}

export interface PlayerProfile {
  id: string
  name: string
  avatarUrl: string
  color: string
  /** Lifetime stats; 0 for a new player, updated after each sung song. */
  songsSung?: number
  bestScore?: number
}
