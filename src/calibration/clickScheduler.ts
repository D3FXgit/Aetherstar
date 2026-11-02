import type { AudioContextLike } from '../fx/audio/sfxEngine'

export interface CalibrationClocks {
  /** Monotonic page clock, the one keydown taps are read from. */
  perfNow: () => number
  /** Wall clock (epoch ms), the base native PitchSample.t is stamped in. */
  wallNow: () => number
}

const DEFAULT_CLOCKS: CalibrationClocks = {
  perfNow: () => performance.now(),
  wallNow: () => Date.now(),
}

export interface ScheduleClicksInput {
  audioContext: AudioContextLike
  clickBuffer: unknown
  count: number
  intervalSec: number
  /** Injectable for tests; defaults to performance.now() / Date.now(). */
  clocks?: CalibrationClocks
}

export interface ScheduledClicks {
  /** Each click's commanded time on the performance.now() timeline. */
  perfMs: number[]
  /** Each click's commanded time as epoch ms (the PitchSample.t base). */
  wallMs: number[]
  /** Date.now() at scheduling: anything the mic heard before this is stale. */
  wallStartMs: number
}

/**
 * Schedules `count` clicks spaced `intervalSec` apart via Web Audio's
 * sample-accurate `AudioBufferSourceNode.start(when)`, starting from the
 * current instant.
 *
 * AudioContext.currentTime counts from the context's creation, which shares
 * no origin with performance.now() (page load) or Date.now() (epoch), so the
 * raw `when` cannot be compared with a tap timestamp. All three clocks are
 * read once, together, and each click is re-expressed as an offset from that
 * common instant in the two bases the latency steps measure taps in.
 */
export function scheduleClicks({
  audioContext,
  clickBuffer,
  count,
  intervalSec,
  clocks = DEFAULT_CLOCKS,
}: ScheduleClicksInput): ScheduledClicks {
  const ctx0 = audioContext.currentTime
  const perf0 = clocks.perfNow()
  const wall0 = clocks.wallNow()
  const perfMs: number[] = []
  const wallMs: number[] = []

  for (let i = 0; i < count; i++) {
    const when = ctx0 + i * intervalSec
    const source = audioContext.createBufferSource()
    source.buffer = clickBuffer
    source.connect(audioContext.destination)
    source.start(when)
    const sinceStartMs = (when - ctx0) * 1000
    perfMs.push(perf0 + sinceStartMs)
    wallMs.push(wall0 + sinceStartMs)
  }

  return { perfMs, wallMs, wallStartMs: wall0 }
}
