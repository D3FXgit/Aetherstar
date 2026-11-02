import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, within, waitFor, act } from '@testing-library/react'
import { motionValue } from 'framer-motion'
import { MultiplayerGameplay } from '../MultiplayerGameplay'
import { usePlayersStore } from '../../players/store'
import { usePitchStore } from '../../audio/pitchStore'
import { useMicSlotStore } from '../store'
import { useHitStore } from '../../game/state/useHitStore'
import { useScoreStore } from '../../game/state/useScoreStore'
import { toMicSlotArray, type MicSlot } from '../types'
import * as api from '../api'
import type { SongLine, SongMeta } from '../../contracts/types'
import { micRimColor } from '../../design/tokens'
import { laneHeightForPlayerCount } from '../../game/lane/laneStack'

vi.mock('../api')

const META: SongMeta = { artist: 'Test', title: 'Duet', mp3Path: 'song.mp3', bpm: 120, gap: 0, videoGap: 0 }

const A4_HZ = 440 // semitone 69, pitch class 9

const DUET_LINES: SongLine[] = [
  {
    part: 'p1',
    notes: [
      { kind: 'normal', startBeat: 0, length: 1, pitch: 9, syllable: 'p1a' },
      { kind: 'normal', startBeat: 1, length: 1, pitch: 9, syllable: 'p1b' },
    ],
  },
  { part: 'p2', notes: [{ kind: 'normal', startBeat: 2, length: 1, pitch: 9, syllable: 'p2a' }] },
  { part: 'solo', notes: [{ kind: 'normal', startBeat: 3, length: 1, pitch: 9, syllable: 'both' }] },
]

const SOLO_LINES: SongLine[] = [{ part: 'solo', notes: [{ kind: 'normal', startBeat: 0, length: 2, pitch: 9, syllable: 'la' }] }]

/**
 * Configure the rig, from both sides: the store for this render, and the
 * persistence stub, because the overlay reloads the configuration itself so a
 * song started without ever opening Settings still knows what its mics are.
 */
function setMicSlots(stored: MicSlot[]) {
  vi.mocked(api.listMicSlots).mockResolvedValue(stored)
  useMicSlotStore.setState({ slots: toMicSlotArray(stored), bindings: stored })
}

describe('MultiplayerGameplay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listMicSlots).mockResolvedValue([])
    usePitchStore.setState({ devices: [], permissionStatus: 'granted', activeCaptures: {} })
    usePlayersStore.setState({
      players: [
        { id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' },
        { id: 'p2', name: 'Sam', color: 'gold', avatarUrl: '' },
      ],
    })
    useMicSlotStore.setState({
      slots: toMicSlotArray([]),
      bindings: [],
      runningCaptureKeys: [],
      captureHolders: [],
    })
    useHitStore.getState().reset()
    useScoreStore.getState().reset({ players: [], combo: 0, rank: [] })
  })

  /**
   * The mic number a singer was shown when they were picked has to be the mic
   * they are actually scored on. Lanes used to be numbered from pick order but
   * fed from whatever order the bindings happened to be stored in, so the two
   * could disagree.
   */
  describe('a lane is a microphone', () => {
    beforeEach(() => {
      setMicSlots([
        { slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 },
        { slotNumber: 2, deviceId: 'dev-2', channelIndex: 0 },
      ])
    })

    it('gives Mic 1 to the first singer picked, even when they are second in the roster', () => {
      render(
        <MultiplayerGameplay meta={META} lines={DUET_LINES} beatPosition={motionValue(0)} assignedPlayerIds={['p2', 'p1']} />,
      )

      expect(screen.getByTestId('multiplayer-lane-p2').dataset.slotNumber).toBe('1')
      expect(screen.getByTestId('multiplayer-lane-p1').dataset.slotNumber).toBe('2')
    })

    it('colours each lane by its mic, so the lane matches the rim shown at assignment', () => {
      render(
        <MultiplayerGameplay meta={META} lines={DUET_LINES} beatPosition={motionValue(0)} assignedPlayerIds={['p2', 'p1']} />,
      )

      expect(screen.getByTestId('multiplayer-lane-p2').dataset.playerColor).toBe(micRimColor(0))
      expect(screen.getByTestId('multiplayer-lane-p1').dataset.playerColor).toBe(micRimColor(1))
    })

    it('gives the p1 duet line to the first singer picked', () => {
      render(
        <MultiplayerGameplay meta={META} lines={DUET_LINES} beatPosition={motionValue(0)} assignedPlayerIds={['p2', 'p1']} />,
      )

      // p1's part is 2 notes + the shared solo line's 1 = 3; p2's part is
      // 1 + 1 = 2. Sam was picked first, so Sam sings the p1 line.
      const lane = (id: string) => within(screen.getByTestId(`multiplayer-lane-${id}`)).getByTestId('note-lane')
      expect(lane('p2').dataset.noteCount).toBe('3')
      expect(lane('p1').dataset.noteCount).toBe('2')

      // The lanes page line by line: only the line that is up is mounted.
      // At beat 0 that is each singer's own first line.
      expect(within(screen.getByTestId('multiplayer-lane-p2')).getAllByTestId('note-block')).toHaveLength(2)
      expect(within(screen.getByTestId('multiplayer-lane-p1')).getAllByTestId('note-block')).toHaveLength(1)
    })

    it('gives a third singer in a duet a part (P1 again), not an empty lane', () => {
      usePlayersStore.setState({
        players: [
          { id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' },
          { id: 'p2', name: 'Sam', color: 'gold', avatarUrl: '' },
          { id: 'p3', name: 'Kim', color: 'mint', avatarUrl: '' },
        ],
      })
      setMicSlots([
        { slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 },
        { slotNumber: 2, deviceId: 'dev-2', channelIndex: 0 },
        { slotNumber: 3, deviceId: 'dev-3', channelIndex: 0 },
      ])
      render(
        <MultiplayerGameplay
          meta={META}
          lines={DUET_LINES}
          beatPosition={motionValue(0)}
          assignedPlayerIds={['p1', 'p2', 'p3']}
        />,
      )

      const lane = (id: string) => within(screen.getByTestId(`multiplayer-lane-${id}`)).getByTestId('note-lane')
      expect(lane('p3').dataset.noteCount).toBe('3')
      expect(lane('p3').dataset.paged).toBe('true')
    })
  })

  /**
   * Only configured mics can be claimed, so a rig with a gap in it hands out
   * the numbers it actually has -- and the lane reads from that mic's input,
   * not from the mic whose number happens to match the pick position.
   */
  it('skips an unconfigured mic when handing lanes out', () => {
    setMicSlots([
      { slotNumber: 2, deviceId: 'dev-2', channelIndex: 0 },
      { slotNumber: 5, deviceId: 'iface', channelIndex: 3 },
    ])

    render(
      <MultiplayerGameplay meta={META} lines={DUET_LINES} beatPosition={motionValue(0)} assignedPlayerIds={['p1', 'p2']} />,
    )

    expect(screen.getByTestId('multiplayer-lane-p1').dataset.slotNumber).toBe('2')
    expect(screen.getByTestId('multiplayer-lane-p2').dataset.slotNumber).toBe('5')
  })

  it('narrows the lanes to the singers actually picked for this song', () => {
    setMicSlots([
      { slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 },
      { slotNumber: 2, deviceId: 'dev-2', channelIndex: 0 },
    ])

    render(<MultiplayerGameplay meta={META} lines={DUET_LINES} beatPosition={motionValue(0)} assignedPlayerIds={['p2']} />)

    expect(screen.getAllByTestId('gameplay')).toHaveLength(1)
    expect(screen.getByTestId('multiplayer-lane-p2')).toBeInTheDocument()
    expect(screen.queryByTestId('multiplayer-lane-p1')).not.toBeInTheDocument()
    expect(useScoreStore.getState().players.map((p) => p.playerId)).toEqual(['p2'])
  })

  it('gives one lane per configured mic when no assign phase ran (e.g. /lab/multiplayer)', () => {
    setMicSlots([
      { slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 },
      { slotNumber: 2, deviceId: 'dev-2', channelIndex: 0 },
    ])

    render(<MultiplayerGameplay meta={META} lines={DUET_LINES} beatPosition={motionValue(0)} assignedPlayerIds={[]} />)

    expect(screen.getAllByTestId('gameplay')).toHaveLength(2)
    expect(screen.getAllByTestId('lane-panel')).toHaveLength(2)
  })

  /**
   * One score card per singer, down the right edge, stacked in the same order
   * the lanes are -- so a card is always near the lane it is counting.
   */
  it('stacks one score card per singer on the right, in the same order as the lanes', () => {
    setMicSlots([
      { slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 },
      { slotNumber: 2, deviceId: 'dev-2', channelIndex: 0 },
    ])

    render(<MultiplayerGameplay meta={META} lines={DUET_LINES} beatPosition={motionValue(0)} />)

    const cards = screen.getAllByTestId('gameplay-hud')
    expect(cards).toHaveLength(2)
    expect(cards.map((node) => node.dataset.slotNumber)).toEqual(['1', '2'])
    expect(within(cards[0]).getByTestId('hud-score')).toHaveTextContent('0')
  })

  /**
   * Every singer's lane stacks in the one shared lane cell, in pick order --
   * Mic 1 at the top of the stack. One lane each rather than one lane shared:
   * lanes used to be told apart by colour alone, which meant two pitch lines
   * fighting over the same pixels.
   */
  it('stacks the singers\' lanes in the one shared lane cell, in mic order', () => {
    setMicSlots([
      { slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 },
      { slotNumber: 2, deviceId: 'dev-2', channelIndex: 0 },
    ])

    render(
      <MultiplayerGameplay meta={META} lines={DUET_LINES} beatPosition={motionValue(0)} assignedPlayerIds={['p1', 'p2']} />,
    )

    const stack = screen.getByTestId('lane-stack')
    expect(stack.dataset.laneCount).toBe('2')
    expect(
      within(stack)
        .getAllByTestId(/^multiplayer-lane-/)
        .map((node) => node.dataset.slotNumber),
    ).toEqual(['1', '2'])
  })

  it('keeps a crowded party in one stack, ordered by mic number', () => {
    usePlayersStore.setState({
      players: Array.from({ length: 4 }, (_, index) => ({
        id: `p${index + 1}`,
        name: `Player ${index + 1}`,
        color: 'coral',
        avatarUrl: '',
      })),
    })
    setMicSlots(
      Array.from({ length: 4 }, (_, index) => ({ slotNumber: index + 1, deviceId: `dev-${index + 1}`, channelIndex: 0 })),
    )

    render(<MultiplayerGameplay meta={META} lines={SOLO_LINES} beatPosition={motionValue(0)} />)

    const mics = within(screen.getByTestId('lane-stack'))
      .getAllByTestId(/^multiplayer-lane-/)
      .map((node) => node.dataset.slotNumber)

    expect(mics).toEqual(['1', '2', '3', '4'])
  })

  // The empty-rig path: nothing has been set up in Settings yet, so there is
  // still exactly one singer on the first running capture.
  it('falls back to a single lane on the first active capture when no mic is configured', async () => {
    const beatPosition = motionValue(0)

    // A ~400 ms run of on-pitch samples at the detector's cadence: notes are
    // paid per beat sung (see matching/noteCoverage.ts), so "sang this note"
    // has to last as long as the note does. The same seed Gameplay.test uses.
    const singingFrom = Date.now()
    usePitchStore.setState({
      activeCaptures: {
        'dev-1': {
          latest: { t: singingFrom, hz: A4_HZ, confidence: 1, deviceId: 'dev-1' },
          samples: Array.from({ length: 40 }, (_, i) => ({
            t: singingFrom + i * 10,
            hz: A4_HZ,
            confidence: 1,
            deviceId: 'dev-1',
          })),
          latencyMs: 0,
        },
      },
    })

    render(<MultiplayerGameplay meta={META} lines={SOLO_LINES} beatPosition={beatPosition} />)

    expect(screen.getAllByTestId('gameplay')).toHaveLength(1)

    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(1)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(3)

    await waitFor(() => expect(useHitStore.getState().latest).not.toBeNull())
    expect(useHitStore.getState().latest?.tier).toBe('epic')
    expect(useScoreStore.getState().players.find((p) => p.playerId === 'p1')?.score).toBeGreaterThan(0)
  })

  // Review finding: with nothing configured, `claimableMicNumbers` offers all
  // eight mics, so an assigned party used to get one lane per pick -- every lane
  // handed the whole line-up, every lane scoring as singer 1 on the same
  // default capture. Three perfect singers came out p1 = 30,000, others 0.
  it('collapses an assigned party to ONE fallback lane when no mic is configured', async () => {
    usePlayersStore.setState({
      players: [
        { id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' },
        { id: 'p2', name: 'Sam', color: 'gold', avatarUrl: '' },
        { id: 'p3', name: 'Kim', color: 'mint', avatarUrl: '' },
      ],
    })
    const beatPosition = motionValue(0)
    const singingFrom = Date.now()
    usePitchStore.setState({
      activeCaptures: {
        'dev-1': {
          latest: { t: singingFrom, hz: A4_HZ, confidence: 1, deviceId: 'dev-1' },
          samples: Array.from({ length: 40 }, (_, i) => ({ t: singingFrom + i * 10, hz: A4_HZ, confidence: 1, deviceId: 'dev-1' })),
          latencyMs: 0,
        },
      },
    })

    render(
      <MultiplayerGameplay meta={META} lines={SOLO_LINES} beatPosition={beatPosition} assignedPlayerIds={['p2', 'p1', 'p3']} />,
    )

    expect(screen.getAllByTestId('gameplay')).toHaveLength(1)
    expect(screen.getByTestId('lane-stack').dataset.laneCount).toBe('1')
    // The first singer picked, on Mic 1 -- the lane the television draws too.
    expect(screen.getByTestId('multiplayer-lane-p2').dataset.slotNumber).toBe('1')

    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(1)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    beatPosition.set(3)

    await waitFor(() => expect(useHitStore.getState().latest).not.toBeNull())
    const players = useScoreStore.getState().players
    expect(players.map((p) => p.playerId)).toEqual(['p2'])
    expect(players[0].score).toBeGreaterThan(0)
    expect(players[0].score).toBeLessThanOrEqual(10_000)
  })

  // Review finding: with configured mics the lanes leave seeding to this layer,
  // and nothing cleared the hit store between songs -- so tallies, best lines
  // and the television's note clears carried over from the last song.
  it('starts every song with an empty hit history, with or without configured mics', () => {
    setMicSlots([{ slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 }])
    useHitStore.getState().recordHit({ playerId: 'p1', tier: 'epic', noteId: 'note-0', deviationCents: 0, t: 1 })

    const { unmount } = render(<MultiplayerGameplay meta={META} lines={SOLO_LINES} beatPosition={motionValue(0)} />)
    expect(useHitStore.getState().events).toEqual([])
    expect(useHitStore.getState().total).toBe(0)

    act(() => {
      useHitStore.getState().recordHit({ playerId: 'p1', tier: 'good', noteId: 'note-0', deviationCents: 0, t: 2 })
    })
    unmount()
    // Leaving the song leaves nothing behind for the next one to inherit.
    expect(useHitStore.getState().events).toEqual([])
  })

  it('gives every singer their own numbered, named lane', () => {
    setMicSlots([
      { slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 },
      { slotNumber: 2, deviceId: 'dev-2', channelIndex: 0 },
    ])

    render(<MultiplayerGameplay meta={META} lines={DUET_LINES} beatPosition={motionValue(0)} />)

    expect(screen.getAllByTestId('lane-slot-badge')).toHaveLength(2)
    // Document order is the stack's order, which is mic order: Alex is on
    // Mic 1 and sits at the top of the stack.
    expect(screen.getAllByTestId('lane-singer-name').map((n) => n.textContent)).toEqual(['Alex', 'Sam'])
  })

  it('shrinks the lanes as the party grows, instead of running off the bottom of the screen', () => {
    usePlayersStore.setState({
      players: Array.from({ length: 8 }, (_, index) => ({
        id: `p${index + 1}`,
        name: `Player ${index + 1}`,
        color: 'coral',
        avatarUrl: '',
      })),
    })
    setMicSlots(
      Array.from({ length: 8 }, (_, index) => ({
        slotNumber: index + 1,
        deviceId: `dev-${index + 1}`,
        channelIndex: 0,
      })),
    )

    render(<MultiplayerGameplay meta={META} lines={SOLO_LINES} beatPosition={motionValue(0)} />)

    const tracks = screen.getAllByTestId('lane-track')
    expect(tracks).toHaveLength(8)
    for (const track of tracks) {
      expect(track.style.height).toBe(`${laneHeightForPlayerCount(8)}px`)
    }
    expect(screen.getAllByTestId('lane-panel')).toHaveLength(8)
  })

  it('keeps a single singer on the full-height lane the solo layout always had', () => {
    render(<MultiplayerGameplay meta={META} lines={SOLO_LINES} beatPosition={motionValue(0)} />)

    expect(screen.getByTestId('lane-track').style.height).toBe(`${laneHeightForPlayerCount(1)}px`)
  })

  /**
   * The bug this closes: a song played on a rig that was never edited this
   * session captured nothing, so every note was judged against silence and
   * every score came out zero. The overlay is mounted for exactly the duration
   * of a song, so it is what says "these mics must be live now".
   */
  describe('the song claims its microphones', () => {
    it('holds a capture claim for as long as the overlay is mounted', async () => {
      setMicSlots([{ slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 }])

      const { unmount } = render(<MultiplayerGameplay meta={META} lines={SOLO_LINES} beatPosition={motionValue(0)} />)

      await waitFor(() => expect(useMicSlotStore.getState().captureHolders).toContain('gameplay'))
      unmount()
      await waitFor(() => expect(useMicSlotStore.getState().captureHolders).not.toContain('gameplay'))
    })

    // Nothing else on the way into a song is guaranteed to have read the mic
    // configuration -- a direct `sing` route never runs the assign phase.
    it('loads the mic configuration itself rather than assuming a screen already did', async () => {
      render(<MultiplayerGameplay meta={META} lines={SOLO_LINES} beatPosition={motionValue(0)} />)

      await waitFor(() => expect(api.listMicSlots).toHaveBeenCalled())
    })

    it('starts a capture for each configured mic once the configuration arrives', async () => {
      setMicSlots([
        { slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 },
        { slotNumber: 2, deviceId: 'iface', channelIndex: 1 },
      ])

      render(<MultiplayerGameplay meta={META} lines={SOLO_LINES} beatPosition={motionValue(0)} />)

      await waitFor(() =>
        expect(useMicSlotStore.getState().runningCaptureKeys).toEqual(expect.arrayContaining(['dev-1', 'iface#1'])),
      )
    })
  })

  it('gives each lane its own hit feedback layer, scoped to that singer', () => {
    setMicSlots([
      { slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 },
      { slotNumber: 2, deviceId: 'dev-2', channelIndex: 0 },
    ])

    render(<MultiplayerGameplay meta={META} lines={DUET_LINES} beatPosition={motionValue(0)} />)
    expect(screen.getAllByTestId('lane-hit-fx')).toHaveLength(2)

    act(() => {
      useHitStore.getState().recordHit({ playerId: 'p1', tier: 'epic', noteId: 'x', deviationCents: 0, t: 1 })
    })

    const lane1 = screen.getByTestId('multiplayer-lane-p1')
    const lane2 = screen.getByTestId('multiplayer-lane-p2')
    expect(within(lane1).getAllByTestId('hit-fx-slot').some((s) => s.dataset.firing === 'true')).toBe(true)
    expect(within(lane2).getAllByTestId('hit-fx-slot').some((s) => s.dataset.firing === 'true')).toBe(false)
  })
})
