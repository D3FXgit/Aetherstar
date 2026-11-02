import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { StrictMode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { motionValue } from 'framer-motion'
import { Gameplay } from '../Gameplay'
import { usePitchStore, resetCaptureIntentsForTests, resetPitchBatchSubscriptionForTests } from '../../audio/pitchStore'
import { usePlayersStore } from '../../players/store'
import { useHitStore } from '../state/useHitStore'
import { useScoreStore } from '../state/useScoreStore'
import { useMicHealthStore } from '../state/useMicHealthStore'
import { useCalibrationStore } from '../../calibration/calibrationStore'
import { DEFAULT_CALIBRATION_SETTINGS } from '../../calibration/types'
import { msPerBeat, msToBeat } from '../../stage/timing/beatMs'
import { readSingerPitches } from '../../audience/pitchMirror'
import { useStageStore } from '../../stage/stageStore'
import type { HitTier, PitchSample, SongLine, SongMeta } from '../../contracts/types'

/**
 * End-to-end proof that a singer who sings the right notes actually scores.
 *
 * Every other test of the matcher hands `judgeNote` a hand-built sample array,
 * or pokes a ready-made capture straight into `usePitchStore.activeCaptures`.
 * Both skip the two links where this pipeline was actually broken: nothing on
 * the gameplay path ever *started* a capture, and the frame loop threw away
 * samples across a note boundary. So this file drives the real chain --
 * `window.api.audio` -> `usePitchStore.subscribeToEvents` -> `Gameplay`'s
 * animation-frame loop -> `judgeNote` -> `useScoreStore` -- with a simulated
 * singer and a simulated audio thread, and asserts on the score at the end.
 *
 * A non-zero score for an on-pitch singer and a zero for silence is the
 * regression that matters most in this codebase: without it, "notes never
 * clear or score" is a bug the entire suite can stay green through.
 */

const DEVICE_ID = 'mic-1'
const BPM = 250 // the repo's own fixture chart -- 60 ms per (quarter) beat
const GAP = 0

const META: SongMeta = { artist: 'Test', title: 'Song', mp3Path: 'song.mp3', bpm: BPM, gap: GAP, videoGap: 0 }

/** Semitone -> Hz in the same octave-agnostic reference the chart pitches use. */
function hzForPitch(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12)
}

interface Chart {
  notes: Array<{ kind: 'normal' | 'rap'; startBeat: number; length: number; pitch: number; syllable: string }>
  lines: SongLine[]
}

function buildChart({ count = 10, length = 2, gapBeats = 2 }: { count?: number; length?: number; gapBeats?: number } = {}): Chart {
  const notes = Array.from({ length: count }, (_, i) => ({
    kind: 'normal' as const,
    startBeat: i * (length + gapBeats),
    length,
    pitch: 9, // A -- pitch class 9
    syllable: 'la',
  }))
  return { notes, lines: [{ part: 'solo', notes }] }
}

interface Singer {
  /** Hz this singer produces at `songMs` into the song, or 0 for silence. `paused` is true while the song is paused. */
  (songMs: number, chart: Chart, paused: boolean): number
}

/** Sings every note dead on pitch, and nothing between them. */
const onPitchSinger: Singer = (songMs, chart) => {
  const beat = msToBeat(songMs, BPM, GAP)
  const note = chart.notes.find((n) => beat >= n.startBeat && beat < n.startBeat + n.length)
  return note ? hzForPitch(note.pitch) : 0
}

/** Never makes a pitched sound -- the mic is live, the room is quiet. */
const silentSinger: Singer = () => 0

/** Sings only the first note of the chart, then stops for good. */
const firstNoteOnlySinger: Singer = (songMs, chart) => {
  const beat = msToBeat(songMs, BPM, GAP)
  const first = chart.notes[0]
  return beat >= first.startBeat && beat < first.startBeat + first.length ? hzForPitch(first.pitch) : 0
}

/** Marker for "a loud, unpitched sound" -- a rapper's consonants: no pitch, real level. */
const UNPITCHED_VOICE = -1

/** Raps every note: loud and voiced, but no detectable pitch at all. */
const rapper: Singer = (songMs, chart) => {
  const beat = msToBeat(songMs, BPM, GAP)
  return chart.notes.some((n) => beat >= n.startBeat && beat < n.startBeat + n.length) ? UNPITCHED_VOICE : 0
}

interface RunOptions {
  chart: Chart
  singer: Singer
  /** Start a capture before Gameplay mounts, the way Mic Check would. Off by default: the point is that gameplay must not depend on it. */
  preStartCapture?: boolean
  /** Every Nth frame, skip `hitchFrames` frames of rAF while the clock keeps running -- a dropped-frame stutter. */
  hitchEvery?: number
  hitchFrames?: number
  /** Pause the song (stage status `paused`, clock frozen) for `forMs` of wall time once it reaches `atMs`. */
  pause?: { atMs: number; forMs: number }
  /** Native analysis hop and IPC batch cadence, in ms. */
  hopMs?: number
  batchMs?: number
}

interface RunResult {
  score: number
  tiers: HitTier[]
  maxScore: number
}

async function runSong({
  chart,
  singer,
  preStartCapture = false,
  hitchEvery,
  hitchFrames = 6,
  hopMs = 23,
  batchMs = 50,
  pause,
}: RunOptions): Promise<RunResult> {
  const unsubscribe = usePitchStore.getState().subscribeToEvents()
  if (preStartCapture) await usePitchStore.getState().startCapture(DEVICE_ID)

  const beatPosition = motionValue(0)
  const tiers: HitTier[] = []
  const unsubscribeHits = useHitStore.subscribe((state) => {
    if (state.latest) tiers.push(state.latest.tier)
  })

  render(<Gameplay meta={META} lines={chart.lines} beatPosition={beatPosition} />)
  // Let Gameplay's capture-guarantee effect resolve before the song starts.
  await act(async () => {})

  const songStart = Date.now()
  const lastNote = chart.notes[chart.notes.length - 1]
  const totalMs = (lastNote.startBeat + lastNote.length + 4) * msPerBeat(BPM)

  let nextSampleT = songStart
  let lastBatchAt = songStart
  let batched: PitchSample[] = []
  let frameIndex = 0
  const FRAME_MS = 16

  // Wall time keeps running through a pause; the song position does not.
  let pausedForMs = 0
  for (let elapsed = 0; elapsed - pausedForMs <= totalMs; elapsed += FRAME_MS) {
    frameIndex++
    // A stutter: wall-clock time (and playback) jump forward while no
    // animation frame ran, so several notes cross in one frame.
    if (hitchEvery !== undefined && frameIndex % hitchEvery === 0) elapsed += FRAME_MS * hitchFrames

    const paused = pause !== undefined && elapsed >= pause.atMs && elapsed < pause.atMs + pause.forMs
    if (paused) pausedForMs = elapsed - pause.atMs + FRAME_MS
    useStageStore.getState().setStatus(paused ? 'paused' : 'playing')
    const songMs = elapsed - pausedForMs

    setNow(songStart + elapsed)

    // The native audio thread analysing one frame per hop.
    while (nextSampleT <= Date.now()) {
      const sung = singer(Math.min(nextSampleT - songStart, songMs), chart, paused)
      const hz = sung > 0 ? sung : 0
      const voiced = sung !== 0
      batched.push({ t: nextSampleT, hz, confidence: hz > 0 ? 1 : 0, rms: voiced ? 0.3 : 0.01, deviceId: DEVICE_ID })
      nextSampleT += hopMs
    }

    // The main process forwarding those frames to the renderer in batches.
    if (Date.now() - lastBatchAt >= batchMs && batched.length > 0) {
      lastBatchAt = Date.now()
      emitBatch(batched)
      batched = []
    }

    beatPosition.set(msToBeat(songMs, BPM, GAP))
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
  useStageStore.getState().setStatus('idle')

  unsubscribeHits()
  unsubscribe()

  // Every singer is scored against the same fixed party-karaoke-style ceiling.
  const maxScore = 10_000
  return { score: useScoreStore.getState().players.find((p) => p.playerId === 'p1')?.score ?? 0, tiers, maxScore }
}

// --- fake audio surface -------------------------------------------------

let batchHandler: ((payload: { deviceId: string; samples: PitchSample[] }) => void) | null = null
let virtualNow = 0

function setNow(ms: number) {
  virtualNow = ms
}

function emitBatch(samples: PitchSample[]) {
  batchHandler?.({ deviceId: DEVICE_ID, samples })
}

describe('live scoring, end to end', () => {
  beforeEach(() => {
    resetPitchBatchSubscriptionForTests()
    resetCaptureIntentsForTests()
    batchHandler = null
    virtualNow = 1_700_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => virtualNow)

    ;(window as unknown as { api: unknown }).api = {
      audio: {
        listDevices: () => Promise.resolve([{ id: DEVICE_ID, name: 'Test Mic', channelCount: 1, sampleRate: 48000 }]),
        requestPermission: () => Promise.resolve('granted'),
        getPermissionStatus: () => Promise.resolve('granted'),
        startCapture: () => Promise.resolve(),
        stopCapture: () => Promise.resolve(),
        startRawScope: () => Promise.resolve(),
        stopRawScope: () => Promise.resolve(),
        onPitchBatch: (callback: (payload: { deviceId: string; samples: PitchSample[] }) => void) => {
          batchHandler = callback
          return () => {
            batchHandler = null
          }
        },
        onDeviceListChanged: () => () => {},
        onRawScopeChunk: () => () => {},
      },
    }

    usePitchStore.setState({ devices: [], permissionStatus: 'granted', activeCaptures: {} })
    usePlayersStore.setState({ players: [{ id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' }] })
    useHitStore.getState().reset()
    useScoreStore.getState().reset({ players: [], combo: 0, rank: [] })
    useMicHealthStore.getState().reset()
    useCalibrationStore.setState({ settings: DEFAULT_CALIBRATION_SETTINGS })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetPitchBatchSubscriptionForTests()
    delete (window as unknown as { api?: unknown }).api
  })

  /**
   * The regression this whole investigation is about.
   *
   * Nothing here calls `startCapture` -- exactly like a real session, where the
   * only callers are Mic Check, Hardware Setup, Calibration, tap-to-identify
   * and the routing store's binding diff, none of which runs on the way into a
   * song. Before the fix `activeCaptures` stayed empty for the whole song,
   * every note judged 'awful' with the NO_SIGNAL sentinel, and the final score
   * was 0 with nothing anywhere explaining why.
   */
  it('scores an on-pitch singer even though nothing else started a capture', async () => {
    const { score, tiers, maxScore } = await runSong({ chart: buildChart(), singer: onPitchSinger })

    expect(score).toBeGreaterThan(0)
    expect(score).toBeGreaterThanOrEqual(0.95 * maxScore)
    expect(score).toBeLessThanOrEqual(maxScore)
    expect(tiers).toHaveLength(10)
    expect(tiers.every((tier) => tier === 'epic')).toBe(true)
    // The capture Gameplay had to start for itself.
    expect(Object.keys(usePitchStore.getState().activeCaptures)).toContain(DEVICE_ID)
  }, 30_000)

  it('scores an on-pitch singer on a capture Mic Check already started, without starting a second one', async () => {
    const { score, tiers } = await runSong({ chart: buildChart(), singer: onPitchSinger, preStartCapture: true })

    expect(score).toBeGreaterThan(0)
    expect(tiers.every((tier) => tier === 'epic')).toBe(true)
    expect(Object.keys(usePitchStore.getState().activeCaptures)).toEqual([DEVICE_ID])
  }, 30_000)

  it('scores silence at zero -- every note judged, none credited', async () => {
    const { score, tiers } = await runSong({ chart: buildChart(), singer: silentSinger })

    expect(score).toBe(0)
    expect(tiers).toHaveLength(10)
    expect(tiers.every((tier) => tier === 'awful')).toBe(true)
  }, 30_000)

  /**
   * Dropped frames are normal during video playback, and on a legato passage
   * (no rest between notes) a stutter puts two note ends in a single frame.
   * The frame loop used to clear its whole pending-sample buffer after judging
   * a note, so the second note of every such pair was judged on nothing at all
   * and scored 'awful' -- a third of the notes in this run.
   *
   * `preStartCapture` deliberately isolates this from the missing-capture bug
   * above: the mic is unambiguously live here, and the notes were still lost.
   */
  it('judges every note of a legato passage from its own samples, even through dropped frames', async () => {
    const { score, tiers, maxScore } = await runSong({
      chart: buildChart({ count: 12, gapBeats: 0 }),
      singer: onPitchSinger,
      preStartCapture: true,
      hitchEvery: 5,
      hitchFrames: 6,
    })

    expect(tiers).toHaveLength(12)
    expect(tiers.filter((tier) => tier === 'awful')).toHaveLength(0)
    expect(score).toBeGreaterThanOrEqual(0.9 * maxScore)
  }, 30_000)

  /**
   * Rap notes are pitch-free: a rapper whose consonants the detector cannot
   * pitch at all, but who is clearly making sound, must score -- and silence
   * on the same notes must not.
   */
  it('scores rap notes on voiced sound at any pitch, and not on silence', async () => {
    const rapChart = buildChart({ count: 6 })
    for (const note of rapChart.notes) note.kind = 'rap'

    const voiced = await runSong({ chart: rapChart, singer: rapper, preStartCapture: true })
    expect(voiced.score).toBeGreaterThan(0.9 * voiced.maxScore)
  }, 30_000)

  // The pause menu freezes the clock mid-note. Whatever the singer does while
  // it is up must not count -- here they sing the frozen note perfectly
  // through the whole pause and are silent otherwise.
  it('ignores everything sung while the song is paused', async () => {
    const singsOnlyWhilePaused: Singer = (songMs, chart, paused) => (paused ? onPitchSinger(songMs, chart, paused) : 0)
    const firstNoteMid = (0 + 1) * msPerBeat(BPM)

    const { score } = await runSong({
      chart: buildChart({ count: 4 }),
      singer: singsOnlyWhilePaused,
      preStartCapture: true,
      pause: { atMs: firstNoteMid, forMs: 1500 },
    })

    expect(score).toBe(0)
    expect(screen.getByTestId('pitch-line-wrap').style.opacity).toBe('0')
  }, 30_000)

  // Review finding: the clock buffer kept recording (now, frozenBeat) through
  // a pause, so a note's measured span included the whole pause (the menu plus
  // the 3 s resume lead-in): the beats around it were stretched over time
  // nobody could sing in and the note was under-credited -- or, past the 8 s
  // window, its start fell out of the buffer and the evidence-only fallback
  // paid the half-sung note in full.
  it.each([
    ['a short pause', 1500],
    ['a pause longer than the clock window', 9000],
  ])('scores a note paused mid-way the same as one that was not paused (%s)', async (_label, forMs) => {
    const chart = () => buildChart({ count: 3, length: 16, gapBeats: 4 })
    // Sings the first note's first half -- up to where the pause falls -- and
    // every other note in full: worth about half the first note either way.
    const singer: Singer = (songMs, c, isPaused) => {
      const beat = msToBeat(songMs, BPM, GAP)
      return beat >= 8 && beat < 16 ? 0 : onPitchSinger(songMs, c, isPaused)
    }
    const unpaused = await runSong({ chart: chart(), singer, preStartCapture: true })
    cleanup()
    resetPitchBatchSubscriptionForTests()
    resetCaptureIntentsForTests()
    usePitchStore.setState({ devices: [], permissionStatus: 'granted', activeCaptures: {} })
    useHitStore.getState().reset()
    useScoreStore.getState().reset({ players: [], combo: 0, rank: [] })

    // Mid-way through the first (16-beat, 960 ms) note.
    const paused = await runSong({
      chart: chart(),
      singer,
      preStartCapture: true,
      pause: { atMs: 8 * msPerBeat(BPM), forMs },
    })

    expect(unpaused.tiers).toEqual(['good', 'epic', 'epic'])
    expect(paused.tiers).toEqual(unpaused.tiers)
    expect(paused.score).toBe(unpaused.score)
  }, 60_000)

  it('scores silence on rap notes at zero', async () => {
    const rapChart = buildChart({ count: 6 })
    for (const note of rapChart.notes) note.kind = 'rap'

    const silent = await runSong({ chart: rapChart, singer: silentSinger, preStartCapture: true })
    expect(silent.score).toBe(0)
  }, 30_000)

  /**
   * `latest` keeps the last pitch forever -- silence never overwrites it. Drawn
   * as-is, the indicator froze on the last note sung and the "on pitch" spark
   * kept firing through every rest. Once the pitch is older than the stale
   * window the lane must hide it and tell the television nothing is being sung.
   */
  it('hides the pitch indicator once the singer has stopped, instead of freezing it', async () => {
    await runSong({ chart: buildChart({ count: 4 }), singer: firstNoteOnlySinger, preStartCapture: true })

    expect(screen.getByTestId('pitch-line-wrap').style.opacity).toBe('0')
    expect(screen.getByTestId('lane-sustain-fx').dataset.on).toBe('false')
    expect(readSingerPitches().find((pitch) => pitch.playerId === 'p1')).toBeUndefined()
  }, 30_000)

  /**
   * The other half of the fix: a singer whose mic genuinely cannot be started
   * must be *told*, not handed a silent column of zeroes that looks identical
   * to being off pitch.
   */
  it('shows the singer a warning instead of silently scoring zero when no capture can be started', async () => {
    ;(window as unknown as { api: { audio: { listDevices: () => Promise<unknown[]> } } }).api.audio.listDevices = () =>
      Promise.resolve([])

    render(<Gameplay meta={META} lines={buildChart().lines} beatPosition={motionValue(0)} />)
    await act(async () => {})

    const warning = await screen.findByTestId('mic-health-warning')
    expect(warning.dataset.micHealth).toBe('no-device')
    expect(warning.textContent).toMatch(/no microphone/i)
    expect(useMicHealthStore.getState().byPlayerId.p1?.status).toBe('no-device')
  })

  it('shows a warning when the capture key this lane reads has no capture running', async () => {
    // A routing binding pointing at a capture key nobody ever started -- the
    // exact shape of a Hardware Setup binding restored from disk without the
    // routing store's binding diff ever having run.
    ;(window as unknown as { api: { audio: { startCapture: () => Promise<void> } } }).api.audio.startCapture = () =>
      Promise.reject(new Error('device unavailable'))

    render(<Gameplay meta={META} lines={buildChart().lines} beatPosition={motionValue(0)} deviceId="ghost#1" />)
    await act(async () => {})

    const warning = await screen.findByTestId('mic-health-warning')
    expect(warning.dataset.micHealth).toBe('no-capture')
    expect(warning.textContent).toMatch(/not running/i)
  })

  it('reports a healthy mic with no warning once a capture is running', async () => {
    await usePitchStore.getState().startCapture(DEVICE_ID)
    render(<Gameplay meta={META} lines={buildChart().lines} beatPosition={motionValue(0)} />)
    await act(async () => {})

    expect(screen.queryByTestId('mic-health-warning')).toBeNull()
    expect(useMicHealthStore.getState().byPlayerId.p1?.status).toBe('ok')
  })

  it('leaves a capture it did not start running, and stops the one it did', async () => {
    const stopped: string[] = []
    ;(window as unknown as { api: { audio: { stopCapture: (id: string) => Promise<void> } } }).api.audio.stopCapture = (
      id: string,
    ) => {
      stopped.push(id)
      return Promise.resolve()
    }

    // Started by Gameplay -> stopped on unmount.
    const own = render(<Gameplay meta={META} lines={buildChart().lines} beatPosition={motionValue(0)} />)
    await act(async () => {})
    await act(async () => {
      own.unmount()
    })
    expect(stopped).toEqual([DEVICE_ID])

    // Started by someone else (Mic Check) -> left alone.
    stopped.length = 0
    await usePitchStore.getState().startCapture(DEVICE_ID)
    const borrowed = render(<Gameplay meta={META} lines={buildChart().lines} beatPosition={motionValue(0)} />)
    await act(async () => {})
    await act(async () => {
      borrowed.unmount()
    })
    expect(stopped).toEqual([])
  })

  /**
   * The failure observed in the running app: the mic went dead the instant a
   * song started, the lane showed "Microphone not running -- nothing is being
   * scored." for the whole song, and the hardware was fine the entire time.
   *
   * `startCapture` is awaited, and React StrictMode mounts, cleans up, and
   * mounts again. The first run resumed from its await *after* the second run
   * had started the capture, saw its own `cancelled` flag, and stopped the
   * capture the live run was depending on. Nothing in the suite caught it
   * because no test rendered Gameplay the way `main.tsx` actually does.
   */
  it('keeps the capture alive across a StrictMode remount, instead of the cancelled run stopping the live one', async () => {
    const calls: string[] = []
    let releaseFirstStart: () => void = () => {}
    const firstStart = new Promise<void>((resolve) => {
      releaseFirstStart = resolve
    })
    let startCount = 0

    const audio = (window as unknown as { api: { audio: Record<string, unknown> } }).api.audio
    audio.startCapture = (id: string) => {
      calls.push(`start:${id}`)
      startCount += 1
      // Only the first start is slow -- long enough for the remount to happen
      // underneath it, which is precisely the live timing.
      return startCount === 1 ? firstStart : Promise.resolve()
    }
    audio.stopCapture = (id: string) => {
      calls.push(`stop:${id}`)
      return Promise.resolve()
    }

    render(
      <StrictMode>
        <Gameplay meta={META} lines={buildChart().lines} beatPosition={motionValue(0)} deviceId={DEVICE_ID} />
      </StrictMode>,
    )
    await act(async () => {
      releaseFirstStart()
    })
    await act(async () => {})

    expect(usePitchStore.getState().activeCaptures[DEVICE_ID]).toBeDefined()
    expect(useMicHealthStore.getState().byPlayerId.p1?.status).toBe('ok')
    // And the native side agrees: whatever stops were issued, the last word for
    // this device is a start.
    expect(calls.filter((call) => call.endsWith(DEVICE_ID)).at(-1)).toBe(`start:${DEVICE_ID}`)
  })
})
