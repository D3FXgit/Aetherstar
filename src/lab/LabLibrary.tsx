// /lab/library: runs and inspects a library scan without the LibraryScene grid.
import { useEffect } from 'react'
import { GlassPanel } from '../design/primitives/GlassPanel'
import { GlassButton } from '../design/primitives/GlassButton'
import { useSceneStore } from '../scenes/sceneStore'
import { useLibraryStore } from '../library/useLibraryStore'

export function LabLibrary() {
  const { scanProgress, scanErrors, addRoot, refreshScanErrors, subscribeToProgress } = useLibraryStore()

  useEffect(() => {
    void refreshScanErrors()
    return subscribeToProgress()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, [])

  async function handlePickFolder() {
    const folderPath = await window.api?.openFile({ directory: true })
    if (folderPath) void addRoot(folderPath)
  }

  const progressEntries = Object.values(scanProgress)

  return (
    <GlassPanel className="p-8 m-auto max-w-lg flex flex-col gap-3">
      <button type="button" className="text-sm text-ink-secondary self-start" onClick={() => useSceneStore.getState().navigate('lab')}>
        ← Back to Dev Lab
      </button>
      <h1 className="text-2xl font-semibold text-ink-primary">Library scan lab</h1>
      <GlassButton type="button" onClick={handlePickFolder}>
        Pick folder & scan
      </GlassButton>
      {progressEntries.length === 0 && <p className="text-ink-tertiary text-sm">No scan in progress.</p>}
      {progressEntries.map((progress) => (
        <p key={progress.rootPath} className="text-ink-secondary text-sm" data-testid="lab-library-progress">
          {progress.rootPath}: {progress.songsParsed} / {progress.songsFound} songs read
          {progress.done ? ' (done)' : ''}
        </p>
      ))}
      <p className="text-ink-tertiary text-sm" data-testid="lab-library-error-count">
        Errors: {scanErrors.length}
      </p>
    </GlassPanel>
  )
}
