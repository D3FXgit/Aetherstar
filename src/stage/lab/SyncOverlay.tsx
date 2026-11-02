import { GlassPanel } from '../../design/primitives/GlassPanel'

interface SyncOverlayProps {
  audioMs: number
  videoMs: number | null
}

/**
 * Numeric readout of the audio clock against the video's raw currentTime, for
 * measuring the drift the clock is nudging toward zero.
 */
export function SyncOverlay({ audioMs, videoMs }: SyncOverlayProps) {
  const deltaMs = videoMs === null ? null : videoMs - audioMs

  return (
    <GlassPanel variant="glass" data-testid="stage-sync-overlay" className="p-4 font-mono text-xs text-ink-secondary">
      <div>audio: {audioMs.toFixed(0)}ms</div>
      <div>video: {videoMs === null ? 'n/a' : `${videoMs.toFixed(0)}ms`}</div>
      <div>Δ {deltaMs === null ? 'n/a' : `${deltaMs.toFixed(0)}ms`}</div>
    </GlassPanel>
  )
}
