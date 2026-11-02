import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePerfSampler } from '../usePerfSampler'
import { usePitchStore } from '../../audio/pitchStore'

beforeEach(() => {
  // @ts-expect-error -- only getCpuUsage matters for this test
  window.api = { multiplayer: { getCpuUsage: vi.fn().mockResolvedValue({ percent: 42 }) } } as Window['api']
})

afterEach(() => {
  delete window.api
  usePitchStore.setState({ activeCaptures: {} })
})

describe('usePerfSampler', () => {
  it('reports non-zero fps/frameTimeMs after several real rAF ticks', async () => {
    const { result } = renderHook(() => usePerfSampler())
    await waitFor(() => expect(result.current.fps).toBeGreaterThan(0), { timeout: 2000 })
  })

  it('reports cpuPercent from window.api.multiplayer.getCpuUsage', async () => {
    const { result } = renderHook(() => usePerfSampler())
    await waitFor(() => expect(result.current.cpuPercent).toBe(42), { timeout: 2000 })
  })

  it('reports micLatencyMs from the active pitch capture', async () => {
    usePitchStore.setState({
      activeCaptures: { 'device-1': { latest: null, samples: [], latencyMs: 18 } },
    })
    const { result } = renderHook(() => usePerfSampler())
    await waitFor(() => expect(result.current.micLatencyMs).toBe(18), { timeout: 2000 })
  })

  it('falls back to null fields when nothing is active/mocked, without throwing', async () => {
    delete window.api
    const { result } = renderHook(() => usePerfSampler())
    await waitFor(() => expect(result.current.fps).toBeGreaterThan(0), { timeout: 2000 })
    expect(result.current.cpuPercent).toBeNull()
    expect(result.current.micLatencyMs).toBeNull()
  })
})
