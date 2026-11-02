// The party draw's state: load the catalogue, roster and mics, deal a round
// (singers + mystery songs), and react to passing a mic or picking a song.
import { useEffect, useMemo, useRef, useState } from 'react'
import { search } from '../../library/api'
import type { LibrarySong } from '../../library/types'
import { toLibraryMediaUrl } from '../../library/mediaUrl'
import { claimableMicNumbers } from '../../multiplayer/slots'
import { useMicSlotStore } from '../../multiplayer/store'
import { usePlayersStore } from '../../players/store'
import { useSfx } from '../../audio/useSfx'
import { useSongPreviewStore } from '../../audio/songPreviewStore'
import { useSessionStore } from '../sessionStore'
import { previewAudioPath } from '../previewAudioPath'
import { canSlotOptOut, executeOptOut, initPartyRound, type PartyRoundState } from '../party/partyDrawLogic'
import { resizePartyLineup } from './resizeLineup'

export type PartyRoundStatus = 'loading' | 'ready' | 'no-mics' | 'no-players'

function previewTrackFor(song: LibrarySong | null): string | null {
  const path = previewAudioPath(song)
  return path ? toLibraryMediaUrl(path) : null
}

/** Resolves once a store's `load()` has finished -- or at once, for a stand-in that returns nothing. */
function whenLoaded(result: unknown, done: () => void) {
  if (result && typeof (result as Promise<unknown>).then === 'function') void (result as Promise<unknown>).then(done)
  else done()
}

export function usePartyRound() {
  const confirmPartyDraw = useSessionStore((state) => state.confirmPartyDraw)
  const sessionSingCounts = useSessionStore((state) => state.sessionSingCounts)
  const players = usePlayersStore((state) => state.players)
  const slots = useMicSlotStore((state) => state.slots)
  const playSfx = useSfx((state) => state.play)

  const [catalog, setCatalog] = useState<LibrarySong[]>([])
  const [catalogLoaded, setCatalogLoaded] = useState(false)
  const [playersLoaded, setPlayersLoaded] = useState(false)
  const [slotsLoaded, setSlotsLoaded] = useState(false)
  const [roundState, setRoundState] = useState<PartyRoundState | null>(null)
  const [selectedSong, setSelectedSong] = useState<LibrarySong | null>(null)
  const [roundStatus, setRoundStatus] = useState<PartyRoundStatus>('loading')

  // The same mic authority as Solo/Duet: configured mics, or all eight on a fresh setup.
  const claimable = useMemo(() => claimableMicNumbers(slots), [slots])

  const maxSelectable = Math.max(1, Math.min(players.length, claimable.length))
  const [playerCount, setPlayerCount] = useState<number>(() => Math.min(2, maxSelectable))
  const activePlayerCount = Math.min(playerCount, maxSelectable)
  // What the deal below reads, so that changing the count resizes the line-up
  // (changePlayerCount) instead of dealing a whole new round -- see
  // resizeLineup.ts. Written only from the event handler, never during render.
  const playerCountRef = useRef(playerCount)

  useEffect(() => {
    return () => useSongPreviewStore.getState().clearPreview()
  }, [])

  useEffect(() => {
    let cancelled = false
    void search({}).then((songs) => {
      if (cancelled) return
      setCatalog(songs)
      setCatalogLoaded(true)
    })
    whenLoaded(usePlayersStore.getState().load(), () => {
      if (!cancelled) setPlayersLoaded(true)
    })
    whenLoaded(useMicSlotStore.getState().load(), () => {
      if (!cancelled) setSlotsLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const allLoaded = catalogLoaded && playersLoaded && slotsLoaded

  // Deal only once everything is in: drawing against a half-loaded roster or
  // mic list would deal the wrong singers. Not on a change of the singer
  // count: that keeps the songs and the singers already drawn.
  useEffect(() => {
    if (!allLoaded) return
    const result = initPartyRound({
      catalog,
      allPlayers: players,
      claimableMicNumbers: claimable.slice(0, Math.min(playerCountRef.current, maxSelectable)),
      sessionSingCounts,
    })
    setRoundStatus(result.status)
    if (result.status === 'ready') {
      setRoundState(result.state)
      setSelectedSong(null)
    }
  }, [allLoaded, catalog, players, claimable, maxSelectable, sessionSingCounts])

  /**
   * One commit: the count and the resized line-up land together, so the
   * singers strip changes height at most once and the song cards -- and the
   * pick among them, and its preview -- are left alone.
   */
  const changePlayerCount = (count: number) => {
    const next = Math.max(1, Math.min(count, maxSelectable))
    if (next === activePlayerCount) return
    playSfx('click')
    playerCountRef.current = next
    setPlayerCount(next)
    setRoundState((prev) => (prev ? resizePartyLineup(prev, next, players) : prev))
  }

  const canPass = (slotIndex: number) => Boolean(roundState && canSlotOptOut(slotIndex, roundState, players))

  /** Hand a mic to someone on the bench; the songs are re-dealt with it. */
  const passMic = (slotIndex: number) => {
    if (!roundState || !canSlotOptOut(slotIndex, roundState, players)) return
    playSfx('uiBing')
    useSongPreviewStore.getState().clearPreview()
    const { state: nextState, replacedPlayerId } = executeOptOut(slotIndex, roundState, players)
    if (replacedPlayerId) {
      setRoundState(nextState)
      setSelectedSong(null)
    }
  }

  const requestPreviewOf = (song: LibrarySong) =>
    useSongPreviewStore
      .getState()
      .requestPreview(previewTrackFor(song), { previewStartSec: song.previewStartSec ?? undefined })

  const selectSong = (song: LibrarySong) => {
    // Re-picking the picked card is a no-op, so the two clicks of a double click sound once.
    if (selectedSong?.path === song.path) return
    playSfx('click')
    setSelectedSong(song)
    requestPreviewOf(song)
  }

  /**
   * Audition a card the player is resting on (focus, or a pointer that
   * stopped). Null hands the preview back to the picked song, or to silence
   * when nothing is picked yet. Never changes the pick.
   */
  const previewSong = (song: LibrarySong | null) => {
    const target = song ?? selectedSong
    if (target) requestPreviewOf(target)
    else useSongPreviewStore.getState().clearPreview()
  }

  const start = (song: LibrarySong | null = selectedSong) => {
    if (!song || !roundState) return
    useSongPreviewStore.getState().clearPreview()
    playSfx('confirm')
    confirmPartyDraw(song, roundState.assignedPlayerIds)
  }

  return {
    status: allLoaded ? roundStatus : ('loading' as const),
    roundState,
    selectedSong,
    players,
    claimable,
    sessionSingCounts,
    maxSelectable,
    activePlayerCount,
    changePlayerCount,
    canPass,
    passMic,
    selectSong,
    previewSong,
    start,
  }
}
