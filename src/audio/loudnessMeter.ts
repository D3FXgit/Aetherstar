// EBU R 128 integrated loudness measured in the renderer from already-decoded
// audio -- the fallback for machines without ffmpeg (most Windows installs).
// Time-sliced so a long song never blocks the UI for more than a few ms.

export interface LoudnessMeasurement {
  integratedLufs: number
  /**
   * Peak in dBFS, plus a small margin for inter-sample overs. This is a sample
   * peak, not an oversampled true peak; the margin keeps it from under-reading,
   * and it is only ever used to cap a boost.
   */
  truePeakDbtp: number
}

/** Sample peak under-reads true peak by up to ~0.7 dB on real program; this keeps the boost cap on the safe side. */
export const SAMPLE_PEAK_MARGIN_DB = 0.7

const BLOCK_SECONDS = 0.4
const STEP_SECONDS = 0.1
const ABSOLUTE_GATE_LUFS = -70
const RELATIVE_GATE_LU = -10

export interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

/**
 * BS.1770 K-weighting at any sample rate: a high-shelf "head" filter, then the
 * RLB high-pass. Derived from the analogue prototypes (the same formulation as
 * libebur128), so 44.1 kHz files are filtered correctly rather than with the
 * 48 kHz table coefficients.
 */
export function kWeightingFilters(sampleRate: number): [Biquad, Biquad] {
  // Stage 1: high shelf, +4 dB above ~1.5 kHz.
  const f0 = 1681.974450955533
  const shelfGainDb = 3.999843853973347
  const q0 = 0.7071752369554196
  const k1 = Math.tan((Math.PI * f0) / sampleRate)
  const vh = 10 ** (shelfGainDb / 20)
  const vb = vh ** 0.4996667741545416
  const a0s = 1 + k1 / q0 + k1 * k1
  const shelf: Biquad = {
    b0: (vh + (vb * k1) / q0 + k1 * k1) / a0s,
    b1: (2 * (k1 * k1 - vh)) / a0s,
    b2: (vh - (vb * k1) / q0 + k1 * k1) / a0s,
    a1: (2 * (k1 * k1 - 1)) / a0s,
    a2: (1 - k1 / q0 + k1 * k1) / a0s,
  }

  // Stage 2: RLB high-pass at ~38 Hz.
  const f1 = 38.13547087602444
  const q1 = 0.5003270373238773
  const k2 = Math.tan((Math.PI * f1) / sampleRate)
  const a0h = 1 + k2 / q1 + k2 * k2
  const highPass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k2 * k2 - 1)) / a0h,
    a2: (1 - k2 / q1 + k2 * k2) / a0h,
  }

  return [shelf, highPass]
}

/** Per-channel filter memory, carried across slices. */
interface ChannelState {
  x1: number
  x2: number
  y1: number
  y2: number
  z1: number
  z2: number
  w1: number
  w2: number
}

function freshState(): ChannelState {
  return { x1: 0, x2: 0, y1: 0, y2: 0, z1: 0, z2: 0, w1: 0, w2: 0 }
}

/**
 * Incremental meter: feed it consecutive slices, then read result(). Exposed
 * so the async wrapper can yield between slices and tests can drive it
 * synchronously.
 */
export class IntegratedLoudnessMeter {
  private readonly shelf: Biquad
  private readonly highPass: Biquad
  private readonly stepFrames: number
  private readonly states: ChannelState[]
  /** K-weighted energy per 100 ms step, summed over channels (all at weight 1). */
  private readonly stepEnergies: number[] = []
  private currentStepEnergy = 0
  private currentStepFrames = 0
  private peak = 0

  constructor(sampleRate: number, channelCount: number) {
    const filters = kWeightingFilters(sampleRate)
    this.shelf = filters[0]
    this.highPass = filters[1]
    this.stepFrames = Math.max(1, Math.round(sampleRate * STEP_SECONDS))
    this.states = Array.from({ length: channelCount }, freshState)
  }

  /** Feeds frames from start (inclusive) to end (exclusive) of every channel. */
  process(channels: readonly Float32Array[], start: number, end: number): void {
    const s = this.shelf
    const h = this.highPass
    let frame = start
    while (frame < end) {
      const stepEnd = Math.min(end, frame + (this.stepFrames - this.currentStepFrames))
      let energy = 0
      let peak = this.peak
      for (let c = 0; c < channels.length; c++) {
        const data = channels[c]
        const st = this.states[c]
        let { x1, x2, y1, y2, z1, z2, w1, w2 } = st
        for (let i = frame; i < stepEnd; i++) {
          const x = data[i]
          const ax = x < 0 ? -x : x
          if (ax > peak) peak = ax
          const y = s.b0 * x + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2
          x2 = x1
          x1 = x
          y2 = y1
          y1 = y
          const w = h.b0 * y + h.b1 * z1 + h.b2 * z2 - h.a1 * w1 - h.a2 * w2
          z2 = z1
          z1 = y
          w2 = w1
          w1 = w
          energy += w * w
        }
        st.x1 = x1
        st.x2 = x2
        st.y1 = y1
        st.y2 = y2
        st.z1 = z1
        st.z2 = z2
        st.w1 = w1
        st.w2 = w2
      }
      this.peak = peak
      this.currentStepEnergy += energy
      this.currentStepFrames += stepEnd - frame
      frame = stepEnd
      if (this.currentStepFrames >= this.stepFrames) {
        this.stepEnergies.push(this.currentStepEnergy)
        this.currentStepEnergy = 0
        this.currentStepFrames = 0
      }
    }
  }

  /** Gated integrated loudness, or null for silence or audio shorter than one 400 ms block. */
  result(): LoudnessMeasurement | null {
    const stepsPerBlock = Math.round(BLOCK_SECONDS / STEP_SECONDS)
    const blockFrames = this.stepFrames * stepsPerBlock
    const steps = this.stepEnergies
    if (steps.length < stepsPerBlock) return null

    // Mean square per 400 ms block, 75 % overlap.
    const blocks: number[] = []
    let running = 0
    for (let i = 0; i < steps.length; i++) {
      running += steps[i]
      if (i >= stepsPerBlock) running -= steps[i - stepsPerBlock]
      if (i >= stepsPerBlock - 1) blocks.push(Math.max(0, running) / blockFrames)
    }

    const loudnessOf = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare)
    const meanOf = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length

    const absoluteGated = blocks.filter((z) => z > 0 && loudnessOf(z) > ABSOLUTE_GATE_LUFS)
    if (absoluteGated.length === 0) return null
    const relativeGate = loudnessOf(meanOf(absoluteGated)) + RELATIVE_GATE_LU
    const gated = absoluteGated.filter((z) => loudnessOf(z) > relativeGate)
    if (gated.length === 0) return null

    const integratedLufs = loudnessOf(meanOf(gated))
    const truePeakDbtp = 20 * Math.log10(this.peak) + SAMPLE_PEAK_MARGIN_DB
    if (!Number.isFinite(integratedLufs) || !Number.isFinite(truePeakDbtp)) return null
    return { integratedLufs, truePeakDbtp }
  }
}

/** Synchronous measurement over whole channel arrays. For tests and short buffers. */
export function measureIntegratedLoudness(channels: readonly Float32Array[], sampleRate: number): LoudnessMeasurement | null {
  if (channels.length === 0 || !(sampleRate > 0)) return null
  const meter = new IntegratedLoudnessMeter(sampleRate, channels.length)
  meter.process(channels, 0, channels[0].length)
  return meter.result()
}

/** The parts of an AudioBuffer the meter reads; structural, so tests need no Web Audio. */
export interface MeasurableBuffer {
  readonly sampleRate: number
  readonly numberOfChannels: number
  readonly length: number
  getChannelData(channel: number): Float32Array
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Measures a decoded buffer in slices, yielding to the event loop between
 * them. Five seconds of stereo is a few milliseconds of work, so the UI never
 * notices, and a whole song finishes in well under a second of wall time.
 */
export async function measureAudioBufferLoudness(
  buffer: MeasurableBuffer,
  options: { sliceSeconds?: number; yieldFn?: () => Promise<void> } = {},
): Promise<LoudnessMeasurement | null> {
  const { sliceSeconds = 5, yieldFn = yieldToEventLoop } = options
  const { sampleRate, numberOfChannels, length } = buffer
  if (!(sampleRate > 0) || !(numberOfChannels > 0) || !(length > 0)) return null
  // Only the front three channels are measured, all at weight 1. Surround song
  // files do not exist in practice.
  const channels = Array.from({ length: Math.min(3, numberOfChannels) }, (_, c) => buffer.getChannelData(c))
  const meter = new IntegratedLoudnessMeter(sampleRate, channels.length)
  const slice = Math.max(1, Math.round(sampleRate * sliceSeconds))
  for (let start = 0; start < length; start += slice) {
    meter.process(channels, start, Math.min(length, start + slice))
    if (start + slice < length) await yieldFn()
  }
  return meter.result()
}
