// Lab-only scope of rawScopeStore's latest raw-waveform chunk. Writes the SVG
// attribute imperatively so the sweep never goes through React state.
import { useEffect, useRef } from 'react'
import { tokens } from '../design/tokens'
import { useRawScopeStore } from '../audio/rawScopeStore'

export function RawBufferScope() {
  const traceRef = useRef<SVGPolylineElement | null>(null)

  useEffect(() => {
    return useRawScopeStore.subscribe((state) => {
      const chunk = state.latestChunk
      if (!chunk || chunk.length === 0) return
      const points = Array.from(chunk)
        .map((value, i) => {
          const x = (i / Math.max(1, chunk.length - 1)) * 100
          const y = 50 - Math.max(-50, Math.min(50, value * 50))
          return `${x},${y}`
        })
        .join(' ')
      traceRef.current?.setAttribute('points', points)
    })
  }, [])

  return (
    <svg
      data-testid="raw-buffer-scope"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="w-full h-24 bg-surface-raised rounded-lg"
    >
      <polyline ref={traceRef} points="" fill="none" stroke={tokens.accent.gold} strokeWidth="1.5" />
    </svg>
  )
}
