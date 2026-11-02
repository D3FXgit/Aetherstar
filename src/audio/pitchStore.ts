// Live pitch capture for every open mic, keyed by capture key (deviceId, or
// deviceId#channel).
import { create } from 'zustand'
import type { PitchSample } from '../contracts/types'
import * as api from './api'
import { deviceIdOfCaptureKey } from '../multiplayer/captureKey'
import type { AudioDevice, DeviceCaptureState, MicPermissionStatus } from './types'

/**
 * Below this detector confidence a frame is treated as unvoiced.
 *
 * `confidence` is YIN's `1 - cmndf(tau)` (native/src/pitch.rs). The native
 * detector no longer guesses: a frame with no dip under YIN's absolute
 * threshold (a breath, a consonant, room noise) is reported unvoiced, with
 * `hz` and `confidence` both 0. A voiced frame reads > 0.85 from the threshold
 * alone, and no lower than about 0.73 when octave-error suppression swaps in a
 * half/double-period candidate. So in practice this gate only separates
 * unvoiced (0) from voiced frames; it stays as a floor against any future
 * detector change that reports low-confidence guesses again.
 */
export const MIN_PITCH_CONFIDENCE = 0.5

/**
 * RMS (0..1) above which a frame counts as the singer making a sound, pitched
 * or not -- what rap notes are scored on. Matches the mic monitor's gate-open
 * level (native/src/monitor.rs GATE_OPEN_LEVEL), i.e. "clearly more than room
 * noise".
 */
export const VOICED_RMS_GATE = 0.02

/**
 * How old the newest pitched sample may be before it no longer describes what
 * the singer is doing *now*. `latest` keeps the last pitch forever (silence
 * never overwrites it), so a consumer drawing a live indicator or firing
 * "on pitch" feedback must check `latestAt` against this.
 */
export const STALE_PITCH_MS = 150

/**
 * How often, at most, the per-capture summary in zustand (`activeCaptures`)
 * is republished. Batches arrive up to ~100 times a second per mic (and up to
 * 8 mics); publishing each one re-ran every `activeCaptures` selector in the
 * app and allocated a fresh state tree hundreds of times a second. Meters and
 * the tuner read fine at ~30 Hz. The sample history itself is never
 * throttled -- it lives in the mutable `CaptureStream` below.
 */
export const STATE_FLUSH_INTERVAL_MS = 33

/**
 * A frame the native detector found no pitch in arrives with hz = 0 (see
 * electron/audio/native-bridge.cjs). It still carries a real `rms`, so it
 * feeds the level meters -- but it is not a pitch observation and must never
 * reach `latest`/`samples`, where scoring, calibration and the tuner would
 * read it as a sung 0 Hz. A frame below `MIN_PITCH_CONFIDENCE` is treated the
 * same way: unvoiced.
 */
function isPitched(sample: PitchSample): boolean {
  if (!(Number.isFinite(sample.hz) && sample.hz > 0)) return false
  // Hand-built fixtures predating the field may omit it; trust their pitch.
  const confidence = sample.confidence
  return typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence >= MIN_PITCH_CONFIDENCE
}

/** Pitched, or loud enough to be the singer making a sound at all. */
function isVoiced(sample: PitchSample): boolean {
  if (isPitched(sample)) return true
  return Number.isFinite(sample.rms) && (sample.rms as number) >= VOICED_RMS_GATE
}

/**
 * How many pitched samples one capture keeps.
 *
 * This was unbounded. Frames arrive roughly every 30 ms, so a 4-minute song
 * ended holding ~24,000 live sample objects per singer and reallocating a
 * 24,000-element array about 20 times a second -- a cost that grows through the
 * song and peaks exactly when the app is busiest. Nothing needs the full
 * history: gameplay drains it every frame, and calibration only wants the last
 * few seconds of taps.
 *
 * 2048 is ~60 s of audio, which is far more than either consumer reads and
 * still a fixed, small ceiling.
 */
export const MAX_CAPTURE_SAMPLES = 2048

/**
 * One capture's live sample history, kept OUTSIDE React/zustand state.
 *
 * Every array here is mutated in place -- appended on each batch, trimmed from
 * the front past the cap -- so a batch costs a push, not a copy of up to 2048
 * samples (the old `[...existing, ...incoming].slice()` ran ~280 times a second
 * at 8 singers and was a steady GC source). Readers track their position with
 * the absolute counters: index into `samples` = absoluteIndex - `dropped`.
 */
export interface CaptureStream {
  /** Pitched, confident samples, oldest first, at most MAX_CAPTURE_SAMPLES. The same array as the zustand entry's `samples`. */
  readonly samples: PitchSample[]
  /** How many samples have been evicted from the front of `samples` since the capture started. */
  dropped: number
  /** Voiced frames at any pitch (pitched, or RMS >= VOICED_RMS_GATE), oldest first, same cap -- what rap notes score on. */
  readonly voiced: PitchSample[]
  /** How many frames have been evicted from the front of `voiced`. */
  voicedDropped: number
  /** Newest pitched sample, or null. Never cleared by silence -- check `latestAt`. */
  latest: PitchSample | null
  /** Date.now() when `latest` arrived; 0 before any pitched sample. */
  latestAt: number
  /** Bumped once per batch received (pitched or not): a cheap "anything new?" check. */
  seq: number
  /** Date.now() when the newest batch arrived; 0 before any. */
  lastBatchAt: number
  /** Date.now() - t of the newest frame when it arrived, or null before any. */
  latencyMs: number | null
  /** RMS of the newest frame, 0..1. */
  level: number
}

const captureStreams = new Map<string, CaptureStream>()

function createCaptureStream(): CaptureStream {
  return {
    samples: [],
    dropped: 0,
    voiced: [],
    voicedDropped: 0,
    latest: null,
    latestAt: 0,
    seq: 0,
    lastBatchAt: 0,
    latencyMs: null,
    level: 0,
  }
}

/** Push `incoming` onto `target` in place, trimming the front past the cap (a memmove, no copy of the survivors). Returns how many were evicted. */
function appendInPlace(target: PitchSample[], incoming: PitchSample[]): number {
  for (let i = 0; i < incoming.length; i += 1) target.push(incoming[i])
  if (target.length <= MAX_CAPTURE_SAMPLES) return 0
  const evict = target.length - MAX_CAPTURE_SAMPLES
  target.splice(0, evict)
  return evict
}

/**
 * The live, mutable sample history for `captureKey`, or undefined when no
 * capture is running under it. Read it every frame; never copy it.
 */
export function getCaptureStream(captureKey: string): CaptureStream | undefined {
  return captureStreams.get(captureKey)
}

/** `stream.latest` if it is fresher than STALE_PITCH_MS, else null. */
export function freshLatestPitch(stream: Pick<CaptureStream, 'latest' | 'latestAt'>, now: number = Date.now()): PitchSample | null {
  if (!stream.latest) return null
  return now - stream.latestAt <= STALE_PITCH_MS ? stream.latest : null
}

function summaryOf(stream: CaptureStream): DeviceCaptureState {
  return {
    latest: stream.latest,
    // The live array itself, not a copy: readers of the zustand entry always
    // see every sample, even between throttled republishes.
    samples: stream.samples,
    droppedSamples: stream.dropped,
    latencyMs: stream.latencyMs,
    level: stream.level,
    levelAt: stream.lastBatchAt,
  }
}

const dirtyCaptureKeys = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let lastFlushAt = Number.NEGATIVE_INFINITY

/** Republish every dirty capture's summary into zustand in ONE set(). */
function flushCaptureSummaries(): void {
  lastFlushAt = Date.now()
  if (dirtyCaptureKeys.size === 0) return
  const keys = [...dirtyCaptureKeys]
  dirtyCaptureKeys.clear()
  usePitchStore.setState((state) => {
    let next: Record<string, DeviceCaptureState> | null = null
    for (const key of keys) {
      const stream = captureStreams.get(key)
      // Stopped (or replaced) while the flush was pending: leave the map alone.
      if (!stream || !state.activeCaptures[key]) continue
      next ??= { ...state.activeCaptures }
      next[key] = summaryOf(stream)
    }
    return next ? { activeCaptures: next } : state
  })
}

/** Leading-edge throttle: publish now if the last publish is old enough, else once the interval has passed. */
function scheduleSummaryFlush(captureKey: string): void {
  dirtyCaptureKeys.add(captureKey)
  if (flushTimer !== null) return
  const sinceLast = Date.now() - lastFlushAt
  if (sinceLast >= STATE_FLUSH_INTERVAL_MS) {
    flushCaptureSummaries()
    return
  }
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushCaptureSummaries()
  }, STATE_FLUSH_INTERVAL_MS - sinceLast)
}

/** Publish any pending capture summary right now. For tests, and for callers that must read a settled store. */
export function flushPitchStoreNow(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  flushCaptureSummaries()
}

type BatchHandler = (payload: { deviceId: string; samples: PitchSample[] }) => void

/**
 * One native pitch-batch listener, shared by reference count.
 *
 * Without this the store had to choose between two broken options: open a
 * listener per caller and have every sample appended once per mounted
 * subscriber, or subscribe from a single screen and have *no* subscriber
 * during a song -- which is what shipped. `subscribeToEvents` is only called
 * by Mic Check, Hardware Setup, Calibration and the Dev Lab, none of which is
 * mounted during `session-play`, so `latest`/`samples` stayed empty for the
 * whole of gameplay and nothing was ever scored.
 *
 * Sharing the listener makes an app-lifetime subscription safe to hold
 * alongside any number of per-screen ones.
 */
let subscriberCount = 0
let activeBatchHandler: BatchHandler | null = null
let releaseNativeBatch: (() => void) | null = null

/**
 * Drop the shared listener and every handler on it.
 *
 * For tests only. The subscription is a module-level singleton that
 * deliberately outlives any React tree, so it also outlives a test's
 * `window.api` stub -- without this, one test's live handler keeps the
 * listener open and the next test's stub is never subscribed to.
 */
export function resetPitchBatchSubscriptionForTests(): void {
  subscriberCount = 0
  activeBatchHandler = null
  releaseNativeBatch?.()
  releaseNativeBatch = null
  if (flushTimer !== null) clearTimeout(flushTimer)
  flushTimer = null
  lastFlushAt = Number.NEGATIVE_INFINITY
  dirtyCaptureKeys.clear()
}

function subscribeToBatches(handler: BatchHandler): () => void {
  subscriberCount += 1

  // Every caller passes the same store-updating handler, so exactly one of
  // them is installed. Refcounting only the *native listener* would not be
  // enough: two identical handlers on one listener still append every sample
  // twice, which is the very double-count this exists to prevent.
  if (releaseNativeBatch === null) {
    activeBatchHandler = handler
    releaseNativeBatch = api.onPitchBatch((payload) => activeBatchHandler?.(payload))
  }

  let released = false
  return () => {
    // React 18 StrictMode invokes an effect's cleanup twice; decrementing
    // twice would tear the listener out from under the other subscribers.
    if (released) return
    released = true

    subscriberCount -= 1
    if (subscriberCount === 0) {
      releaseNativeBatch?.()
      releaseNativeBatch = null
      activeBatchHandler = null
    }
  }
}

/**
 * Per capture key: the tail of the serialized start/stop chain, and the
 * sequence number of the most recently *issued* intent for that key.
 *
 * `startCapture`/`stopCapture` are async IPC round-trips that each mutate
 * `activeCaptures` only *after* their own await resolves. Nothing kept two
 * calls for the same key from overlapping, so the surviving state was whichever
 * round-trip happened to finish last -- not whichever was asked for last.
 *
 * That is not theoretical. Entering a song issues, within ~15 ms: Gameplay's
 * capture-guarantee start, the mic-routing store's teardown stop, React
 * StrictMode's remounted start, and the routing store's rebind start. Observed
 * in the running app, the *first* run's cancelled-cleanup stop resolved ~90 ms
 * after the later starts, deleted the entry they had just created, and stopped
 * the native stream -- so the singer's lane read an empty `activeCaptures`,
 * judged every note 'awful', and the app showed "Microphone not running" for
 * the whole song with a mic that was perfectly healthy.
 *
 * Two guarantees fix it, and both are needed:
 *  - the chain makes the *native* calls run in the order they were issued, so
 *    the audio thread ends in the last-issued state rather than a coin flip;
 *  - the sequence check makes a superseded call leave `activeCaptures` alone,
 *    so renderer state ends in that same last-issued state.
 */
const captureChains = new Map<string, Promise<unknown>>()
const captureIntents = new Map<string, number>()
let intentCounter = 0

/**
 * Drop the per-key intent bookkeeping.
 *
 * For tests only, and for the same reason `resetPitchBatchSubscriptionForTests`
 * exists: these are module-level singletons that outlive any one test's
 * `window.api` stub, and a chain still holding a previous test's unresolved
 * promise would stall the next test's first capture forever.
 */
export function resetCaptureIntentsForTests(): void {
  captureChains.clear()
  captureIntents.clear()
  intentCounter = 0
  captureStreams.clear()
}

/** Claim `captureKey`'s newest intent, returning the token to check afterwards. */
function issueIntent(captureKey: string): number {
  intentCounter += 1
  captureIntents.set(captureKey, intentCounter)
  return intentCounter
}

/** Run `task` after every start/stop already queued for `captureKey`. */
function enqueueForKey<T>(captureKey: string, task: () => Promise<T>): Promise<T> {
  const tail = captureChains.get(captureKey) ?? Promise.resolve()
  const run = tail.then(task)
  // The stored tail must never reject: it is only a barrier for the *next*
  // call, and a failed start must not poison every later start of that device.
  // The rejection still reaches this call's own caller through `run`.
  const barrier = run.then(
    () => {},
    () => {},
  )
  captureChains.set(captureKey, barrier)
  void barrier.then(() => {
    // Only the last call for this key clears it, so a key that is toggled all
    // night does not accumulate a chain of settled promises.
    if (captureChains.get(captureKey) === barrier) captureChains.delete(captureKey)
  })
  return run
}

interface PitchStoreState {
  devices: AudioDevice[]
  permissionStatus: MicPermissionStatus
  activeCaptures: Record<string, DeviceCaptureState>
  refreshDevices: () => Promise<void>
  requestPermission: () => Promise<void>
  startCapture: (deviceId: string) => Promise<void>
  stopCapture: (deviceId: string) => Promise<void>
  /** Pitch batches *and* device changes; what a screen driving live meters wants. */
  subscribeToEvents: () => () => void
  /**
   * Device changes only.
   *
   * Split out from `subscribeToEvents` so the shell can watch for disconnects
   * for the whole life of the app -- crucially during a song, when none of the
   * screens that call `subscribeToEvents` is mounted. It must stay
   * batch-free: a second pitch-batch listener would append every sample twice
   * whenever one of those screens is also up. The handler is idempotent, so
   * overlapping subscriptions are safe.
   */
  subscribeToDeviceEvents: () => () => void
}

export const usePitchStore = create<PitchStoreState>((set, get) => ({
  devices: [],
  permissionStatus: 'not-determined',
  activeCaptures: {},

  refreshDevices: async () => {
    set({ devices: await api.listDevices() })
  },

  requestPermission: async () => {
    set({ permissionStatus: await api.requestPermission() })
  },

  startCapture: async (deviceId) => {
    const intent = issueIntent(deviceId)
    await enqueueForKey(deviceId, () => api.startCapture(deviceId))
    // Superseded while the IPC was in flight: a later stop (or start) owns this
    // key's state now, and writing here would resurrect a capture the caller
    // has already asked to end.
    if (captureIntents.get(deviceId) !== intent) return
    const stream = createCaptureStream()
    captureStreams.set(deviceId, stream)
    set((state) => ({ activeCaptures: { ...state.activeCaptures, [deviceId]: summaryOf(stream) } }))
  },

  stopCapture: async (deviceId) => {
    const intent = issueIntent(deviceId)
    await enqueueForKey(deviceId, () => api.stopCapture(deviceId))
    // The case this store was actually losing: a stale stop resolving after the
    // start that replaced it. Deleting here would take the live capture with it.
    if (captureIntents.get(deviceId) !== intent) return
    captureStreams.delete(deviceId)
    dirtyCaptureKeys.delete(deviceId)
    set((state) => {
      const next = { ...state.activeCaptures }
      delete next[deviceId]
      return { activeCaptures: next }
    })
  },

  subscribeToEvents: () => {
    const unsubBatch = subscribeToBatches(({ deviceId, samples }) => {
      const latestFrame = samples[samples.length - 1]
      if (!latestFrame) return
      // A batch can arrive just after stopCapture() removed this device's
      // entry (in flight when stop was called) -- ignore it rather than
      // resurrect a capture the caller already stopped. An entry seeded by
      // hand (tests, labs) without a stream gets one lazily.
      if (!get().activeCaptures[deviceId]) return
      let stream = captureStreams.get(deviceId)
      if (!stream) {
        stream = createCaptureStream()
        captureStreams.set(deviceId, stream)
      }

      // Split once, here: every frame carries a level, only pitched frames are
      // pitch observations. Pushed in place -- no per-batch array copies.
      const now = Date.now()
      let pitched: PitchSample[] | null = null
      let voiced: PitchSample[] | null = null
      for (let i = 0; i < samples.length; i += 1) {
        const frame = samples[i]
        if (isPitched(frame)) {
          ;(pitched ??= []).push(frame)
          ;(voiced ??= []).push(frame)
        } else if (isVoiced(frame)) {
          ;(voiced ??= []).push(frame)
        }
      }
      if (pitched) {
        stream.dropped += appendInPlace(stream.samples, pitched)
        stream.latest = pitched[pitched.length - 1]
        stream.latestAt = now
      }
      if (voiced) stream.voicedDropped += appendInPlace(stream.voiced, voiced)
      stream.seq += 1
      stream.lastBatchAt = now
      stream.latencyMs = now - latestFrame.t
      stream.level = Number.isFinite(latestFrame.rms) ? Math.max(0, latestFrame.rms as number) : 0

      scheduleSummaryFlush(deviceId)
    })

    const unsubDeviceList = get().subscribeToDeviceEvents()

    return () => {
      unsubBatch()
      unsubDeviceList()
    }
  },

  subscribeToDeviceEvents: () =>
    api.onDeviceListChanged(({ devices }) => {
      // Someone tripped over the cable. The device list is the authority on
      // what hardware exists, so any capture whose device is no longer in it is
      // capturing from nothing and has to go: `activeCaptures` is read as "how
      // many mics are live" (MicStatusPill) and as the gate on the whole
      // gameplay overlay (Sing), and a leftover entry makes both of them report
      // a mic that is lying on the floor.
      const presentDeviceIds = new Set(devices.map((device) => device.id))
      const lostKeys = Object.keys(get().activeCaptures).filter(
        (captureKey) => !presentDeviceIds.has(deviceIdOfCaptureKey(captureKey)),
      )

      lostKeys.forEach((captureKey) => {
        captureStreams.delete(captureKey)
        dirtyCaptureKeys.delete(captureKey)
      })
      set((state) => {
        if (lostKeys.length === 0) return { devices }
        const activeCaptures = { ...state.activeCaptures }
        lostKeys.forEach((captureKey) => delete activeCaptures[captureKey])
        return { devices, activeCaptures }
      })

      // Best-effort and un-awaited: the native stream is already gone, so this
      // is only bookkeeping to keep main and renderer agreeing, and a rejection
      // from it must never stop the store shedding a capture that cannot work.
      // (The null-`times` sentinel in electron/audio/ipc-handlers.cjs has
      // already stopped the stream; the device-watcher poll path has not.)
      lostKeys.forEach((captureKey) => {
        void Promise.resolve(api.stopCapture(captureKey)).catch(() => {})
      })
    }),
}))
