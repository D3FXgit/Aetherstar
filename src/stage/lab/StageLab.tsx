import { useEffect, useState } from 'react'
import { GlassButton } from '../../design/primitives/GlassButton'
import { Stage } from '../Stage'
import { useChartLoader } from '../chart/useChartLoader'
import { SyncOverlay } from './SyncOverlay'

/** `/lab/stage`: load any .txt + media pair outside the library and play it, with a togglable sync overlay. */
export function StageLab() {
  const [absolutePath, setAbsolutePath] = useState<string | null>(null)
  const [showSyncOverlay, setShowSyncOverlay] = useState(false)
  const [syncReadout, setSyncReadout] = useState<{ audioMs: number; videoMs: number | null }>({
    audioMs: 0,
    videoMs: null,
  })
  const { status, chart, sourceDir, error } = useChartLoader(absolutePath)

  useEffect(() => {
    if (!showSyncOverlay) return
    const interval = setInterval(() => {
      const audio = document.querySelector('audio')
      const video = document.querySelector('video')
      setSyncReadout({
        audioMs: (audio?.currentTime ?? 0) * 1000,
        videoMs: video ? video.currentTime * 1000 : null,
      })
    }, 200)
    return () => clearInterval(interval)
  }, [showSyncOverlay])

  async function handleLoadChart() {
    const path = await window.api?.openFile()
    if (path) setAbsolutePath(path)
  }

  return (
    <div className="relative w-full h-full min-h-screen">
      <div className="absolute top-4 left-4 z-10 flex gap-2">
        <GlassButton onClick={handleLoadChart}>Load chart</GlassButton>
        <GlassButton onClick={() => setShowSyncOverlay((visible) => !visible)}>Sync overlay</GlassButton>
      </div>

      {status === 'ready' && chart && sourceDir && <Stage chart={chart} sourceDir={sourceDir} />}
      {status === 'error' && <p className="text-white/60 p-8">Couldn&rsquo;t load chart: {error}</p>}

      {showSyncOverlay && (
        <div className="absolute bottom-4 right-4 z-10">
          <SyncOverlay audioMs={syncReadout.audioMs} videoMs={syncReadout.videoMs} />
        </div>
      )}
    </div>
  )
}
