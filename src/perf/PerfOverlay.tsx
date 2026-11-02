import { GlassPanel } from '../design/primitives/GlassPanel'
import { NeonText } from '../design/primitives/NeonText'
import { usePerfSampler } from './usePerfSampler'

/**
 * Developer-only perf readout (App.tsx mounts it in dev builds only): frame
 * rate, frame time, CPU, mic delay and heap, checked on the real renderer.
 */
export function PerfOverlay() {
  const { fps, frameTimeMs, cpuPercent, micLatencyMs, heapUsedMb } = usePerfSampler()

  return (
    <GlassPanel
      className="fixed bottom-6 left-6 z-50 p-4 flex flex-col gap-1 text-xs min-w-[160px]"
      data-testid="perf-overlay"
    >
      <div className="flex justify-between gap-4">
        <span className="text-ink-tertiary">FPS</span>
        <NeonText accent="cyan" className="font-mono tabular-nums" data-testid="perf-fps">
          {fps.toFixed(0)}
        </NeonText>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-ink-tertiary">Frame</span>
        <span data-testid="perf-frame-time" className="font-mono tabular-nums text-ink-secondary">
          {frameTimeMs.toFixed(1)} ms
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-ink-tertiary">CPU</span>
        <span data-testid="perf-cpu" className="font-mono tabular-nums text-ink-secondary">
          {cpuPercent !== null ? `${cpuPercent.toFixed(0)}%` : '--'}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-ink-tertiary">Mic delay</span>
        <span data-testid="perf-mic-latency" className="font-mono tabular-nums text-ink-secondary">
          {micLatencyMs !== null ? `${Math.round(micLatencyMs)} ms` : '-- ms'}
        </span>
      </div>
      {heapUsedMb !== null && (
        <div className="flex justify-between gap-4 items-center">
          <span className="text-ink-tertiary">Heap</span>
          <span data-testid="perf-heap-sparkline" className="font-mono tabular-nums text-ink-secondary">
            {heapUsedMb.toFixed(0)} MB
          </span>
        </div>
      )}
    </GlassPanel>
  )
}
