/**
 * One-shot UI sound effects. Deliberately a separate contract from
 * `audioManagerContract.ts`: that one owns a *single* looping/ducked music
 * track (play/duckTo/restore/crossfadeTo), while SFX are fire-and-forget,
 * overlap each other freely, and must never interrupt the menu music.
 */
export type SfxName =
  | 'hover'
  | 'click'
  | 'confirm'
  | 'back'
  | 'error'
  | 'countdownBeep'
  | 'countdownGo'
  | 'songSelected'
  // Gameplay note feedback. One per judged tier, so the sound reinforces the
  // popup rather than repeating it -- a player watching their own lane hears
  // the tier before they finish reading it.
  | 'hitExcellent'
  | 'hitGood'
  | 'hitBad'
  // Not a tier -- a *note kind*. A golden note is the one the chart marked as
  // worth double, so clearing it is the rarest good thing that happens during a
  // song and it gets a sound of its own rather than a louder Excellent.
  | 'hitGolden'
  // Results choreography.
  | 'cheer'
  | 'crownLand'
  | 'scoreTick'
  | 'uiBing'
  | 'uiBong'

/**
 * A handle on one sound that is currently playing.
 *
 * Almost every SFX in this app is genuinely fire-and-forget -- a 60 ms click
 * has finished before anything could want to cancel it. The exception is the
 * one long sound: `songSelected` runs for 4.75 s, and it is started by a React
 * effect. A resource a mount effect acquires and its cleanup cannot release is
 * a bug waiting to happen, and it produced two here:
 *
 * - Backing out of the start transition (the screen offers "Back to change the
 *   song") left the sound blaring over the Song Selector for the rest of its
 *   4.75 s, over the preview that had just come back.
 * - Under React StrictMode the mount effect runs, is cleaned up, and runs
 *   again -- so the sound was started twice, ~0 ms apart, and the two copies
 *   played on top of each other. That is the "audio gets played layered"
 *   report, and it is the same shape of bug as the StrictMode double-effect
 *   that once stopped Gameplay's live microphone capture.
 */
export interface SfxHandle {
  /**
   * Fade this sound to silence and stop it. Idempotent, and never throws.
   *
   * @param fadeMs how long to take, defaulting to sfxPlayer's SFX_STOP_FADE_MS.
   *   0 cuts immediately, which is an audible click on anything at level.
   */
  stop: (fadeMs?: number) => void
}

export interface SfxPlayer {
  /**
   * Start a sound. Never throws -- a missing or autoplay-blocked sound must not
   * break the interaction that triggered it.
   *
   * The real player (createSfxPlayer) always returns a handle, a no-op one
   * included, so its own callers never have to null-check. The *contract* is
   * deliberately wider than that: `play` is read from a swappable zustand store
   * and is passed around as a prop, and the overwhelming majority of stand-ins
   * -- test doubles, the Dev Lab, anything that only cares that a sound was
   * requested -- have no handle to give back. Saying so in the type is what
   * keeps "I want to cancel this later" an opt-in for the one caller that needs
   * it rather than a burden on every caller that does not.
   */
  play: (name: SfxName) => SfxHandle | void
}
