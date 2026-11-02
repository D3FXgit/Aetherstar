// The mystery songs as a gallery that fits whatever room the screen has left.
// See galleryLayout.ts for the sizing; this is the band and its preview rules.
import { useEffect, useRef, type CSSProperties } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { LibrarySong } from '../../library/types'
import type { LeaderboardEntry } from '../types'
import { GALLERY_GAP, GALLERY_MIN_HEIGHT, GALLERY_PADDING, galleryCardWidth } from './galleryLayout'
import { PartySongCard } from './PartySongCard'

/** How long the pointer has to rest on a card before it is auditioned, so sweeping across does not stutter. */
export const HOVER_PREVIEW_DELAY_MS = 350

interface PartySongGalleryProps {
  songs: LibrarySong[]
  selectedPath: string | null
  accentColor: string
  bests: Record<string, LeaderboardEntry | null>
  holderName: (playerId: string) => string | null
  onSelect: (song: LibrarySong) => void
  onQuickStart: (song: LibrarySong) => void
  /** Audition a song, or null to go back to the picked one (or silence). */
  onPreview: (song: LibrarySong | null) => void
}

export function PartySongGallery({
  songs,
  selectedPath,
  accentColor,
  bests,
  holderName,
  onSelect,
  onQuickStart,
  onPreview,
}: PartySongGalleryProps) {
  const bandRef = useRef<HTMLDivElement>(null)
  const hoverTimer = useRef<number | null>(null)
  const onPreviewRef = useRef(onPreview)
  onPreviewRef.current = onPreview

  const cancelHover = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = null
  }
  useEffect(() => cancelHover, [])

  const bandStyle = {
    // A size container: the cards' `cqw`/`cqh` resolve against this band,
    // i.e. what is left after the header, singers and footer.
    containerType: 'size',
    '--party-card-w': galleryCardWidth(songs.length),
    minHeight: GALLERY_MIN_HEIGHT,
    gap: GALLERY_GAP,
    padding: GALLERY_PADDING,
    // `safe`: should the band ever have to scroll, nothing is centred out of reach.
    justifyContent: 'safe center',
    alignItems: 'safe center',
  } as CSSProperties

  return (
    <div
      ref={bandRef}
      // flex-1: the band takes the leftover height and nothing more. It only
      // ever scrolls below the minimum cover size. `relative` is popLayout's
      // anchor: a card leaving on a re-deal fades where it was, not elsewhere.
      className="relative flex flex-1 overflow-auto"
      style={bandStyle}
      data-testid="party-songs-grid"
      onMouseLeave={() => {
        cancelHover()
        onPreviewRef.current(null)
      }}
      // Focus leaving the gallery (to Start, say) hands the preview back to the pick.
      onBlur={(event) => {
        const next = event.relatedTarget
        if (!(next instanceof Node) || !bandRef.current?.contains(next)) onPreviewRef.current(null)
      }}
    >
      <AnimatePresence mode="popLayout">
        {songs.map((song, index) => (
          <PartySongCard
            key={`party-song-${index}-${song.path}`}
            song={song}
            index={index}
            selected={selectedPath === song.path}
            accentColor={accentColor}
            best={song.path in bests ? bests[song.path] : undefined}
            bestHolder={bests[song.path] ? holderName(bests[song.path]!.playerId) : null}
            onSelect={() => {
              cancelHover()
              onSelect(song)
            }}
            onQuickStart={() => {
              cancelHover()
              onQuickStart(song)
            }}
            onPreviewIntent={() => {
              cancelHover()
              hoverTimer.current = window.setTimeout(() => {
                hoverTimer.current = null
                onPreviewRef.current(song)
              }, HOVER_PREVIEW_DELAY_MS)
            }}
            onFocusPreview={() => onPreviewRef.current(song)}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}
