/**
 * How much (timestamp, beat) history the buffer keeps.
 *
 * This has to outlast one whole note, because judgeNote reconciles a note's
 * entire sample span in one go, at the moment the note ends. At the original
 * 250ms it did not: a 24-beat note in the repo's own fixture chart lasts
 * 1440ms, so by the time it was judged most of its own frames had already been
 * evicted and every sample from the first second of it reconciled against a
 * beat that was never recorded for it.
 *
 * 2500ms only covered that one chart. An UltraStar `#BPM` counts quarter beats
 * (see src/stage/timing/beatMs.ts), so a beat lasts `60000/(bpm*4)` ms and a
 * 24-beat hold runs 1440ms at BPM 250 but 3600ms at BPM 100 -- a perfectly
 * ordinary tag value. Past the window those samples silently vanish from the
 * judgment: the note is scored on its last 2.5 seconds only, so a singer who
 * nails the entry and drifts at the end is judged purely on the drift.
 *
 * 8000ms covers a 24-beat hold down to BPM 45 and a 32-beat one down to BPM 60,
 * at a cost of ~960 {t, beat} pairs. It must stay well *below* a song's #GAP
 * (20-40s is typical) -- the out-of-window rejection is what stops the whole
 * pre-first-note backlog being snapped onto the first note's span.
 */
export const CLOCK_BUFFER_WINDOW_MS = 8000

/**
 * How far past the newest recorded frame a lookup may still land.
 *
 * A pitch sample is timestamped by the capture thread, so it can be a frame or
 * two newer than the last beat this buffer saw. Anything further into the
 * future is not a rounding difference and has no honest answer.
 */
const EXTRAPOLATION_TOLERANCE_MS = 40

interface ClockSample {
  t: number
  beat: number
}

export interface ClockBuffer {
  record(t: number, beat: number): void
  /** The chart beat at `sampleT`, or null when this buffer never observed that moment. */
  beatAt(sampleT: number): number | null
  /**
   * The inverse: the wall-clock ms at which the chart reached `beat`, or null
   * when this buffer never observed that beat.
   *
   * `beatAt` answers "when the singer made this sound, where was the song?".
   * This answers "when did this note start and end?", which is what partial
   * credit needs: coverage is a fraction of a note's *duration* (see
   * noteCoverage.ts), and a duration cannot be measured in beats without
   * knowing the tempo -- which this buffer already knows, implicitly, as the
   * slope of the (t, beat) pairs it is holding.
   *
   * Deliberately strict at both ends, exactly as `beatAt` is. Clamping a beat
   * the buffer never saw to its nearest edge would shorten the note's measured
   * span and inflate coverage -- silently, and in the singer's favour, which is
   * the direction a scoring bug is hardest to notice. A caller that gets null
   * has to say what it does instead.
   */
  timeAt(beat: number): number | null
  /** Entries currently held -- for tests asserting the buffer stays bounded. */
  size(): number
}

/**
 * A short rolling (timestamp, beatPosition) buffer, sampled every animation
 * frame, used to reconcile a `PitchSample.t` (wall-clock ms) against the beat
 * position the chart was actually at when that sample was captured -- rather
 * than assuming it describes "now".
 *
 * 1. **A lookup outside the recorded range answers null**, so stale samples
 *    (say, half a minute of them before a long #GAP) are never snapped into
 *    the current window and counted against the note being judged.
 * 2. **A lookup between two frames is interpolated**: beat position is linear
 *    in time, so snapping to the nearer frame would lose up to half a frame.
 *
 * Storage is a ring buffer read through a head index, so recording allocates
 * nothing per frame.
 */
export function createClockBuffer(windowMs: number = CLOCK_BUFFER_WINDOW_MS): ClockBuffer {
  // Append-only, oldest-first, with `head` marking the first live entry. The
  // dead prefix is compacted away once it dominates, so neither the array nor
  // the head index grows without bound.
  let samples: ClockSample[] = []
  let head = 0

  return {
    record(t: number, beat: number): void {
      samples.push({ t, beat })

      const cutoff = t - windowMs
      while (head < samples.length && samples[head].t < cutoff) head++

      if (head > 64 && head * 2 >= samples.length) {
        samples = samples.slice(head)
        head = 0
      }
    },

    size(): number {
      return samples.length - head
    },

    beatAt(sampleT: number): number | null {
      const count = samples.length - head
      if (count === 0) return null

      const oldest = samples[head]
      const newest = samples[samples.length - 1]

      // The buffer's memory horizon, measured back from the newest frame
      // rather than from the oldest one it happens to hold: a buffer that has
      // only just started recording still legitimately covers a sample from
      // moments before its first frame, but nothing beyond `windowMs` -- and
      // the backlog Gameplay carries into a note is tens of seconds deep.
      if (sampleT < newest.t - windowMs - EXTRAPOLATION_TOLERANCE_MS) return null
      if (sampleT > newest.t + EXTRAPOLATION_TOLERANCE_MS) return null
      if (sampleT <= oldest.t) return oldest.beat
      if (sampleT >= newest.t) return newest.beat

      // Timestamps are recorded in ascending order, so the bracketing pair is
      // a binary search.
      let low = head
      let high = samples.length - 1
      while (high - low > 1) {
        const mid = (low + high) >> 1
        if (samples[mid].t <= sampleT) low = mid
        else high = mid
      }

      const before = samples[low]
      const after = samples[high]
      const span = after.t - before.t
      if (span <= 0) return before.beat

      return before.beat + ((sampleT - before.t) / span) * (after.beat - before.beat)
    },

    timeAt(beat: number): number | null {
      const count = samples.length - head
      if (count === 0) return null

      const oldest = samples[head]
      const newest = samples[samples.length - 1]

      // A buffer that has not moved forward (a paused clock, one recorded
      // frame) has no slope to invert, and every beat maps to every time.
      if (!(newest.beat > oldest.beat)) return null
      if (beat < oldest.beat || beat > newest.beat) return null

      // Beat position advances monotonically with playback, so the bracketing
      // pair is the same binary search `beatAt` does, on the other axis.
      let low = head
      let high = samples.length - 1
      while (high - low > 1) {
        const mid = (low + high) >> 1
        if (samples[mid].beat <= beat) low = mid
        else high = mid
      }

      const before = samples[low]
      const after = samples[high]
      const span = after.beat - before.beat
      if (span <= 0) return before.t

      return before.t + ((beat - before.beat) / span) * (after.t - before.t)
    },
  }
}
