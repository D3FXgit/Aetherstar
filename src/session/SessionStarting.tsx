// `starting` phase scene: wraps SongStartTransition with the session store,
// advancing to `play` only once the zoom + 3-2-1 countdown has finished.
import { useEffect } from "react"
import { SongStartTransition } from "./SongStartTransition"
import { useSessionStore } from "./sessionStore"
import { prefetchChart } from "../stage/chart/useChartLoader"
import { prefetchAudio } from "../stage/media/prefetchMedia"
import { toAppMediaUrl } from "../stage/media/resolveMediaPath"
import { toLibraryMediaUrl } from "../library/mediaUrl"

/** The cover as a URL the sandboxed renderer can load (the same mapping the Song Selector uses, so it is already decoded). */
function coverUrlFor(thumbnailPath: string | null | undefined): string | undefined {
  return thumbnailPath ? toLibraryMediaUrl(thumbnailPath) : undefined
}

export function SessionStarting() {
  const selectedSong = useSessionStore((state) => state.selectedSong)
  const beginSong = useSessionStore((state) => state.beginSong)

  // Warm the chart and audio during the countdown, so the song starts without a hitch.
  useEffect(() => {
    prefetchChart(selectedSong?.path)
    if (selectedSong?.mp3Path) {
      void prefetchAudio(toAppMediaUrl(selectedSong.mp3Path))
    }
  }, [selectedSong])

  return (
    <SongStartTransition
      songTitle={selectedSong?.title}
      artist={selectedSong?.artist}
      coverUrl={coverUrlFor(selectedSong?.thumbnailPath)}
      onComplete={beginSong}
    />
  )
}
