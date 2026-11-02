// The song selector: a preview panel, the virtualized song grid, an alphabet
// rail and a filter bar, all backed by the library index. Shared by the sung
// modes and the jukebox; the pieces live in ./songSelect/.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useT } from '../i18n'
import { BackButton } from '../scenes/SceneHeader'
import { tokens } from '../design/tokens'
import { AddLibraryFolderButton } from '../library/AddLibraryFolderButton'
import { useLibraryStore } from '../library/useLibraryStore'
import { useSfx } from '../audio/useSfx'
import type { LibrarySong } from '../library/types'
import { usePlayersStore } from '../players/store'
import { useSessionStore } from './sessionStore'
import { DESIGN_UNIT, SURFACE, TEXT, VIEWPORT_HEIGHT, u } from './songSelect/layout'
import { distinctLanguages, letterCounts, letterOf, seededShuffle } from './songSelect/filters'
import { useSongSelection } from './songSelect/useSongSelection'
import { useSongHighscores } from './songSelect/useSongHighscores'
import { useSelectorShortcuts } from './songSelect/useSelectorShortcuts'
import { SelectorHeader } from './songSelect/SelectorHeader'
import { SongPreviewPanel } from './songSelect/SongPreviewPanel'
import { SongGrid } from './songSelect/SongGrid'
import { JumpToNav } from './songSelect/JumpToNav'
import { ShortcutBar } from './songSelect/ShortcutBar'
import { JukeboxQueueStrip } from './songSelect/JukeboxQueueStrip'

interface SongSelectorProps {
  onSongPicked: (song: LibrarySong) => void
}

const rootStyle = {
  '--u': DESIGN_UNIT,
  height: VIEWPORT_HEIGHT,
  paddingInline: u(64),
  paddingTop: u(52),
  paddingBottom: u(44),
  fontFamily: tokens.fontStack,
  color: TEXT.primary,
  background: 'linear-gradient(160deg, #110e1b 0%, #0a090e 55%, #0b0a12 100%)',
} as CSSProperties

export function SongSelector({ onSongPicked }: SongSelectorProps) {
  const t = useT()
  const {
    roots,
    results,
    filters,
    scanProgress,
    scanErrors,
    isReindexing,
    searchBase,
    favorites,
    search,
    searchQuery,
    loadRoots,
    addRoot,
    reindexStaleRoots,
    refreshScanErrors,
    loadFavorites,
    toggleFavorite,
    subscribeToProgress,
  } = useLibraryStore()
  const players = usePlayersStore((state) => state.players)
  const playSfx = useSfx((state) => state.play)
  const sessionMode = useSessionStore((state) => state.mode)
  const jukebox = sessionMode === 'jukebox'
  const [activeLetter, setActiveLetter] = useState<string | null>(null)
  const [shuffleSeed, setShuffleSeed] = useState(0)

  // The folder is the user's and changes behind the app's back, so opening the
  // selector re-indexes it -- without ever blocking or blanking the grid,
  // which is served from the existing index straight away.
  useEffect(() => {
    void search()
    void refreshScanErrors()
    void loadFavorites()
    void loadRoots()
      .then(() => reindexStaleRoots())
      .then(() => refreshScanErrors())
    // Highscore holders are shown by name.
    void usePlayersStore.getState().load()
    return subscribeToProgress()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, [])

  const letters = useMemo(() => letterCounts(results), [results])
  const visibleSongs = useMemo(() => {
    const filtered = activeLetter ? results.filter((song) => letterOf(song) === activeLetter) : results
    return shuffleSeed === 0 ? filtered : seededShuffle(filtered, shuffleSeed)
  }, [results, activeLetter, shuffleSeed])

  // The grid's own order is what "the next song" means when a preview plays out.
  const { selected, revealSelected, handleSelect, handleQuickStart, handleHover, handleStart } = useSongSelection(
    results,
    onSongPicked,
    visibleSongs,
  )
  const selectedPath = selected?.path ?? null

  // Every language in the library, remembered while one is chosen (the list then only holds that one).
  const languagesRef = useRef<string[]>([])
  const libraryLanguages = useMemo(() => (searchBase ? distinctLanguages(searchBase.songs) : []), [searchBase])
  if (!filters.language) languagesRef.current = libraryLanguages
  const languages = languagesRef.current

  const highscores = useSongHighscores(jukebox ? null : selectedPath)

  const handleToggleFavorite = useCallback(() => {
    if (!selectedPath) return
    playSfx('click')
    void toggleFavorite(selectedPath)
  }, [selectedPath, playSfx, toggleFavorite])

  const handleAddToQueue = useCallback(() => {
    if (!selected?.isPlayable) return
    playSfx('confirm')
    useSessionStore.getState().queueJukeboxSong(selected)
  }, [selected, playSfx])

  useSelectorShortcuts({ onFavorite: handleToggleFavorite, onAddToQueue: jukebox ? handleAddToQueue : undefined })

  if (roots.length === 0) {
    return (
      // The first-run screen still needs its way out.
      <div className="flex w-full flex-col" style={rootStyle} data-testid="song-selector">
        <header className="flex shrink-0">
          <BackButton />
        </header>
        <div
          className="m-auto flex flex-col items-center text-center"
          style={{
            maxWidth: u(560),
            gap: u(20),
            padding: u(48),
            borderRadius: u(28),
            background: SURFACE.panel,
            border: `1px solid ${SURFACE.line}`,
          }}
        >
          <h2 style={{ fontSize: u(34), fontWeight: 700 }}>{t('songSelect.empty.title')}</h2>
          <p style={{ fontSize: u(22), color: TEXT.secondary }}>{t('songSelect.empty.description')}</p>
          <AddLibraryFolderButton onFolderPicked={(folderPath) => void addRoot(folderPath)} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col overflow-hidden" style={rootStyle} data-testid="song-selector">
      <SelectorHeader
        mode={sessionMode}
        visibleCount={visibleSongs.length}
        resultCount={results.length}
        activeLetter={activeLetter}
        scanErrors={scanErrors}
        onClearLetter={() => setActiveLetter(null)}
        onQueryChange={searchQuery}
      />

      <div className="flex min-h-0 flex-1">
        <SongPreviewPanel
          selected={selected}
          isFavorite={selectedPath !== null && favorites.has(selectedPath)}
          jukebox={jukebox}
          highscores={highscores}
          players={players}
          onStart={handleStart}
          onToggleFavorite={handleToggleFavorite}
          onAddToQueue={handleAddToQueue}
        />
        <SongGrid
          songs={visibleSongs}
          selectedPath={selectedPath}
          revealSelected={revealSelected}
          favorites={favorites}
          resetKey={`${activeLetter}#${shuffleSeed}`}
          filters={filters}
          onSelect={handleSelect}
          onQuickStart={handleQuickStart}
          onHover={handleHover}
        />
        <JumpToNav letters={letters} activeLetter={activeLetter} onChange={setActiveLetter} />
      </div>

      {jukebox && <JukeboxQueueStrip shuffleSource={visibleSongs} />}

      <ShortcutBar
        filters={filters}
        languages={languages}
        jukebox={jukebox}
        isReindexing={isReindexing}
        scanProgress={scanProgress}
        indexedCount={results.length}
        onSearch={(next) => void search(next)}
        onShuffle={() => setShuffleSeed((seed) => seed + 1 || 1)}
        onRefresh={() => void reindexStaleRoots(0)}
      />
    </div>
  )
}
