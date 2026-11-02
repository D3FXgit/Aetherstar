import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { useMicMonitorStore } from '../micMonitorStore'

/** The main process's own default, mirrored in src/audio/api.ts. */
const DEFAULTS = { enabled: false, level: 0.5 }

function stubApi(overrides: Partial<Record<'getMicMonitor' | 'setMicMonitor', unknown>> = {}) {
  const stored = { ...DEFAULTS }
  const api = {
    getMicMonitor: vi.fn(async () => ({ ...stored })),
    // Mirrors the main process: clamps, and answers with what it stored.
    setMicMonitor: vi.fn(async (next: { enabled: boolean; level: number }) => {
      stored.enabled = next.enabled === true
      stored.level = Math.min(1, Math.max(0, next.level))
      return { ...stored }
    }),
    ...overrides,
  }
  ;(window as unknown as { api: unknown }).api = { audio: api }
  return { api, stored }
}

describe('useMicMonitorStore', () => {
  beforeEach(() => {
    useMicMonitorStore.setState({ ...DEFAULTS, loaded: false })
  })

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  /**
   * The default that matters: a store whose initial state was "on" would show
   * an on switch for the frame before `load()` answers, on a feature that
   * amplifies the room.
   */
  it('starts off, and not yet loaded', () => {
    const state = useMicMonitorStore.getState()
    expect(state.enabled).toBe(false)
    expect(state.loaded).toBe(false)
  })

  it('load() adopts the persisted setting from the main process', async () => {
    stubApi({ getMicMonitor: vi.fn(async () => ({ enabled: true, level: 0.3 })) })

    await useMicMonitorStore.getState().load()

    expect(useMicMonitorStore.getState()).toMatchObject({ enabled: true, level: 0.3, loaded: true })
  })

  it('setEnabled writes through to the main process, carrying the current level', async () => {
    const { api } = stubApi()
    useMicMonitorStore.setState({ enabled: false, level: 0.4, loaded: true })

    await useMicMonitorStore.getState().setEnabled(true)

    expect(api.setMicMonitor).toHaveBeenCalledWith({ enabled: true, level: 0.4 })
    expect(useMicMonitorStore.getState().enabled).toBe(true)
  })

  it('setLevel writes through to the main process, carrying the current switch', async () => {
    const { api } = stubApi()
    useMicMonitorStore.setState({ enabled: true, level: 0.4, loaded: true })

    await useMicMonitorStore.getState().setLevel(0.7)

    expect(api.setMicMonitor).toHaveBeenCalledWith({ enabled: true, level: 0.7 })
    expect(useMicMonitorStore.getState().level).toBe(0.7)
  })

  /**
   * The store adopts what was *stored*, not what was asked for. Otherwise a
   * slider could sit at a position the audio path is not honouring, and the
   * user would be adjusting a control that had stopped meaning anything.
   */
  it('adopts the clamped value the main process reports back', async () => {
    stubApi()
    useMicMonitorStore.setState({ enabled: true, level: 0.5, loaded: true })

    await useMicMonitorStore.getState().setLevel(4)

    expect(useMicMonitorStore.getState().level).toBe(1)
  })

  /**
   * A drag fires many writes a second and their replies can land out of order.
   * Adopting a superseded reply would yank the thumb back to a position the
   * user has already dragged past.
   */
  it('ignores a reply that a newer change has already superseded', async () => {
    const resolvers: Array<(value: { enabled: boolean; level: number }) => void> = []
    stubApi({
      setMicMonitor: vi.fn(
        () => new Promise<{ enabled: boolean; level: number }>((resolve) => resolvers.push(resolve)),
      ),
    })
    useMicMonitorStore.setState({ enabled: true, level: 0.1, loaded: true })

    const first = useMicMonitorStore.getState().setLevel(0.2)
    const second = useMicMonitorStore.getState().setLevel(0.9)

    // The newer request answers first, then the stale one arrives late.
    resolvers[1]({ enabled: true, level: 0.9 })
    resolvers[0]({ enabled: true, level: 0.2 })
    await Promise.all([first, second])

    expect(useMicMonitorStore.getState().level).toBe(0.9)
  })

  /**
   * jsdom, a browser, or a preload that predates this namespace. The store must
   * degrade to the shared default rather than throwing inside a Settings pane.
   */
  it('falls back to the shared default with no window.api', async () => {
    delete (window as unknown as { api?: unknown }).api

    await useMicMonitorStore.getState().load()

    expect(useMicMonitorStore.getState()).toMatchObject({ enabled: false, level: 0.5, loaded: true })
    await expect(useMicMonitorStore.getState().setEnabled(true)).resolves.toBeUndefined()
  })
})
