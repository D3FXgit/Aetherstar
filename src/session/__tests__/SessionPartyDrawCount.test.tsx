// Changing the Party "Singers" count must not make the screen jump: the song
// cards stay mounted at the same size and only the singer slots that come or
// go animate (see partyDraw/resizeLineup.ts).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionPartyDraw } from '../SessionPartyDraw'
import { useSessionStore } from '../sessionStore'
import { usePlayersStore } from '../../players/store'
import { useMicSlotStore } from '../../multiplayer/store'
import { useSongPreviewStore } from '../../audio/songPreviewStore'
import { BackAuthorityProvider } from '../../scenes/SceneHeader'
import type { LibrarySong } from '../../library/types'
import type { PlayerProfile } from '../../players/types'
import * as libraryApi from '../../library/api'

vi.mock('../../library/api', () => ({
  search: vi.fn(),
}))

const SONGS: LibrarySong[] = Array.from({ length: 9 }, (_, i) => ({
  path: `/library/song${i + 1}`,
  artist: `Artist ${i + 1}`,
  title: `Song ${i + 1}`,
  durationMs: 180000,
  thumbnailPath: null,
  mp3Path: `/audio/${i + 1}.mp3`,
  videoPath: null,
  bpm: 120,
  gap: 0,
  hasVideo: false,
  hasCover: false,
  isDuet: false,
  isPlayable: true,
  addedAt: 1000,
}))

const PLAYERS: PlayerProfile[] = ['Alice', 'Bob', 'Charlie', 'Dana', 'Eve'].map((name, i) => ({
  id: `p${i + 1}`,
  name,
  color: '#ff0055',
  avatarUrl: '',
  songsSung: 0,
  bestScore: 0,
}))

function renderScene() {
  return render(
    <BackAuthorityProvider onBack={() => {}}>
      <SessionPartyDraw />
    </BackAuthorityProvider>,
  )
}

const songCards = () => screen.getAllByTestId(/^party-song-card-\d+$/)
/** The card (motion.div) of a singer slot, found through its Pass button. */
const singerCard = (slotIndex: number) => screen.getByTestId(`opt-out-slot-${slotIndex}`).parentElement!
const slotCount = () => screen.queryAllByTestId(/^opt-out-slot-\d+$/).length

describe('SessionPartyDraw singer count changes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(libraryApi.search).mockResolvedValue(SONGS)
    useSessionStore.setState({ mode: 'party', phase: 'party-draw', selectedSong: null, assignedPlayerIds: [], sessionSingCounts: {} })
    usePlayersStore.setState({ players: PLAYERS, load: vi.fn().mockResolvedValue(PLAYERS) })
    useMicSlotStore.setState({
      slots: [1, 2, 3, 4].map((slotNumber) => ({ slotNumber, deviceId: `dev${slotNumber}`, channelIndex: 0 })),
      load: vi.fn(),
    })
    useSongPreviewStore.setState({ track: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps every song card mounted, at the same size, and the singers already drawn', async () => {
    renderScene()
    await screen.findByTestId('party-player-count-selector')
    expect(slotCount()).toBe(2)

    const band = screen.getByTestId('party-songs-grid')
    const cardsBefore = songCards()
    const titlesBefore = cardsBefore.map((card) => card.querySelector('h3')?.textContent)
    const cardWidthBefore = band.style.getPropertyValue('--party-card-w')
    const firstSingerCard = singerCard(0)
    const firstSingerName = firstSingerCard.textContent

    // Anything that touches the band -- a card mounted or unmounted, or its
    // size recomputed -- is recorded here.
    const bandMutations: MutationRecord[] = []
    const observer = new MutationObserver((records) => bandMutations.push(...records))
    observer.observe(band, { attributes: true, attributeFilter: ['style'], childList: true })

    for (const count of [3, 4, 1, 2]) {
      fireEvent.click(screen.getByTestId(`player-count-${count}`))
      await waitFor(() => expect(slotCount()).toBe(count))

      // The very same nodes: no song card was unmounted and dealt again.
      const cardsNow = songCards()
      expect(cardsNow).toHaveLength(cardsBefore.length)
      cardsNow.forEach((card, index) => expect(card).toBe(cardsBefore[index]))
      expect(cardsNow.map((card) => card.querySelector('h3')?.textContent)).toEqual(titlesBefore)
      expect(band.style.getPropertyValue('--party-card-w')).toBe(cardWidthBefore)
      // Mic 1's singer keeps the slot, and the card.
      expect(singerCard(0)).toBe(firstSingerCard)
      expect(singerCard(0).textContent).toBe(firstSingerName)
    }

    await act(async () => {
      await Promise.resolve()
    })
    observer.disconnect()
    expect(bandMutations).toEqual([])
  })

  it('draws distinct singers for the added slots', async () => {
    renderScene()
    await screen.findByTestId('party-player-count-selector')

    fireEvent.click(screen.getByTestId('player-count-4'))
    await waitFor(() => expect(slotCount()).toBe(4))

    const names = [0, 1, 2, 3].map((slot) => singerCard(slot).textContent)
    expect(new Set(names).size).toBe(4)
  })

  it('keeps the picked song picked', async () => {
    renderScene()
    await screen.findByTestId('party-player-count-selector')

    fireEvent.click(songCards()[1])
    expect(songCards()[1]).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByTestId('player-count-3'))
    await waitFor(() => expect(slotCount()).toBe(3))

    expect(songCards()[1]).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('party-start-button')).toBeEnabled()
  })

  it('anchors popLayout exits to the strip and the band, so leaving cards fade in place', async () => {
    renderScene()
    await screen.findByTestId('party-player-count-selector')

    expect(screen.getByTestId('party-singers-strip')).toHaveClass('relative')
    expect(screen.getByTestId('party-songs-grid')).toHaveClass('relative')
  })
})
