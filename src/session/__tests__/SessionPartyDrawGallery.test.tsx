import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionPartyDraw } from '../SessionPartyDraw'
import { useSessionStore } from '../sessionStore'
import { usePlayersStore } from '../../players/store'
import { useMicSlotStore } from '../../multiplayer/store'
import { useSongPreviewStore } from '../../audio/songPreviewStore'
import { BackAuthorityProvider } from '../../scenes/SceneHeader'
import type { LibrarySong } from '../../library/types'
import type { PlayerProfile } from '../../players/types'
import * as libraryApi from '../../library/api'
import { HOVER_PREVIEW_DELAY_MS } from '../partyDraw/PartySongGallery'

vi.mock('../../library/api', () => ({
  search: vi.fn(),
}))

function song(n: number, extra: Partial<LibrarySong> = {}): LibrarySong {
  return {
    path: `/library/song${n}`,
    artist: `Artist ${n}`,
    title: `Song ${n}`,
    durationMs: 180000 + n * 1000,
    thumbnailPath: `/covers/${n}.jpg`,
    mp3Path: `/audio/${n}.mp3`,
    videoPath: null,
    bpm: 120,
    gap: 0,
    hasVideo: false,
    hasCover: true,
    isDuet: false,
    isPlayable: true,
    addedAt: 1000,
    ...extra,
  }
}

// Exactly three songs, so every one of them is dealt whatever the shuffle.
const SONGS: LibrarySong[] = [
  song(1, { isDuet: true, language: 'German' }),
  song(2, { hasVideo: true, edition: 'Party Hits' }),
  song(3, { thumbnailPath: null }),
]

const PLAYERS: PlayerProfile[] = [
  { id: 'p1', name: 'Alice', color: '#ff0055', avatarUrl: '', songsSung: 0, bestScore: 0 },
  { id: 'p2', name: 'Bob', color: '#00ccff', avatarUrl: '', songsSung: 0, bestScore: 0 },
]

const savedApi = window.api

function renderScene() {
  return render(
    <BackAuthorityProvider onBack={() => {}}>
      <SessionPartyDraw />
    </BackAuthorityProvider>,
  )
}

function cardFor(title: string): HTMLElement {
  const card = screen.getAllByTestId(/^party-song-card-/).find((element) => within(element).queryByText(title))
  if (!card) throw new Error(`no card for ${title}`)
  return card
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(libraryApi.search).mockResolvedValue(SONGS)
  window.api = {
    session: {
      listSongHighscores: vi.fn(({ songPath }: { songPath: string }) =>
        Promise.resolve(
          songPath === '/library/song2'
            ? [
                { sessionId: 's', songPath, playerId: 'p2', score: 6100, epicCount: 0, goodCount: 0, awfulCount: 0, playedAt: 1, difficulty: 'easy' },
                { sessionId: 's', songPath, playerId: 'p1', score: 8450, epicCount: 0, goodCount: 0, awfulCount: 0, playedAt: 1, difficulty: 'hard' },
              ]
            : [],
        ),
      ),
    },
  } as unknown as typeof window.api
  useSessionStore.setState({ mode: 'party', phase: 'party-draw', selectedSong: null, assignedPlayerIds: [], sessionSingCounts: {} })
  usePlayersStore.setState({ players: PLAYERS, load: vi.fn().mockResolvedValue(PLAYERS) })
  useMicSlotStore.setState({
    slots: [
      { slotNumber: 1, deviceId: 'dev1', channelIndex: 0 },
      { slotNumber: 2, deviceId: 'dev2', channelIndex: 0 },
    ],
    load: vi.fn(),
  })
  useSongPreviewStore.setState({ track: null, previewStartSec: null })
})

afterEach(() => {
  window.api = savedApi
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SessionPartyDraw gallery layout', () => {
  it('is exactly one window tall, with the gallery taking only the leftover height', async () => {
    renderScene()
    await screen.findAllByTestId(/^party-song-card-/)

    const root = screen.getByTestId('session-party-draw')
    expect(root.style.height).toBe('100vh')
    expect(root).toHaveClass('overflow-hidden')

    const songs = screen.getByTestId('party-songs')
    expect(songs).toHaveClass('flex-1')
    const band = screen.getByTestId('party-songs-grid')
    expect(band).toHaveClass('flex-1', 'overflow-auto')
    expect(songs).toContainElement(band)

    // Start is in its own non-shrinking footer, never inside the band.
    const footer = screen.getByTestId('party-footer')
    expect(footer).toHaveClass('shrink-0')
    expect(footer).toContainElement(screen.getByTestId('party-start-button'))
    expect(band).not.toContainElement(screen.getByTestId('party-start-button'))
  })

  it('sizes every card from the band (cqw and cqh), with a square cover as wide as the card', async () => {
    renderScene()
    const cards = await screen.findAllByTestId(/^party-song-card-/)

    const band = screen.getByTestId('party-songs-grid')
    const cardWidth = band.style.getPropertyValue('--party-card-w')
    expect(cardWidth).toContain('100cqw')
    expect(cardWidth).toContain('100cqh')

    cards.forEach((card, index) => {
      expect(card.style.width).toBe('var(--party-card-w)')
      const cover = within(card).getByTestId(`party-song-cover-${index}`)
      expect(cover.style.aspectRatio).toBe('1 / 1')
      expect(cover).toHaveClass('w-full', 'flex-none')
    })
  })

  it('declares no fixed pixel height anywhere on the screen that could outgrow a 1024x640 window', async () => {
    renderScene()
    await screen.findAllByTestId(/^party-song-card-/)

    const root = screen.getByTestId('session-party-draw')
    const offenders: string[] = []
    for (const element of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
      for (const property of ['height', 'min-height', 'max-height'] as const) {
        const value = element.style.getPropertyValue(property)
        const px = /^(\d+(?:\.\d+)?)px$/.exec(value)
        if (px && Number(px[1]) > 120) offenders.push(`${element.tagName}.${property}=${value}`)
      }
    }
    expect(offenders).toEqual([])
    // The old grid is gone: no fixed three-column track that ignores height.
    expect(root.querySelector('.grid-cols-3')).toBeNull()
  })
})

describe('SessionPartyDraw gallery cards', () => {
  it('shows title, artist, length, duet, video, language and edition on the cards', async () => {
    renderScene()
    await screen.findAllByTestId(/^party-song-card-/)

    const first = cardFor('Song 1')
    expect(within(first).getByText('Artist 1')).toBeInTheDocument()
    expect(within(first).getByText('3:01')).toBeInTheDocument()
    expect(within(first).getByText('Duet')).toBeInTheDocument()
    expect(within(first).getByText('German')).toBeInTheDocument()

    const second = cardFor('Song 2')
    expect(within(second).getByText('Video')).toBeInTheDocument()
    expect(within(second).getByText('Party Hits')).toBeInTheDocument()

    // No cover art: a placeholder square, not a collapsed card.
    const third = cardFor('Song 3')
    expect(third.querySelector('img')).toBeNull()
  })

  it('shows each song\'s record across difficulties and who holds it, or that there is none', async () => {
    renderScene()
    await screen.findAllByTestId(/^party-song-card-/)

    await waitFor(() => expect(within(cardFor('Song 2')).getByText(/Best: 8,450 by Alice/)).toBeInTheDocument())
    expect(within(cardFor('Song 1')).getByText('No score yet')).toBeInTheDocument()
    expect(window.api!.session.listSongHighscores).toHaveBeenCalledWith({ songPath: '/library/song2', limit: 1 })
  })

  it('paints the picked card in the first singer\'s mic colour', async () => {
    renderScene()
    await screen.findAllByTestId(/^party-song-card-/)

    const card = cardFor('Song 2')
    fireEvent.click(card)
    expect(card).toHaveAttribute('aria-pressed', 'true')
    expect(card).toHaveAttribute('data-selected', 'true')
    expect(card.style.boxShadow).toContain('oklch(0.78 0.19 195)')
    expect(cardFor('Song 1')).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('SessionPartyDraw gallery previews', () => {
  it('auditions a card on focus without picking it, and hands back when focus leaves', async () => {
    renderScene()
    await screen.findAllByTestId(/^party-song-card-/)

    fireEvent.click(cardFor('Song 1'))
    expect(useSongPreviewStore.getState().track).toMatch(/audio\/1\.mp3$/)

    fireEvent.focus(cardFor('Song 2'))
    expect(useSongPreviewStore.getState().track).toMatch(/audio\/2\.mp3$/)
    expect(cardFor('Song 2')).toHaveAttribute('aria-pressed', 'false')
    expect(cardFor('Song 1')).toHaveAttribute('aria-pressed', 'true')

    // To Start: the picked song plays again.
    fireEvent.blur(cardFor('Song 2'), { relatedTarget: screen.getByTestId('party-start-button') })
    expect(useSongPreviewStore.getState().track).toMatch(/audio\/1\.mp3$/)
  })

  it('auditions a card the pointer rests on, not one it sweeps across, and stops when it leaves', async () => {
    renderScene()
    await screen.findAllByTestId(/^party-song-card-/)
    vi.useFakeTimers()

    fireEvent.mouseEnter(cardFor('Song 1'))
    fireEvent.mouseEnter(cardFor('Song 3'))
    act(() => {
      vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS - 50)
    })
    expect(useSongPreviewStore.getState().track).toBeNull()
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(useSongPreviewStore.getState().track).toMatch(/audio\/3\.mp3$/)

    // Nothing picked yet, so leaving the gallery goes quiet.
    fireEvent.mouseLeave(screen.getByTestId('party-songs-grid'))
    expect(useSongPreviewStore.getState().track).toBeNull()
  })
})
