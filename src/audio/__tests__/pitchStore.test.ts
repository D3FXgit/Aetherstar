import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import type { PitchSample } from '../../contracts/types'
import {
  flushPitchStoreNow,
  freshLatestPitch,
  getCaptureStream,
  MAX_CAPTURE_SAMPLES,
  MIN_PITCH_CONFIDENCE,
  resetCaptureIntentsForTests,
  resetPitchBatchSubscriptionForTests,
  STALE_PITCH_MS,
  STATE_FLUSH_INTERVAL_MS,
  usePitchStore,
  VOICED_RMS_GATE,
} from '../pitchStore'
import type { DeviceListChangedPayload } from '../types'

const MIC_1 = { id: 'mic-1', name: 'USB Mic', channelCount: 1, sampleRate: 48000 }
const MIC_2 = { id: 'mic-2', name: 'Interface In 1', channelCount: 1, sampleRate: 48000 }

function sample(deviceId: string, t: number, hz = 220, rms = 0.25) {
  return { t, hz, confidence: 0.9, deviceId, rms }
}

/** What the native side emits for a live but silent input: no pitch, real level. */
function levelOnlyFrame(deviceId: string, t: number, rms: number) {
  return { t, hz: 0, confidence: 0, deviceId, rms }
}

describe('usePitchStore', () => {
  let batchCallback: ((payload: { deviceId: string; samples: PitchSample[] }) => void) | null
  let deviceListCallback: ((payload: DeviceListChangedPayload) => void) | null

  beforeEach(() => {
    // The batch listener is a module-level singleton shared by reference
    // count, so it survives between tests along with the previous test's
    // window.api stub. Drop it before each test installs a fresh one.
    resetPitchBatchSubscriptionForTests()
    resetCaptureIntentsForTests()
    batchCallback = null
    deviceListCallback = null
    window.api = {
      audio: {
        listDevices: vi.fn().mockResolvedValue([MIC_1, MIC_2]),
        requestPermission: vi.fn().mockResolvedValue('granted'),
        getPermissionStatus: vi.fn().mockResolvedValue('granted'),
        startCapture: vi.fn().mockResolvedValue(undefined),
        stopCapture: vi.fn().mockResolvedValue(undefined),
        startRawScope: vi.fn().mockResolvedValue(undefined),
        stopRawScope: vi.fn().mockResolvedValue(undefined),
        onPitchBatch: vi.fn((cb) => {
          batchCallback = cb
          return () => {}
        }),
        onDeviceListChanged: vi.fn((cb) => {
          deviceListCallback = cb
          return () => {}
        }),
        onRawScopeChunk: vi.fn().mockReturnValue(() => {}),
      },
    } as unknown as Window['api']

    usePitchStore.setState({ devices: [], permissionStatus: 'not-determined', activeCaptures: {} })
  })

  it('refreshDevices populates devices', async () => {
    await act(async () => {
      await usePitchStore.getState().refreshDevices()
    })
    expect(usePitchStore.getState().devices).toEqual([MIC_1, MIC_2])
  })

  it('startCapture calls through and seeds an empty capture state for that device', async () => {
    await act(async () => {
      await usePitchStore.getState().startCapture(MIC_1.id)
    })
    expect(window.api!.audio.startCapture).toHaveBeenCalledWith(MIC_1.id)
    expect(usePitchStore.getState().activeCaptures[MIC_1.id]).toEqual({
      latest: null,
      samples: [],
      latencyMs: null,
      level: 0,
      levelAt: 0,
      droppedSamples: 0,
    })
  })

  /**
   * The live failure this pair of tests exists for.
   *
   * Entering a song issues, within ~15 ms, a start from Gameplay's
   * capture-guarantee effect, a stop from the mic-routing store's teardown, a
   * second start from React StrictMode's remount, and a rebind start from the
   * routing store. Every one of those mutated `activeCaptures` only after its
   * own IPC round-trip resolved, so the surviving state was whichever call
   * happened to finish last. In the running app the first, already-cancelled
   * stop resolved ~90 ms after the starts that replaced it, deleted the live
   * entry and stopped the native stream: the song ran to the end scoring
   * nothing, under a "Microphone not running" warning, on a healthy mic.
   */
  describe('overlapping start/stop for one capture key', () => {
    it('keeps the capture a later startCapture asked for when an earlier stopCapture resolves late', async () => {
      await act(async () => {
        await usePitchStore.getState().startCapture(MIC_1.id)
      })

      // The stop's IPC hangs until we let it go -- the start issued after it
      // therefore has every chance to land first, exactly as it did live.
      let releaseStop: () => void = () => {}
      vi.mocked(window.api!.audio.stopCapture).mockReturnValueOnce(
        new Promise<void>((resolve) => {
          releaseStop = resolve
        }),
      )

      await act(async () => {
        const stopping = usePitchStore.getState().stopCapture(MIC_1.id)
        const starting = usePitchStore.getState().startCapture(MIC_1.id)
        releaseStop()
        await Promise.all([stopping, starting])
      })

      // The last thing anyone asked for was "capture MIC_1", so MIC_1 is captured.
      expect(usePitchStore.getState().activeCaptures[MIC_1.id]).toBeDefined()
    })

    it('runs the native calls for one key in the order they were issued, so the audio thread ends in the last-asked-for state', async () => {
      const calls: string[] = []
      vi.mocked(window.api!.audio.stopCapture).mockImplementation(() => {
        calls.push('stop')
        // Slow, like a real IPC round-trip that has to tear a stream down.
        return new Promise<void>((resolve) => setTimeout(resolve, 0))
      })
      vi.mocked(window.api!.audio.startCapture).mockImplementation(() => {
        calls.push('start')
        return Promise.resolve()
      })

      await act(async () => {
        await Promise.all([
          usePitchStore.getState().startCapture(MIC_1.id),
          usePitchStore.getState().stopCapture(MIC_1.id),
          usePitchStore.getState().startCapture(MIC_1.id),
        ])
      })

      expect(calls).toEqual(['start', 'stop', 'start'])
      expect(usePitchStore.getState().activeCaptures[MIC_1.id]).toBeDefined()
    })

    it('does not let one device queue block another', async () => {
      let releaseMic1: () => void = () => {}
      vi.mocked(window.api!.audio.startCapture).mockImplementation((deviceId: string) =>
        deviceId === MIC_1.id
          ? new Promise<void>((resolve) => {
              releaseMic1 = resolve
            })
          : Promise.resolve(),
      )

      const stalled = usePitchStore.getState().startCapture(MIC_1.id)
      await act(async () => {
        await usePitchStore.getState().startCapture(MIC_2.id)
      })

      expect(usePitchStore.getState().activeCaptures[MIC_2.id]).toBeDefined()
      await act(async () => {
        releaseMic1()
        await stalled
      })
    })

    it('lets a device recover after a failed start instead of wedging its queue', async () => {
      vi.mocked(window.api!.audio.startCapture)
        .mockRejectedValueOnce(new Error('device busy'))
        .mockResolvedValue(undefined)

      await expect(usePitchStore.getState().startCapture(MIC_1.id)).rejects.toThrow('device busy')
      await act(async () => {
        await usePitchStore.getState().startCapture(MIC_1.id)
      })

      expect(usePitchStore.getState().activeCaptures[MIC_1.id]).toBeDefined()
    })
  })

  it('a pitch batch for one device only updates that device entry', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000)
    usePitchStore.getState().subscribeToEvents()

    await act(async () => {
      await usePitchStore.getState().startCapture(MIC_1.id)
      await usePitchStore.getState().startCapture(MIC_2.id)
    })

    act(() => {
      batchCallback?.({ deviceId: MIC_1.id, samples: [sample(MIC_1.id, 1900, 220)] })
    })

    const state = usePitchStore.getState()
    expect(state.activeCaptures[MIC_1.id]?.latest).toEqual(sample(MIC_1.id, 1900, 220))
    expect(state.activeCaptures[MIC_1.id]?.latencyMs).toBe(100)
    expect(state.activeCaptures[MIC_2.id]).toEqual({ latest: null, samples: [], latencyMs: null, level: 0, levelAt: 0, droppedSamples: 0 })

    vi.restoreAllMocks()
  })

  it('records the level of the last frame in a batch', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000)
    usePitchStore.getState().subscribeToEvents()
    await act(async () => {
      await usePitchStore.getState().startCapture(MIC_1.id)
    })

    act(() => {
      batchCallback?.({
        deviceId: MIC_1.id,
        samples: [sample(MIC_1.id, 1900, 220, 0.1), sample(MIC_1.id, 1930, 221, 0.44)],
      })
    })

    expect(usePitchStore.getState().activeCaptures[MIC_1.id]?.level).toBeCloseTo(0.44, 6)
    expect(usePitchStore.getState().activeCaptures[MIC_1.id]?.levelAt).toBe(2000)

    vi.restoreAllMocks()
  })

  it('a level-only frame updates the level without entering the pitch stream', async () => {
    // A live-but-silent mic emits nothing but these. They have to move the
    // meter, and they must never reach latest/samples -- scoring, calibration
    // and the tuner would read hz: 0 as a sung note.
    vi.spyOn(Date, 'now').mockReturnValue(2000)
    usePitchStore.getState().subscribeToEvents()
    await act(async () => {
      await usePitchStore.getState().startCapture(MIC_1.id)
    })

    act(() => {
      batchCallback?.({ deviceId: MIC_1.id, samples: [sample(MIC_1.id, 1800, 220, 0.5)] })
    })
    act(() => {
      batchCallback?.({ deviceId: MIC_1.id, samples: [levelOnlyFrame(MIC_1.id, 1900, 0.004)] })
      // The second batch landed inside the summary's throttle window.
      flushPitchStoreNow()
    })

    const capture = usePitchStore.getState().activeCaptures[MIC_1.id]
    expect(capture?.level).toBeCloseTo(0.004, 6)
    expect(capture?.latest).toEqual(sample(MIC_1.id, 1800, 220, 0.5))
    expect(capture?.samples).toEqual([sample(MIC_1.id, 1800, 220, 0.5)])

    vi.restoreAllMocks()
  })

  it('a batch of nothing but level-only frames still refreshes the level and latency', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000)
    usePitchStore.getState().subscribeToEvents()
    await act(async () => {
      await usePitchStore.getState().startCapture(MIC_1.id)
    })

    act(() => {
      batchCallback?.({
        deviceId: MIC_1.id,
        samples: [levelOnlyFrame(MIC_1.id, 1870, 0.002), levelOnlyFrame(MIC_1.id, 1900, 0.003)],
      })
    })

    const capture = usePitchStore.getState().activeCaptures[MIC_1.id]
    expect(capture?.level).toBeCloseTo(0.003, 6)
    expect(capture?.latencyMs).toBe(100)
    expect(capture?.latest).toBeNull()
    expect(capture?.samples).toEqual([])

    vi.restoreAllMocks()
  })

  it('treats a frame with no rms as silence rather than letting undefined reach a meter', async () => {
    // Fixture and mock samples predate the rms field; a meter must not read NaN.
    usePitchStore.getState().subscribeToEvents()
    await act(async () => {
      await usePitchStore.getState().startCapture(MIC_1.id)
    })

    act(() => {
      batchCallback?.({ deviceId: MIC_1.id, samples: [{ t: 1900, hz: 220, confidence: 0.9, deviceId: MIC_1.id }] })
    })

    expect(usePitchStore.getState().activeCaptures[MIC_1.id]?.level).toBe(0)
  })

  describe('when a device disappears mid-stream', () => {
    it('drops the vanished device capture and keeps every surviving one', async () => {
      // The regression: the handler used to `set({ devices })` and nothing
      // else, so activeCaptures kept an entry for hardware that is physically
      // gone. MicStatusPill counts that map ("2 MICS LIVE" with one mic
      // unplugged) and Sing gates the whole gameplay overlay on it being
      // non-empty, so a stale entry is a lie both of them repeat.
      usePitchStore.getState().subscribeToEvents()
      await act(async () => {
        await usePitchStore.getState().startCapture(MIC_1.id)
        await usePitchStore.getState().startCapture(MIC_2.id)
      })

      act(() => {
        deviceListCallback?.({ devices: [MIC_2], added: [], removed: [MIC_1] })
      })

      const state = usePitchStore.getState()
      expect(state.activeCaptures[MIC_1.id]).toBeUndefined()
      expect(state.activeCaptures[MIC_2.id]).toBeDefined()
      expect(state.devices).toEqual([MIC_2])
    })

    it('drops every channel of a multi-channel interface that vanished', async () => {
      // An 8-in interface is one device id behind up to eight capture keys.
      // Losing the box has to take all of its channels down, not just the
      // bare channel-0 key that happens to equal the device id.
      usePitchStore.getState().subscribeToEvents()
      await act(async () => {
        await usePitchStore.getState().startCapture(MIC_1.id)
        await usePitchStore.getState().startCapture(`${MIC_1.id}#1`)
        await usePitchStore.getState().startCapture(MIC_2.id)
      })

      act(() => {
        deviceListCallback?.({ devices: [MIC_2], added: [], removed: [MIC_1] })
      })

      expect(Object.keys(usePitchStore.getState().activeCaptures)).toEqual([MIC_2.id])
    })

    it('releases the native stream for each dropped capture key', async () => {
      // The device-watcher poll path never told the native side to stop --
      // only the null-`times` sentinel path did. Both have to converge on a
      // released stream, or a reconnect restarts a capture the native layer
      // still believes is running.
      usePitchStore.getState().subscribeToEvents()
      await act(async () => {
        await usePitchStore.getState().startCapture(`${MIC_1.id}#1`)
      })
      vi.mocked(window.api!.audio.stopCapture).mockClear()

      await act(async () => {
        deviceListCallback?.({ devices: [MIC_2], added: [], removed: [MIC_1] })
      })

      expect(window.api!.audio.stopCapture).toHaveBeenCalledWith(`${MIC_1.id}#1`)
    })

    it('leaves captures alone when the change only added a device', async () => {
      usePitchStore.getState().subscribeToEvents()
      await act(async () => {
        await usePitchStore.getState().startCapture(MIC_1.id)
      })
      vi.mocked(window.api!.audio.stopCapture).mockClear()

      act(() => {
        deviceListCallback?.({ devices: [MIC_1, MIC_2], added: [MIC_2], removed: [] })
      })

      expect(usePitchStore.getState().activeCaptures[MIC_1.id]).toBeDefined()
      expect(window.api!.audio.stopCapture).not.toHaveBeenCalled()
    })

    it('tears down through subscribeToDeviceEvents alone, with no pitch-batch listener', async () => {
      // The shell watches for disconnects for the whole life of the app --
      // including during a song, when nothing calls subscribeToEvents. It has
      // to be able to do that without a second batch listener, which would
      // append every sample twice while Mic Check or Hardware & Setup is open.
      usePitchStore.getState().subscribeToDeviceEvents()
      await act(async () => {
        await usePitchStore.getState().startCapture(MIC_1.id)
      })

      expect(window.api!.audio.onPitchBatch).not.toHaveBeenCalled()

      act(() => {
        deviceListCallback?.({ devices: [MIC_2], added: [], removed: [MIC_1] })
      })

      expect(usePitchStore.getState().activeCaptures[MIC_1.id]).toBeUndefined()
    })

    it('is idempotent across overlapping subscriptions', async () => {
      // The shell's subscription and a screen's own both run on the same
      // event. The second pass must find nothing left to do rather than
      // stopping the capture twice.
      usePitchStore.getState().subscribeToDeviceEvents()
      const secondCallback = deviceListCallback
      usePitchStore.getState().subscribeToDeviceEvents()

      await act(async () => {
        await usePitchStore.getState().startCapture(MIC_1.id)
      })
      vi.mocked(window.api!.audio.stopCapture).mockClear()

      act(() => {
        deviceListCallback?.({ devices: [], added: [], removed: [MIC_1] })
        secondCallback?.({ devices: [], added: [], removed: [MIC_1] })
      })

      expect(window.api!.audio.stopCapture).toHaveBeenCalledTimes(1)
      expect(usePitchStore.getState().activeCaptures).toEqual({})
    })

    it('survives a payload that reports no devices at all without throwing', async () => {
      usePitchStore.getState().subscribeToEvents()
      await act(async () => {
        await usePitchStore.getState().startCapture(MIC_1.id)
      })

      act(() => {
        deviceListCallback?.({ devices: [], added: [], removed: [MIC_1] })
      })

      expect(usePitchStore.getState().activeCaptures).toEqual({})
    })
  })

  it('stopCapture removes only that device entry', async () => {
    await act(async () => {
      await usePitchStore.getState().startCapture(MIC_1.id)
      await usePitchStore.getState().startCapture(MIC_2.id)
    })

    await act(async () => {
      await usePitchStore.getState().stopCapture(MIC_1.id)
    })

    const state = usePitchStore.getState()
    expect(state.activeCaptures[MIC_1.id]).toBeUndefined()
    expect(state.activeCaptures[MIC_2.id]).toBeDefined()
    expect(window.api!.audio.stopCapture).toHaveBeenCalledWith(MIC_1.id)
  })

  // `samples` was an unbounded `[...existing, ...new]` append. Measured through
  // the real reducer, a 4-minute song ended with ~24,000 live sample objects and
  // a 24,000-element array being reallocated ~20x/s -- superlinear cost that
  // arrives exactly when the app is busiest. Nothing needs the whole history:
  // gameplay drains it every frame, calibration wants a few seconds of taps.
  describe('bounded sample history', () => {
    async function pushSamples(count: number) {
      await act(async () => {
        await usePitchStore.getState().startCapture(MIC_1.id)
      })
      const batch = Array.from({ length: count }, (_, i) => sample(MIC_1.id, i))
      act(() => {
        // In batches of 50, the way the native side actually delivers them.
        for (let i = 0; i < batch.length; i += 50) {
          batchCallback!({ deviceId: MIC_1.id, samples: batch.slice(i, i + 50) })
        }
        flushPitchStoreNow()
      })
    }

    it('keeps the history bounded no matter how long the song runs', async () => {
      const unsub = usePitchStore.getState().subscribeToEvents()
      await pushSamples(MAX_CAPTURE_SAMPLES * 3)

      expect(usePitchStore.getState().activeCaptures[MIC_1.id].samples.length).toBeLessThanOrEqual(MAX_CAPTURE_SAMPLES)
      unsub()
    })

    it('keeps the most recent samples, discarding the oldest', async () => {
      const unsub = usePitchStore.getState().subscribeToEvents()
      await pushSamples(MAX_CAPTURE_SAMPLES + 100)

      const { samples } = usePitchStore.getState().activeCaptures[MIC_1.id]
      expect(samples[samples.length - 1].t).toBe(MAX_CAPTURE_SAMPLES + 99)
      unsub()
    })

    // Consumers track how far they have read with an absolute count. Evicting
    // from the front shifts every index, so the store has to report how many it
    // dropped or a reader silently re-processes samples it already scored.
    it('reports how many samples it has discarded', async () => {
      const unsub = usePitchStore.getState().subscribeToEvents()
      await pushSamples(MAX_CAPTURE_SAMPLES + 100)

      expect(usePitchStore.getState().activeCaptures[MIC_1.id].droppedSamples).toBe(100)
      unsub()
    })

    it('drops nothing while the history is still under the cap', async () => {
      const unsub = usePitchStore.getState().subscribeToEvents()
      await pushSamples(100)

      const capture = usePitchStore.getState().activeCaptures[MIC_1.id]
      expect(capture.samples).toHaveLength(100)
      expect(capture.droppedSamples).toBe(0)
      unsub()
    })
  })

  describe('the live capture stream (outside zustand)', () => {
    async function started() {
      const unsub = usePitchStore.getState().subscribeToEvents()
      await act(async () => {
        await usePitchStore.getState().startCapture(MIC_1.id)
      })
      return unsub
    }

    it('appends in place: the zustand entry and the stream share one samples array', async () => {
      const unsub = await started()
      const array = getCaptureStream(MIC_1.id)!.samples

      act(() => {
        batchCallback!({ deviceId: MIC_1.id, samples: [sample(MIC_1.id, 1)] })
        batchCallback!({ deviceId: MIC_1.id, samples: [sample(MIC_1.id, 2)] })
      })

      expect(getCaptureStream(MIC_1.id)!.samples).toBe(array)
      expect(array.map((s) => s.t)).toEqual([1, 2])
      expect(usePitchStore.getState().activeCaptures[MIC_1.id].samples).toBe(array)
      expect(getCaptureStream(MIC_1.id)!.seq).toBe(2)
      unsub()
    })

    it('treats a low-confidence frame as unvoiced: no pitch, no latest', async () => {
      const unsub = await started()
      act(() => {
        batchCallback!({ deviceId: MIC_1.id, samples: [{ ...sample(MIC_1.id, 1), confidence: MIN_PITCH_CONFIDENCE - 0.1 }] })
      })

      const stream = getCaptureStream(MIC_1.id)!
      expect(stream.samples).toEqual([])
      expect(stream.latest).toBeNull()
      unsub()
    })

    it('keeps voiced frames at any pitch, or none, for rap scoring', async () => {
      const unsub = await started()
      act(() => {
        batchCallback!({
          deviceId: MIC_1.id,
          samples: [
            levelOnlyFrame(MIC_1.id, 1, VOICED_RMS_GATE * 2), // loud, unpitched: voiced
            levelOnlyFrame(MIC_1.id, 2, VOICED_RMS_GATE / 4), // room noise: not voiced
            sample(MIC_1.id, 3), // pitched: voiced
          ],
        })
      })

      expect(getCaptureStream(MIC_1.id)!.voiced.map((s) => s.t)).toEqual([1, 3])
      expect(getCaptureStream(MIC_1.id)!.samples.map((s) => s.t)).toEqual([3])
      unsub()
    })

    it('timestamps the latest pitch so a consumer can ignore a stale one', async () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(5_000)
      const unsub = await started()
      act(() => {
        batchCallback!({ deviceId: MIC_1.id, samples: [sample(MIC_1.id, 4_990)] })
        batchCallback!({ deviceId: MIC_1.id, samples: [levelOnlyFrame(MIC_1.id, 4_995, 0.001)] })
      })

      const stream = getCaptureStream(MIC_1.id)!
      expect(stream.latestAt).toBe(5_000)
      expect(freshLatestPitch(stream, 5_000 + STALE_PITCH_MS)).not.toBeNull()
      expect(freshLatestPitch(stream, 5_000 + STALE_PITCH_MS + 1)).toBeNull()
      unsub()
      now.mockRestore()
    })

    it('republishes the zustand summary at most once per throttle window, and the last state always lands', async () => {
      vi.useFakeTimers()
      try {
        const unsub = await started()
        let writes = 0
        const stop = usePitchStore.subscribe(() => {
          writes += 1
        })

        act(() => {
          for (let i = 0; i < 10; i += 1) {
            batchCallback!({ deviceId: MIC_1.id, samples: [sample(MIC_1.id, i, 220, 0.1 + i / 100)] })
          }
        })
        expect(writes).toBe(1) // the leading edge

        act(() => {
          vi.advanceTimersByTime(STATE_FLUSH_INTERVAL_MS)
        })
        expect(writes).toBe(2) // one trailing write for the other nine
        expect(usePitchStore.getState().activeCaptures[MIC_1.id].level).toBeCloseTo(0.19, 6)

        stop()
        unsub()
      } finally {
        vi.useRealTimers()
      }
    })

    it('drops the stream when the capture stops', async () => {
      const unsub = await started()
      await act(async () => {
        await usePitchStore.getState().stopCapture(MIC_1.id)
      })
      expect(getCaptureStream(MIC_1.id)).toBeUndefined()
      unsub()
    })
  })

  // The batch subscription used to be created once per caller, which forced an
  // awkward choice: mount it app-wide and have every screen that also
  // subscribes append each sample twice, or mount it per screen and have no
  // subscriber at all during a song -- which is what shipped, so `latest` and
  // `samples` stayed empty for the whole of gameplay and nothing was scored.
  // Sharing one native listener behind a reference count removes the choice.
  describe('shared pitch-batch subscription', () => {
    it('opens exactly one native listener no matter how many callers subscribe', () => {
      const unsubA = usePitchStore.getState().subscribeToEvents()
      const unsubB = usePitchStore.getState().subscribeToEvents()

      expect(window.api!.audio.onPitchBatch).toHaveBeenCalledTimes(1)

      unsubA()
      unsubB()
    })

    it('appends each sample once when two callers are subscribed', async () => {
      // The shared stub above keeps only the *last* callback, which would hide
      // a double-append: the real preload registers every listener and calls
      // them all. Collect them and fire them all, so this test fails if the
      // store ever opens a second native listener again.
      const callbacks: ((payload: { deviceId: string; samples: PitchSample[] }) => void)[] = []
      ;(window.api!.audio.onPitchBatch as ReturnType<typeof vi.fn>).mockImplementation((cb) => {
        callbacks.push(cb)
        return () => {}
      })

      const unsubA = usePitchStore.getState().subscribeToEvents()
      const unsubB = usePitchStore.getState().subscribeToEvents()
      await act(async () => {
        await usePitchStore.getState().startCapture(MIC_1.id)
      })

      act(() => {
        callbacks.forEach((cb) => cb({ deviceId: MIC_1.id, samples: [sample(MIC_1.id, 1000)] }))
      })

      expect(usePitchStore.getState().activeCaptures[MIC_1.id].samples).toHaveLength(1)

      unsubA()
      unsubB()
    })

    it('keeps delivering to the remaining caller after one unsubscribes', async () => {
      const unsubA = usePitchStore.getState().subscribeToEvents()
      const unsubB = usePitchStore.getState().subscribeToEvents()
      await act(async () => {
        await usePitchStore.getState().startCapture(MIC_1.id)
      })

      unsubA()
      act(() => {
        batchCallback!({ deviceId: MIC_1.id, samples: [sample(MIC_1.id, 1000)] })
      })

      expect(usePitchStore.getState().activeCaptures[MIC_1.id].samples).toHaveLength(1)
      unsubB()
    })

    it('releases the native listener only when the last caller unsubscribes', () => {
      const release = vi.fn()
      ;(window.api!.audio.onPitchBatch as ReturnType<typeof vi.fn>).mockImplementation((cb) => {
        batchCallback = cb
        return release
      })

      const unsubA = usePitchStore.getState().subscribeToEvents()
      const unsubB = usePitchStore.getState().subscribeToEvents()

      unsubA()
      expect(release).not.toHaveBeenCalled()

      unsubB()
      expect(release).toHaveBeenCalledTimes(1)
    })

    it('re-opens the listener after every caller has gone and a new one arrives', () => {
      const unsubA = usePitchStore.getState().subscribeToEvents()
      unsubA()

      const unsubB = usePitchStore.getState().subscribeToEvents()
      expect(window.api!.audio.onPitchBatch).toHaveBeenCalledTimes(2)
      unsubB()
    })

    it('is safe to call a caller\'s unsubscribe twice', () => {
      const release = vi.fn()
      ;(window.api!.audio.onPitchBatch as ReturnType<typeof vi.fn>).mockImplementation((cb) => {
        batchCallback = cb
        return release
      })

      const unsubA = usePitchStore.getState().subscribeToEvents()
      const unsubB = usePitchStore.getState().subscribeToEvents()

      unsubA()
      unsubA()

      // The double call must not have decremented twice and torn the listener
      // out from under B -- React 18 StrictMode runs cleanups twice.
      expect(release).not.toHaveBeenCalled()
      unsubB()
      expect(release).toHaveBeenCalledTimes(1)
    })
  })
})
