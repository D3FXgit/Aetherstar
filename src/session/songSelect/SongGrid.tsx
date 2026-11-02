// The virtualized song grid: only the rows in view (plus two either side, so a
// directional press always has a card to land on) exist in the DOM.
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { List, type ListImperativeAPI, type RowComponentProps } from 'react-window'
import { useT } from '../../i18n'
import { PRESS_CLASS } from '../../design/motion'
import { tokens } from '../../design/tokens'
import type { LibrarySearchFilters, LibrarySong } from '../../library/types'
import { ACCENT_CYAN, ACCENT_GOLD, FOCUS_OUTLINE_GUTTER, SURFACE, TEXT, mediaUrl, u } from './layout'
import { useSongGridGeometry } from './useSongGridGeometry'

// "No cover" texture: says "nothing here" without leaving a black hole in the grid.
const COVER_PLACEHOLDER =
  'repeating-linear-gradient(135deg, rgba(255,255,255,.10) 0 9px, rgba(255,255,255,.02) 9px 18px)'

interface SongTileProps {
  song: LibrarySong
  isSelected: boolean
  isFavorite: boolean
  duetLabel: string
  onSelect: (song: LibrarySong) => void
  /** Double click: commit this song without a trip to the preview panel. */
  onQuickStart: (song: LibrarySong) => void
  onHover: () => void
}

/**
 * One card. A plain memoised `<button>` with the shared CSS press feel, not a
 * motion component: a 1,200-song library re-renders cheaply on every scan tick.
 */
const SongTile = memo(function SongTile({
  song,
  isSelected,
  isFavorite,
  duetLabel,
  onSelect,
  onQuickStart,
  onHover,
}: SongTileProps) {
  return (
    <button
      type="button"
      aria-current={isSelected ? 'true' : undefined}
      // How Song Select finds this card again to move focus along with an
      // automatic selection change (useSongSelection.ts).
      data-song-path={song.path}
      onClick={() => onSelect(song)}
      onDoubleClick={() => onQuickStart(song)}
      onMouseEnter={onHover}
      // `aspect-square` here and on the cover: together they make the row measure square.
      className={`relative block aspect-square overflow-hidden text-left hover:border-ink-tertiary ${PRESS_CLASS}`}
      style={{
        // A double click would otherwise leave the title text highlighted.
        userSelect: 'none',
        borderRadius: u(18),
        border: `${isSelected ? u(3) : '1px'} solid ${isSelected ? ACCENT_CYAN : SURFACE.line}`,
        background: SURFACE.raised,
      }}
    >
      {song.thumbnailPath ? (
        <img
          src={mediaUrl(song.thumbnailPath)}
          alt=""
          loading="lazy"
          decoding="async"
          className="block aspect-square w-full object-cover"
        />
      ) : (
        <span className="block aspect-square w-full" style={{ background: COVER_PLACEHOLDER }} />
      )}
      {/* Dark enough that the artist line clears 4.5:1 over any cover art. */}
      <div
        className="absolute inset-x-0 bottom-0"
        style={{
          padding: `${u(12)} ${u(14)}`,
          background: 'linear-gradient(to top, rgba(0,0,0,.92) 0%, rgba(0,0,0,.6) 55%, transparent 100%)',
        }}
      >
        <div className="flex items-center" style={{ gap: u(6), fontSize: u(18), fontWeight: 600, lineHeight: 1.15 }}>
          {isFavorite && (
            <span aria-hidden="true" style={{ color: ACCENT_GOLD }}>
              ★
            </span>
          )}
          <span className="truncate">{song.title}</span>
        </div>
        <div className="truncate" style={{ fontSize: u(15), fontWeight: 500, color: TEXT.secondary, marginTop: u(3) }}>
          {song.artist}
        </div>
      </div>
      {song.isDuet && (
        <span
          className="absolute"
          style={{
            left: u(10),
            top: u(10),
            fontWeight: 700,
            fontSize: u(13),
            padding: `${u(4)} ${u(9)}`,
            borderRadius: u(6),
            // Solid rather than a per-card backdrop blur.
            background: 'rgba(0,0,0,.75)',
            color: tokens.accent.magenta,
          }}
        >
          {duetLabel}
        </span>
      )}
    </button>
  )
})

interface SongRowProps {
  songs: LibrarySong[]
  columns: number
  cardPx: number
  gapPx: number
  selectedPath: string | null
  favorites: ReadonlySet<string>
  duetLabel: string
  onSelect: (song: LibrarySong) => void
  onQuickStart: (song: LibrarySong) => void
  onHover: () => void
}

/** One row of `columns` cards. The focus gutter is inside the row: rows are absolutely positioned. */
function SongRow({
  index,
  style,
  ariaAttributes,
  songs,
  columns,
  cardPx,
  gapPx,
  selectedPath,
  favorites,
  duetLabel,
  onSelect,
  onQuickStart,
  onHover,
}: RowComponentProps<SongRowProps>) {
  const start = index * columns
  return (
    <div style={style} {...ariaAttributes}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, ${cardPx}px)`,
          columnGap: gapPx,
          paddingInline: FOCUS_OUTLINE_GUTTER,
          paddingTop: FOCUS_OUTLINE_GUTTER,
        }}
      >
        {songs.slice(start, start + columns).map((song) => (
          <SongTile
            key={song.path}
            song={song}
            isSelected={selectedPath === song.path}
            isFavorite={favorites.has(song.path)}
            duetLabel={duetLabel}
            onSelect={onSelect}
            onQuickStart={onQuickStart}
            onHover={onHover}
          />
        ))}
      </div>
    </div>
  )
}

interface SongGridProps {
  songs: LibrarySong[]
  selectedPath: string | null
  /**
   * Scroll a newly selected card into view (the default). False for a
   * selection that moved by itself while the user was navigating: scrolling
   * then would pull the grid -- and, virtualized, the focused card itself --
   * out from under them.
   */
  revealSelected?: boolean
  favorites: ReadonlySet<string>
  /** Anything that changes which slice of the library is shown; the list returns to its top. */
  resetKey: unknown
  filters: LibrarySearchFilters
  onSelect: (song: LibrarySong) => void
  onQuickStart: (song: LibrarySong) => void
  onHover: () => void
}

export function SongGrid({
  songs,
  selectedPath,
  revealSelected = true,
  favorites,
  resetKey,
  filters,
  onSelect,
  onQuickStart,
  onHover,
}: SongGridProps) {
  const t = useT()
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const geometry = useSongGridGeometry(host)
  const listRef = useRef<ListImperativeAPI | null>(null)
  const duetLabel = t('songSelect.tile.duet')

  const rowProps = useMemo<SongRowProps>(
    () => ({
      songs,
      columns: geometry.columns,
      cardPx: geometry.cardPx,
      gapPx: geometry.gapPx,
      selectedPath,
      favorites,
      duetLabel,
      onSelect,
      onQuickStart,
      onHover,
    }),
    [songs, geometry, selectedPath, favorites, duetLabel, onSelect, onQuickStart, onHover],
  )
  const rowCount = Math.ceil(songs.length / geometry.columns)

  // react-window throws for an index outside 0..rowCount-1, e.g. scrolling an
  // empty result list back to the top.
  const rowCountRef = useRef(rowCount)
  rowCountRef.current = rowCount

  useEffect(() => {
    if (rowCountRef.current > 0) listRef.current?.scrollToRow({ index: 0, align: 'start' })
  }, [resetKey, filters])

  // Keep the selected card in view; 'auto' leaves an already-visible card alone.
  const selectedIndex = selectedPath === null ? -1 : songs.findIndex((song) => song.path === selectedPath)
  const selectedRow = selectedIndex === -1 ? -1 : Math.floor(selectedIndex / geometry.columns)
  const revealRef = useRef(revealSelected)
  revealRef.current = revealSelected
  useEffect(() => {
    if (!revealRef.current) return
    if (selectedRow >= 0 && selectedRow < rowCountRef.current) {
      listRef.current?.scrollToRow({ index: selectedRow, align: 'auto' })
    }
  }, [selectedRow])

  return (
    <div ref={setHost} className="flex min-h-0 min-w-0 flex-1 flex-col" style={{ marginLeft: u(64), marginRight: u(32) }}>
      <List
        listRef={listRef}
        data-testid="song-selector-grid"
        className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ height: '100%', overflowY: 'auto' }}
        rowComponent={SongRow}
        rowCount={rowCount}
        rowHeight={geometry.rowHeightPx}
        rowProps={rowProps}
        overscanCount={2}
        defaultHeight={1080}
      />
    </div>
  )
}
