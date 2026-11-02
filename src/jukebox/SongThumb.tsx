// A song's cover as a small square, or a quiet placeholder when it has none.
import { toLibraryMediaUrl } from '../library/mediaUrl'
import type { LibrarySong } from '../library/types'

const PLACEHOLDER = 'repeating-linear-gradient(135deg, rgba(255,255,255,.10) 0 7px, rgba(255,255,255,.02) 7px 14px)'

export function SongThumb({ song, className = 'size-14' }: { song: LibrarySong; className?: string }) {
  return (
    <span className={`block shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5 ${className}`}>
      {song.thumbnailPath ? (
        <img src={toLibraryMediaUrl(song.thumbnailPath)} alt="" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <span className="block h-full w-full" style={{ background: PLACEHOLDER }} />
      )}
    </span>
  )
}
