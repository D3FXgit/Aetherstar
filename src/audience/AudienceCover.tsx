import type { AudienceSong } from './types'

/**
 * The chosen song's cover art, with its title and artist underneath.
 *
 * Sized against the viewport's shorter side, not in pixels, because the TV's
 * size is unknown. A song with no cover keeps the empty frame so the layout
 * does not jump between songs.
 */
export function AudienceCover({ song, sizeVMin = 34 }: { song: AudienceSong; sizeVMin?: number }) {
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <div
        data-testid="audience-cover"
        className="overflow-hidden rounded-[6%] border border-line bg-surface-panel"
        style={{
          width: `${sizeVMin}vmin`,
          height: `${sizeVMin}vmin`,
          boxShadow: '0 40px 120px rgba(0,0,0,0.6)',
        }}
      >
        {song.coverUrl && (
          <img
            data-testid="audience-cover-image"
            src={song.coverUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="flex max-w-[80vw] flex-col gap-2">
        <h1
          data-testid="audience-song-title"
          className="truncate text-[clamp(1.75rem,4vw,4.5rem)] font-extrabold tracking-tight text-ink-primary"
        >
          {song.title}
        </h1>
        <p data-testid="audience-song-artist" className="truncate text-[clamp(1rem,2vw,2rem)] text-ink-secondary">
          {song.artist}
        </p>
      </div>
    </div>
  )
}
