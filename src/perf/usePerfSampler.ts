import { useEffect, useRef, useState } from 'react'
import { usePitchStore } from '../audio/pitchStore'
import { computeFrameStats } from './frameStats'
import { readHeapSampleMb } from './heapSample'
import type { FrameStats } from './types'

const FRAME_BUFFER_SIZE = 30
const CPU_POLL_INTERVAL_MS = 1000
const UI_UPDATE_INTERVAL_MS = 100

export interface PerfSample extends FrameStats {
  cpuPercent: number | null
  micLatencyMs: number | null
  heapUsedMb: number | null
}

const INITIAL_SAMPLE: PerfSample = { fps: 0, frameTimeMs: 0, cpuPercent: null, micLatencyMs: null, heapUsedMb: null }

/** performance.memory is Chromium-only and not in the standard lib.dom typings. */
interface PerformanceWithMemory extends Performance {
  memory?: { usedJSHeapSize: number }
}

/**
 * Live fps/frame-time/CPU/mic-latency/heap sampling for the perf overlay.
 * Reuses the main-process CPU sampler and each capture's own latencyMs
 * rather than measuring either again.
 */
export function usePerfSampler(): PerfSample {
  const [sample, setSample] = useState<PerfSample>(INITIAL_SAMPLE)
  const timestampsRef = useRef<number[]>([])
  const lastUiUpdateRef = useRef(0)
  const cpuPercentRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    let rafHandle: number

    function tick(now: number) {
      timestampsRef.current = [...timestampsRef.current, now].slice(-FRAME_BUFFER_SIZE)

      if (now - lastUiUpdateRef.current > UI_UPDATE_INTERVAL_MS) {
        lastUiUpdateRef.current = now
        const frameStats = computeFrameStats(timestampsRef.current)
        const activeCaptures = usePitchStore.getState().activeCaptures
        const micLatencyMs = Object.values(activeCaptures)[0]?.latencyMs ?? null
        const heapUsedMb = readHeapSampleMb((performance as PerformanceWithMemory).memory)
        setSample({ ...frameStats, cpuPercent: cpuPercentRef.current, micLatencyMs, heapUsedMb })
      }

      if (!cancelled) rafHandle = requestAnimationFrame(tick)
    }

    rafHandle = requestAnimationFrame(tick)

    function pollCpu() {
      window.api?.multiplayer.getCpuUsage().then((result) => {
        cpuPercentRef.current = result.percent
      })
    }
    pollCpu()
    const cpuInterval = setInterval(pollCpu, CPU_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafHandle)
      clearInterval(cpuInterval)
    }
  }, [])

  return sample
}
