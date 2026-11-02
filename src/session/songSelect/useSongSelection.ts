import { useCallback, useEffect, useRef, useState } from 'react'
import { useSongPreviewStore } from '../../audio/songPreviewStore'
import { useMenuMusicStore } from '../../audio/menuMusic'
import { useSfx } from '../../audio/useSfx'
import type { LibrarySong } from '../../library/types'
import { previewTrackFor } from './layout'

/**
 * How long after the last focus move (arrow key, stick, click) the user still
 * counts as navigating. While they are, a preview that plays out still moves
 * the selection on, but neither scrolls the grid nor moves focus under them.
 */
export const NAVIGATION_IDLE_MS = 2000

/**
 * Song Select previews play once, to the end of the song, and are then
 * reported as ended so the selector can move on (see `useSongSelection`)
 * rather than looping.
 */
function requestPreviewOf(song: LibrarySong) {
  useSongPreviewStore
    .getState()
    .requestPreview(previewTrackFor(song), { previewStartSec: song.previewStartSec ?? undefined, loop: false })
}

/** Whether a song can be previewed at all: playable, with audio to play. */
function isPreviewable(song: LibrarySong): boolean {
  return song.isPlayable && previewTrackFor(song) !== null
}

/**
 * The song after `current` in `order` that can be previewed, wrapping to the
 * top at the end. From the top when `current` is not in `order` (a letter
 * filter hid it). Null when nothing else qualifies -- including when the only
 * previewable song is `current` itself.
 */
export function nextPreviewableSong(order: readonly LibrarySong[], current: LibrarySong | null): LibrarySong | null {
  if (order.length === 0) return null
  const index = current === null ? -1 : order.findIndex((song) => song.path === current.path)
  const start = index + 1
  for (let step = 0; step < order.length; step++) {
    const candidate = order[(start + step) % order.length]
    if (candidate.path === current?.path) continue
    if (isPreviewable(candidate)) return candidate
  }
  return null
}

/** The grid card for `path`, if it is rendered (the grid is virtualized). */
function tileFor(path: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>('[data-song-path]')) {
    if (element.dataset.songPath === path) return element
  }
  return null
}

/**
 * The selected song and the preview that follows it.
 *
 * This screen only *requests* a preview (App.tsx owns playback), and never on
 * unmount: the chosen song has to keep playing into Player Selection.
 *
 * `order` is the list as the grid shows it (letter filter, shuffle): when a
 * preview plays out, the selection moves on to the next song in it.
 */
export function useSongSelection(
  results: LibrarySong[],
  onSongPicked: (song: LibrarySong) => void,
  order: readonly LibrarySong[] = results,
) {
  const playSfx = useSfx((state) => state.play)
  const [selected, setSelected] = useState<LibrarySong | null>(null)
  // False while an automatic move happened mid-navigation: the grid then
  // leaves its scroll position (and the user's focus) alone.
  const [revealSelected, setRevealSelected] = useState(true)

  // Keep the selection while it is still in the results; otherwise reopen on
  // whatever is already previewing (Back from Player Selection) so the audio
  // does not restart; else on the library song the menu music is playing, so
  // it carries on as this song's preview instead of being cut off (App.tsx
  // hands the very source over); else the first result.
  useEffect(() => {
    setSelected((current) => {
      if (current && results.some((s) => s.path === current.path)) return current
      const live = useSongPreviewStore.getState().track
      const playing = live === null ? undefined : results.find((song) => previewTrackFor(song) === live)
      if (playing) return playing
      const menuTrack = live === null ? useMenuMusicStore.getState().track : null
      const menuSong = menuTrack === null ? undefined : results.find((song) => previewTrackFor(song) === menuTrack)
      return menuSong ?? results[0] ?? null
    })
  }, [results])

  // Nothing selected (the first frame, an empty search) leaves the current
  // preview alone rather than stopping it and starting it again a frame later.
  useEffect(() => {
    if (selected === null) return
    requestPreviewOf(selected)
  }, [selected])

  // When the user last moved focus, for the idle check below. Our own focus
  // moves (following an automatic advance) do not count.
  const lastNavigationAtRef = useRef(Number.NEGATIVE_INFINITY)
  const programmaticFocusRef = useRef(false)
  useEffect(() => {
    const markNavigation = () => {
      if (!programmaticFocusRef.current) lastNavigationAtRef.current = performance.now()
    }
    document.addEventListener('focusin', markNavigation)
    window.addEventListener('keydown', markNavigation)
    window.addEventListener('pointerdown', markNavigation)
    return () => {
      document.removeEventListener('focusin', markNavigation)
      window.removeEventListener('keydown', markNavigation)
      window.removeEventListener('pointerdown', markNavigation)
    }
  }, [])

  // The preview of the selected song played to its end: move on to the next
  // song, as if the user had picked it. Idle, the grid scrolls to it and -- if
  // focus was resting on the song that just ended -- focus follows, so the
  // focus ring and the selection stay one. Mid-navigation, only the selection
  // moves: no scrolling the grid away from the card the user is on, and no
  // pulling focus out from under them.
  const endedTrack = useSongPreviewStore((state) => state.endedTrack)
  const orderRef = useRef(order)
  orderRef.current = order
  useEffect(() => {
    if (selected === null || endedTrack === null || endedTrack !== previewTrackFor(selected)) return
    const next = nextPreviewableSong(orderRef.current, selected)
    if (next === null) return

    const idle = performance.now() - lastNavigationAtRef.current >= NAVIGATION_IDLE_MS
    const active = document.activeElement
    const focusOnSelected = active instanceof HTMLElement && active.dataset.songPath === selected.path
    setRevealSelected(idle)
    setSelected(next)
    if (!idle || !focusOnSelected) return

    // The card exists only once the grid has scrolled to it and rendered its
    // row, a frame or two from now.
    let attempts = 0
    const focusNext = () => {
      const tile = tileFor(next.path)
      if (tile) {
        programmaticFocusRef.current = true
        try {
          tile.focus({ preventScroll: true })
        } finally {
          programmaticFocusRef.current = false
        }
      } else if (++attempts < 5) {
        requestAnimationFrame(focusNext)
      }
    }
    requestAnimationFrame(focusNext)
  }, [endedTrack, selected])

  // Refs, so the handlers handed to every memoised tile keep one identity.
  const selectedPathRef = useRef<string | null>(null)
  selectedPathRef.current = selected?.path ?? null
  const onSongPickedRef = useRef(onSongPicked)
  onSongPickedRef.current = onSongPicked

  // Re-clicking the selected card is a no-op, which is also what keeps the
  // two clicks of a double click from sounding or re-requesting twice.
  const handleSelect = useCallback(
    (song: LibrarySong) => {
      if (selectedPathRef.current === song.path) return
      playSfx('click')
      setRevealSelected(true)
      setSelected(song)
    },
    [playSfx],
  )

  /** Double click: commit this song exactly as the panel's primary button would. */
  const handleQuickStart = useCallback(
    (song: LibrarySong) => {
      if (!song.isPlayable) return
      playSfx('confirm')
      setRevealSelected(true)
      setSelected(song)
      // Stated here too, for a double click that arrives with no prior selection.
      requestPreviewOf(song)
      onSongPickedRef.current(song)
    },
    [playSfx],
  )

  const handleHover = useCallback(() => playSfx('hover'), [playSfx])

  /** The panel's primary button. The preview keeps running; App.tsx fades it at launch. */
  const handleStart = useCallback(() => {
    if (!selected?.isPlayable) return
    playSfx('confirm')
    onSongPickedRef.current(selected)
  }, [selected, playSfx])

  return { selected, revealSelected, handleSelect, handleQuickStart, handleHover, handleStart }
}
