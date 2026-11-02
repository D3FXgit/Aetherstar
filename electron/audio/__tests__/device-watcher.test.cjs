// @vitest-environment node
const { diffDeviceLists, startDeviceWatcher, DEFAULT_POLL_INTERVAL_MS } = require('../device-watcher.cjs')

const MIC_1 = { id: 'mic-1', name: 'USB Mic', channelCount: 1, sampleRate: 48000 }
const MIC_2 = { id: 'mic-2', name: 'Interface In 1', channelCount: 1, sampleRate: 48000 }

describe('diffDeviceLists', () => {
  it('reports no change for identical lists', () => {
    expect(diffDeviceLists([MIC_1], [MIC_1])).toEqual({ added: [], removed: [], changed: false })
  })

  it('reports an added device', () => {
    const diff = diffDeviceLists([MIC_1], [MIC_1, MIC_2])
    expect(diff.changed).toBe(true)
    expect(diff.added).toEqual([MIC_2])
    expect(diff.removed).toEqual([])
  })

  it('reports a removed device', () => {
    const diff = diffDeviceLists([MIC_1, MIC_2], [MIC_1])
    expect(diff.changed).toBe(true)
    expect(diff.removed).toEqual([MIC_2])
    expect(diff.added).toEqual([])
  })
})

describe('startDeviceWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires onChange only when the polled list actually differs', () => {
    let currentDevices = [MIC_1]
    const bridge = { listDevices: () => currentDevices }
    const onChange = vi.fn()

    const stop = startDeviceWatcher(bridge, onChange, 2000)

    vi.advanceTimersByTime(2000)
    expect(onChange).not.toHaveBeenCalled()

    currentDevices = [MIC_1, MIC_2]
    vi.advanceTimersByTime(2000)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ devices: [MIC_1, MIC_2], added: [MIC_2], removed: [] })

    vi.advanceTimersByTime(2000)
    expect(onChange).toHaveBeenCalledTimes(1)

    stop()
    currentDevices = []
    vi.advanceTimersByTime(4000)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('polls no more often than every 5 s by default', () => {
    const listDevices = vi.fn(() => [MIC_1])
    const stop = startDeviceWatcher({ listDevices }, vi.fn())
    expect(DEFAULT_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(5000)
    listDevices.mockClear()
    vi.advanceTimersByTime(DEFAULT_POLL_INTERVAL_MS - 1)
    expect(listDevices).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(listDevices).toHaveBeenCalledTimes(1)
    stop()
  })

  it('skips enumeration entirely while paused, and pollNow catches up', () => {
    let currentDevices = [MIC_1]
    const listDevices = vi.fn(() => currentDevices)
    const onChange = vi.fn()
    let paused = true
    const stop = startDeviceWatcher({ listDevices }, onChange, 1000, { isPaused: () => paused })
    listDevices.mockClear()

    currentDevices = [MIC_1, MIC_2]
    vi.advanceTimersByTime(10_000)
    expect(listDevices).not.toHaveBeenCalled()

    paused = false
    stop.pollNow()
    expect(onChange).toHaveBeenCalledWith({ devices: [MIC_1, MIC_2], added: [MIC_2], removed: [] })
    stop()
  })

  it('never starts a second enumeration while an asynchronous one is still running', async () => {
    let resolveSlow
    const listDevices = vi
      .fn()
      .mockReturnValueOnce([MIC_1])
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSlow = resolve)))
      .mockReturnValue([MIC_1])
    const onChange = vi.fn()
    const stop = startDeviceWatcher({ listDevices }, onChange, 1000)

    vi.advanceTimersByTime(1000) // starts the slow call
    vi.advanceTimersByTime(3000) // three more ticks, all skipped
    expect(listDevices).toHaveBeenCalledTimes(2)

    resolveSlow([MIC_1, MIC_2])
    await vi.advanceTimersByTimeAsync(0)
    expect(onChange).toHaveBeenCalledWith({ devices: [MIC_1, MIC_2], added: [MIC_2], removed: [] })

    vi.advanceTimersByTime(1000)
    expect(listDevices).toHaveBeenCalledTimes(3)
    stop()
  })
})
