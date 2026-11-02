// "Add songs": the song list's search and grid, opened in place over the
// playing song. Picking a song (click, Enter, gamepad A) adds it to the end of
// the queue; nothing here touches playback, and nothing previews (the song
// list's preview would talk over the music). Back or Done closes it.
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useT } from '../i18n'
import { useSfx } from '../audio/useSfx'
import { Button } from '../design/primitives/GlassButton'
import { tokens } from '../design/tokens'
import { SearchBar } from '../library/SearchBar'
import { fuzzyFilter } from '../library/fuzzySearch'
import { useLibraryStore } from '../library/useLibraryStore'
import type { LibrarySong } from '../library/types'
import { useSessionStore } from '../session/sessionStore'
import { SongGrid } from '../session/songSelect/SongGrid'
import { DESIGN_UNIT } from '../session/songSelect/layout'
import { useJukeboxUiStore } from './jukeboxUiStore'

/** The two clicks of a double click land on the same card: one add, not two. */
const REPEAT_ADD_GUARD_MS = 400

const NO_FILTERS = {}

export function AddSongsOverlay() {
  const t = useT()
  const titleId = useId()
  const playSfx = useSfx((state) => state.play)
  const searchBase = useLibraryStore((state) => state.searchBase)
  const results = useLibraryStore((state) => state.results)
  const favorites = useLibraryStore((state) => state.favorites)
  const queueLength = useSessionStore((state) => state.jukeboxQueue.length)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [lastAdded, setLastAdded] = useState<LibrarySong | null>(null)
  const lastAddRef = useRef<{ path: string; at: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // The library as the song list last read it (its filters, not its search
  // text). Opened before anything was read -- straight from a finished queue
  // after a restart, say -- it reads it now.
  const base = searchBase?.songs ?? results
  useEffect(() => {
    if (!useLibraryStore.getState().searchBase) void useLibraryStore.getState().search()
  }, [])

  const songs = useMemo(() => {
    const playable = base.filter((song) => song.isPlayable)
    const trimmed = deferredQuery.trim()
    return trimmed ? fuzzyFilter(playable, trimmed) : playable
  }, [base, deferredQuery])

  // Focus lands on the first card (the grid renders a frame later), else the search.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    let attempts = 0
    let frame = requestAnimationFrame(function focusFirst() {
      const root = rootRef.current
      const card = root?.querySelector<HTMLElement>('[data-testid="song-selector-grid"] button')
      if (card) card.focus()
      else if (++attempts < 10) frame = requestAnimationFrame(focusFirst)
      else root?.querySelector<HTMLElement>('input[type="search"]')?.focus()
    })
    return () => {
      cancelAnimationFrame(frame)
      // Back to whatever opened it (the queue panel's Add songs button).
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  const handleAdd = useCallback(
    (song: LibrarySong) => {
      const now = performance.now()
      const last = lastAddRef.current
      if (last && last.path === song.path && now - last.at < REPEAT_ADD_GUARD_MS) return
      lastAddRef.current = { path: song.path, at: now }
      playSfx('confirm')
      useSessionStore.getState().queueJukeboxSong(song)
      setLastAdded(song)
    },
    [playSfx],
  )
  const ignore = useCallback(() => {}, [])
  const handleHover = useCallback(() => playSfx('hover'), [playSfx])

  const close = () => {
    playSfx('back')
    useJukeboxUiStore.getState().setAddSongsOpen(false)
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-[clamp(1rem,3vw,3rem)]">
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-focus-scope
        data-testid="jukebox-add-songs"
        className="flex h-full w-full max-w-[110rem] flex-col gap-5 overflow-hidden rounded-3xl bg-surface-panel border border-line p-[clamp(1rem,2vw,2rem)] shadow-2xl"
        style={{ '--u': DESIGN_UNIT, fontFamily: tokens.fontStack } as CSSProperties}
      >
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-3xl font-bold text-ink-primary">
              {t('jukebox.add.title')}
            </h2>
            <p className="text-lg text-ink-secondary">{t('jukebox.add.hint')}</p>
          </div>
          <div
            onKeyDown={(event) => {
              // From the search box, Down goes to the songs (arrows otherwise stay in the text).
              if (event.key !== 'ArrowDown') return
              const card = rootRef.current?.querySelector<HTMLElement>('[data-testid="song-selector-grid"] button')
              if (!card) return
              event.preventDefault()
              card.focus()
            }}
          >
            <SearchBar onQueryChange={setQuery} resultCount={base.length} />
          </div>
          <span className="text-lg font-semibold text-ink-secondary" data-testid="jukebox-add-songs-count">
            {t('jukebox.queue.count', { count: queueLength })}
          </span>
          <Button type="button" variant="primary" sfx="back" className="text-lg font-semibold" onClick={close} data-testid="jukebox-add-songs-done">
            {t('jukebox.add.done')}
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {songs.length === 0 ? (
            <p className="m-auto text-xl text-ink-secondary">{t('jukebox.add.empty')}</p>
          ) : (
            <SongGrid
              songs={songs}
              selectedPath={lastAdded?.path ?? null}
              favorites={favorites}
              resetKey={deferredQuery}
              filters={NO_FILTERS}
              onSelect={handleAdd}
              onQuickStart={ignore}
              onHover={handleHover}
            />
          )}
        </div>

        <div role="status" aria-live="polite" className="min-h-7 text-lg font-semibold text-accent-cyan" data-testid="jukebox-add-songs-status">
          {lastAdded ? t('jukebox.add.added', { title: lastAdded.title }) : ''}
        </div>
      </div>
    </div>
  )
}
