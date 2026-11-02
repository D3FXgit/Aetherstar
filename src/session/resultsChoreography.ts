/**
 * The results celebration's timeline, as pure data, so the order is unit-tested
 * rather than asserted from rendered pixels.
 *
 *   0ms     winner   The winner springs in under a "Winner!" label.
 *   520ms   crown    The crown lands; crownLand + cheer (the cheer is a bed under the next beats).
 *   1150ms  slide    The winner slides aside, after the impact has had a moment.
 *   1420ms  roster   Everyone else fades in, starting while the space is still opening.
 *   1900ms  count    Every score rolls up from a zero-padded 0.
 *   +180ms  actions  The buttons fade in once the number has settled, with uiBing/uiBong.
 *
 * About 3.5s to interactive; skippable, since it is seen once per song all night.
 */

/** One beat of the celebration. */
export type ResultsBeat = 'winner' | 'crown' | 'slide' | 'roster' | 'count' | 'actions'

/** The order of the beats. Index in this array *is* the beat's ordinal. */
export const BEAT_ORDER = ['winner', 'crown', 'slide', 'roster', 'count', 'actions'] as const

/**
 * The fixed part of the schedule. `actions` is deliberately absent: it is the
 * one beat whose offset depends on the score, so it exists only in
 * `beatSchedule()` rather than as a placeholder that could be read by mistake.
 */
export const RESULTS_BEATS: Record<Exclude<ResultsBeat, 'actions'>, number> = {
  winner: 0,
  crown: 520,
  slide: 1150,
  roster: 1420,
  count: 1900,
}

/** Beat durations, in ms, for the elements each beat animates. */
export const BEAT_DURATIONS = {
  /** The crown's fall onto the winner's head. */
  crownFlightMs: 420,
  /** The winner's slide from centre to the left column. */
  slideMs: 600,
  /** One roster row's fade, and the gap between consecutive rows. */
  rosterFadeMs: 420,
  rosterStaggerMs: 90,
  /** Gap between the counter settling and the buttons appearing. */
  actionsGapMs: 180,
  /** The buttons' own fade. */
  actionsFadeMs: 320,
  /** How long uiBong trails uiBing, so the pair reads as two notes not a chord. */
  actionsSecondToneDelayMs: 280,
  /** How long the confetti lives before it is unmounted outright. */
  confettiLifetimeMs: 2400,
} as const

const COUNT_MIN_MS = 900
const COUNT_MAX_MS = 1900
const COUNT_MS_PER_POINT = 0.06
const COUNT_BASE_MS = 800

/**
 * How long the score roll takes.
 *
 * Scaled by the score so a 40-point run does not take as long to count as a
 * 40,000-point one, but clamped hard at both ends: below the floor the roll
 * reads as a cut rather than a count, and above the ceiling it is just a wait.
 */
export function countDurationMs(score: number): number {
  const scaled = COUNT_BASE_MS + Math.max(score, 0) * COUNT_MS_PER_POINT
  return Math.min(Math.max(scaled, COUNT_MIN_MS), COUNT_MAX_MS)
}

/** Every beat's start offset in ms from mount, for a given final score. */
export function beatSchedule(score: number): Record<ResultsBeat, number> {
  return {
    ...RESULTS_BEATS,
    actions: RESULTS_BEATS.count + countDurationMs(score) + BEAT_DURATIONS.actionsGapMs,
  }
}

/** Has the sequence reached `beat`, given that it is currently at `current`? */
export function isAtLeast(current: ResultsBeat, beat: ResultsBeat): boolean {
  return BEAT_ORDER.indexOf(current) >= BEAT_ORDER.indexOf(beat)
}

/** The last beat -- the fully-arrived state that reduced motion and skipping jump straight to. */
export const FINAL_BEAT: ResultsBeat = BEAT_ORDER[BEAT_ORDER.length - 1]

/**
 * Digit count for the rolling readout.
 *
 * At least four, so the counter starts on the "0000" the design calls for, and
 * wider when the score needs it. Fixed width is what stops the digits jittering
 * sideways as the number grows -- combined with tabular figures, the readout
 * occupies exactly the same box at 0 as it does at the final score.
 */
export function scorePadWidth(score: number): number {
  return Math.max(4, String(Math.max(Math.round(score), 0)).length)
}

/** One frame of the rolling readout. Rounds, so the roll lands exactly on the final score. */
export function formatRollingScore(value: number, padWidth: number): string {
  return String(Math.max(Math.round(value), 0)).padStart(padWidth, '0')
}

/**
 * Floor on the gap between two `scoreTick` one-shots.
 *
 * `scoreTick` is a deliberately quiet 35ms sample. Firing it once per animation
 * frame (~16.7ms at 60fps) would start each instance before the last had
 * finished, smearing ~90 overlapping copies into a single buzz over a typical
 * roll. 90ms gives ~11 ticks a second -- fast enough to read as counting, far
 * enough apart that each sample is heard as its own click.
 */
export const SCORE_TICK_MIN_INTERVAL_MS = 90

/**
 * Two gates on a `scoreTick`, both required.
 *
 * The clock gate is the one above: it keeps the 35ms sample from being
 * retriggered before the previous copy has finished.
 *
 * The text gate keeps it silent through the long decelerating tail of the roll,
 * where the underlying value is still creeping but the rendered digits have
 * stopped changing. Sound should track what you can actually see change.
 */
export function shouldTick(nowMs: number, lastTickMs: number, text: string, lastText: string): boolean {
  return text !== lastText && nowMs - lastTickMs >= SCORE_TICK_MIN_INTERVAL_MS
}
