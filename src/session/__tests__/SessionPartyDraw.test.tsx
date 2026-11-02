import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionPartyDraw } from '../SessionPartyDraw'
import { useSessionStore } from '../sessionStore'
import { usePlayersStore } from '../../players/store'
import { useMicSlotStore } from '../../multiplayer/store'
import { useSceneStore } from '../../scenes/sceneStore'
import { useSongPreviewStore } from '../../audio/songPreviewStore'
import { BackAuthorityProvider } from '../../scenes/SceneHeader'
import type { LibrarySong } from '../../library/types'
import type { PlayerProfile } from '../../players/types'
import * as libraryApi from '../../library/api'
import * as slotsModule from '../../multiplayer/slots'
import { t } from '../../i18n'

vi.mock('../../library/api', () => ({
  search: vi.fn(),
}))

const SONGS: LibrarySong[] = [
  {
    path: '/library/song1',
    artist: 'Artist 1',
    title: 'Song One',
    durationMs: 180000,
    thumbnailPath: '/covers/1.jpg',
    mp3Path: '/audio/1.mp3',
    videoPath: null,
    bpm: 120,
    gap: 0,
    hasVideo: false,
    hasCover: true,
    isDuet: false,
    isPlayable: true,
    addedAt: 1000,
  },
  {
    path: '/library/song2',
    artist: 'Artist 2',
    title: 'Song Two',
    durationMs: 200000,
    thumbnailPath: '/covers/2.jpg',
    mp3Path: '/audio/2.mp3',
    videoPath: null,
    bpm: 90,
    gap: 0,
    hasVideo: false,
    hasCover: true,
    isDuet: false,
    isPlayable: true,
    addedAt: 1000,
  },
  {
    path: '/library/song3',
    artist: 'Artist 3',
    title: 'Song Three',
    durationMs: 240000,
    thumbnailPath: '/covers/3.jpg',
    mp3Path: '/audio/3.mp3',
    videoPath: null,
    bpm: 180,
    gap: 0,
    hasVideo: false,
    hasCover: true,
    isDuet: false,
    isPlayable: true,
    addedAt: 1000,
  },
  {
    path: '/library/song4',
    artist: 'Artist 4',
    title: 'Song Four',
    durationMs: 210000,
    thumbnailPath: '/covers/4.jpg',
    mp3Path: '/audio/4.mp3',
    videoPath: null,
    bpm: 140,
    gap: 0,
    hasVideo: false,
    hasCover: true,
    isDuet: false,
    isPlayable: true,
    addedAt: 1000,
  },
]

const PLAYERS: PlayerProfile[] = [
  { id: 'p1', name: 'Alice', color: '#ff0055', avatarUrl: '', songsSung: 0, bestScore: 0 },
  { id: 'p2', name: 'Bob', color: '#00ccff', avatarUrl: '', songsSung: 0, bestScore: 0 },
  { id: 'p3', name: 'Charlie', color: '#ffcc00', avatarUrl: '', songsSung: 0, bestScore: 0 },
]

function renderScene() {
  return render(
    <BackAuthorityProvider onBack={() => {}}>
      <SessionPartyDraw />
    </BackAuthorityProvider>
  )
}

describe('SessionPartyDraw', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(libraryApi.search).mockResolvedValue(SONGS)

    useSessionStore.setState({
      mode: 'party',
      phase: 'party-draw',
      selectedSong: null,
      assignedPlayerIds: [],
      sessionSingCounts: {},
    })

    usePlayersStore.setState({
      players: PLAYERS,
      load: vi.fn().mockResolvedValue(PLAYERS),
    })

    useMicSlotStore.setState({
      slots: [
        { slotNumber: 1, deviceId: 'dev1', channelIndex: 0 },
        { slotNumber: 2, deviceId: 'dev2', channelIndex: 0 },
      ],
      load: vi.fn(),
    })

    useSongPreviewStore.setState({ track: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the party draw screen with title and BackButton', async () => {
    renderScene()

    expect(await screen.findByTestId('session-party-draw')).toBeInTheDocument()
    expect(screen.getByText(t('party.title'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('does not draw before slots and players finish loading (regression guard)', async () => {
    let resolveSlots: () => void = () => {}
    const slotsPromise = new Promise<void>((resolve) => {
      resolveSlots = resolve
    })

    useMicSlotStore.setState({
      slots: [],
      load: () => slotsPromise,
    })

    renderScene()

    // Flush microtasks for catalog and players to resolve, while slots remains pending
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    // While slots are in flight (catalog & players are resolved), draw must not be rendered prematurely
    expect(screen.queryByText(t('party.singers.title'))).not.toBeInTheDocument()
    expect(screen.getByText(t('party.loading'))).toBeInTheDocument()

    // Once slots load, the draw reveals
    await act(async () => {
      resolveSlots()
    })

    expect(await screen.findByText(t('party.singers.title'))).toBeInTheDocument()
  })

  it('matches classic mode: offers microphones when unconfigured so fresh installs can sing immediately', async () => {
    useMicSlotStore.setState({
      slots: [
        { slotNumber: 1, deviceId: null, channelIndex: 0 },
        { slotNumber: 2, deviceId: null, channelIndex: 1 },
      ],
      load: vi.fn().mockResolvedValue(undefined),
    })

    renderScene()

    expect(await screen.findByText(t('party.singers.title'))).toBeInTheDocument()
    expect(screen.queryByText(t('party.noMics.title'))).not.toBeInTheDocument()
  })

  it('shows the empty state when claimable microphones is empty', async () => {
    const spy = vi.spyOn(slotsModule, 'claimableMicNumbers').mockReturnValue([])

    renderScene()

    expect(await screen.findByText(t('party.noMics.title'))).toBeInTheDocument()
    expect(screen.getByText(t('party.noMics.action'))).toBeInTheDocument()

    fireEvent.click(screen.getByText(t('party.noMics.action')))
    expect(useSceneStore.getState().current).toBe('hardware-setup')
    spy.mockRestore()
  })

  it('shows the empty state when roster has no players', async () => {
    usePlayersStore.setState({
      players: [],
      load: vi.fn().mockResolvedValue([]),
    })

    renderScene()

    expect(await screen.findByText(t('party.noPlayers.title'))).toBeInTheDocument()
    expect(screen.getByText(t('party.noPlayers.action'))).toBeInTheDocument()

    fireEvent.click(screen.getByText(t('party.noPlayers.action')))
    expect(useSceneStore.getState().current).toBe('players')
  })

  it('reveals drawn singers and 3 mystery songs when ready', async () => {
    renderScene()

    expect(await screen.findByText(t('party.singers.title'))).toBeInTheDocument()
    expect(screen.getByText(t('party.songs.title', { count: 3 }))).toBeInTheDocument()

    const songCards = await screen.findAllByTestId(/party-song-card-/)
    expect(songCards).toHaveLength(3)

    // Check Start button starts disabled
    const startBtn = screen.getByTestId('party-start-button')
    expect(startBtn).toBeDisabled()
  })

  it('provides player count selector and limits active singers to selected count', async () => {
    renderScene()

    expect(await screen.findByTestId('party-player-count-selector')).toBeInTheDocument()
    const count1Btn = screen.getByTestId('player-count-1')
    const count2Btn = screen.getByTestId('player-count-2')
    expect(count1Btn).toBeInTheDocument()
    expect(count2Btn).toBeInTheDocument()

    // Default player count is 2 (2 mics available)
    expect(screen.getByText(t('party.mic', { number: 1 }))).toBeInTheDocument()
    expect(screen.getByText(t('party.mic', { number: 2 }))).toBeInTheDocument()

    // Click 1 player count
    fireEvent.click(count1Btn)

    // Wait for exit animation to remove Mic 2 slot
    await waitFor(() => {
      expect(screen.queryByText(t('party.mic', { number: 2 }))).not.toBeInTheDocument()
    })
    expect(screen.getByText(t('party.mic', { number: 1 }))).toBeInTheDocument()
  })

  it('selecting a song requests an audio preview, and starting singing clears it', async () => {
    renderScene()

    const songCards = await screen.findAllByTestId(/party-song-card-/)
    expect(songCards).toHaveLength(3)

    // Click the first song card
    fireEvent.click(songCards[0])

    // Audio preview was requested
    expect(useSongPreviewStore.getState().track).toMatch(/^aetherstar-media:\/\/roots\/audio\/\d\.mp3$/)

    const startBtn = screen.getByTestId('party-start-button')
    expect(startBtn).not.toBeDisabled()

    // Click start singing
    fireEvent.click(startBtn)

    // Preview cleared immediately on start
    expect(useSongPreviewStore.getState().track).toBeNull()

    const sessionState = useSessionStore.getState()
    expect(sessionState.phase).toBe('starting')
    expect(sessionState.selectedSong).not.toBeNull()
    expect(sessionState.assignedPlayerIds.length).toBeGreaterThan(0)
    expect(useSceneStore.getState().current).toBe('session-starting')
  })

  it('double clicking a song card clears preview and quick-starts directly', async () => {
    renderScene()

    const songCards = await screen.findAllByTestId(/party-song-card-/)
    fireEvent.click(songCards[1])
    expect(useSongPreviewStore.getState().track).toMatch(/^aetherstar-media:\/\/roots\/audio\/\d\.mp3$/)

    fireEvent.doubleClick(songCards[1])

    expect(useSongPreviewStore.getState().track).toBeNull()
    const sessionState = useSessionStore.getState()
    expect(sessionState.phase).toBe('starting')
    expect(sessionState.selectedSong).not.toBeNull()
    expect(useSceneStore.getState().current).toBe('session-starting')
  })

  it('clicking Pass Mic replaces the singer from the bench and re-rolls the 3 songs', async () => {
    renderScene()

    const optOutBtn = await screen.findByTestId('opt-out-slot-0')
    expect(optOutBtn).not.toBeDisabled()

    fireEvent.click(optOutBtn)

    // State updated with bench replacement
    await waitFor(() => {
      expect(screen.getByTestId('party-songs-grid')).toBeInTheDocument()
    })
  })

  it('clicking Solo/Duet on the mode switcher clears preview and switches back to classic session-select', async () => {
    renderScene()

    const songCards = await screen.findAllByTestId(/party-song-card-/)
    fireEvent.click(songCards[0])
    expect(useSongPreviewStore.getState().track).toMatch(/^aetherstar-media:\/\/roots\/audio\/\d\.mp3$/)

    const switcher = await screen.findByTestId('party-mode-switcher')
    const classicBtn = switcher.querySelector('button')
    expect(classicBtn).toHaveTextContent('Solo/Duet')

    fireEvent.click(classicBtn!)

    expect(useSongPreviewStore.getState().track).toBeNull()
    expect(useSessionStore.getState().mode).toBe('classic')
    expect(useSessionStore.getState().phase).toBe('select')
    expect(useSceneStore.getState().current).toBe('session-select')
  })
})
