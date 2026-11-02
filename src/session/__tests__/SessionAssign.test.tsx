import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { SessionAssign } from '../SessionAssign'
import { FOCUS_RING_EXTENT, MAX_SELECTED_SCALE } from '../assignLayout'
import { usePlayersStore } from '../../players/store'
import { useSessionStore } from '../sessionStore'
import { useSceneStore } from '../../scenes/sceneStore'
import { BackAuthorityProvider } from '../../scenes/SceneHeader'
import * as playersApi from '../../players/api'
import * as micApi from '../../multiplayer/api'
import { useMicSlotStore } from '../../multiplayer/store'
import { toMicSlotArray, type MicSlot } from '../../multiplayer/types'
import { setAudienceAssignSelection } from '../../audience/audienceBroadcast'
import { useCalibrationStore } from '../../calibration/calibrationStore'
import { adjustFocused } from '../../input/spatialNavigation'

// Only this one export is stubbed: the module also installs the host-side
// broadcaster at import time, and replacing it wholesale left those exports
// undefined for anything else in the tree that imports them.
vi.mock('../../audience/audienceBroadcast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../audience/audienceBroadcast')>()),
  setAudienceAssignSelection: vi.fn(),
}))

vi.mock('../../players/api')
vi.mock('../../multiplayer/api')

const VIEWPORT = { width: window.innerWidth, height: window.innerHeight }

/** Configure the rig the way Settings would have, and let SessionAssign load it. */
function seedMicSlots(stored: MicSlot[]) {
  vi.mocked(micApi.listMicSlots).mockResolvedValue(stored)
  useMicSlotStore.setState({ slots: toMicSlotArray(stored), bindings: stored })
}

beforeEach(() => {
  vi.mocked(micApi.listMicSlots).mockResolvedValue([])
  useMicSlotStore.setState({
    slots: toMicSlotArray([]),
    bindings: [],
    runningCaptureKeys: [],
    captureHolders: [],
  })
})

afterEach(() => {
  window.innerWidth = VIEWPORT.width
  window.innerHeight = VIEWPORT.height
})

describe('SessionAssign', () => {
  beforeEach(() => {
    vi.mocked(playersApi.list).mockResolvedValue([])
    useSceneStore.setState({ current: 'session-assign', history: [] })
    usePlayersStore.setState({
      players: [
        { id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' },
        { id: 'p2', name: 'Sam', color: 'gold', avatarUrl: '' },
      ],
    })
    useSessionStore.setState({ phase: 'assign', selectedSong: null, assignedPlayerIds: [], lastResult: null, songsPlayedThisSession: 0 })
  })

  /**
   * Reported from a real party: "the player selection needs a button that makes
   * it possible to add profiles right there as well." The roster is a scene
   * away, and going there to add the person who just walked in discarded every
   * pick already made.
   */
  describe('adding a player without leaving the screen', () => {
    it('offers an Add player button alongside the roster, not only when it is empty', () => {
      render(<SessionAssign />)
      expect(screen.getByTestId('session-assign-add-player')).toBeInTheDocument()
    })

    it('opens the roster\'s own player form in place', () => {
      render(<SessionAssign />)
      fireEvent.click(screen.getByTestId('session-assign-add-player'))
      expect(screen.getByTestId('session-assign-create')).toBeInTheDocument()
    })

    it('keeps the picks already made while the form is open', () => {
      render(<SessionAssign />)
      fireEvent.click(screen.getAllByTestId('selectable-player-badge')[0])
      fireEvent.click(screen.getByTestId('session-assign-add-player'))

      // Still selected -- the whole point of not navigating away.
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
      fireEvent.click(screen.getByRole('button', { name: /start singing/i }))
      expect(useSessionStore.getState().assignedPlayerIds).toEqual(['p1'])
    })

    it('saves a new player to the real roster store and closes the form', async () => {
      vi.mocked(playersApi.create).mockResolvedValue({ id: 'p3', name: 'Robin', color: 'coral', avatarUrl: '' })
      render(<SessionAssign />)
      fireEvent.click(screen.getByTestId('session-assign-add-player'))

      fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Robin' } })
      fireEvent.click(screen.getByRole('button', { name: /save|add|create/i }))

      await waitFor(() => expect(playersApi.create).toHaveBeenCalled())
      await waitFor(() => expect(screen.queryByTestId('session-assign-create')).not.toBeInTheDocument())
    })
  })

  it('renders one SelectablePlayerBadge per roster player', () => {
    render(<SessionAssign />)
    expect(screen.getAllByTestId('selectable-player-badge')).toHaveLength(2)
  })

  it('the confirm button is disabled until a player is selected', () => {
    render(<SessionAssign />)
    expect(screen.getByRole('button', { name: /start singing/i })).toBeDisabled()
  })

  it('selecting a player then confirming calls sessionStore.assignPlayers with that id', () => {
    render(<SessionAssign />)
    fireEvent.click(screen.getAllByTestId('selectable-player-badge')[1])
    fireEvent.click(screen.getByRole('button', { name: /start singing/i }))
    expect(useSessionStore.getState().assignedPlayerIds).toEqual(['p2'])
    expect(useSessionStore.getState().phase).toBe('starting')
  })

  it('selecting multiple players then confirming assigns all of them', () => {
    render(<SessionAssign />)
    const badges = screen.getAllByTestId('selectable-player-badge')
    fireEvent.click(badges[0])
    fireEvent.click(badges[1])
    fireEvent.click(screen.getByRole('button', { name: /start singing/i }))
    expect(useSessionStore.getState().assignedPlayerIds).toEqual(['p1', 'p2'])
    expect(useSessionStore.getState().phase).toBe('starting')
  })

  it('clicking a selected badge again deselects it', () => {
    render(<SessionAssign />)
    const badges = screen.getAllByTestId('selectable-player-badge')
    fireEvent.click(badges[0])
    fireEvent.click(badges[1])
    expect(badges[0]).toHaveAttribute('data-selected', 'true')
    fireEvent.click(badges[0])
    expect(badges[0]).toHaveAttribute('data-selected', 'false')

    fireEvent.click(screen.getByRole('button', { name: /start singing/i }))
    expect(useSessionStore.getState().assignedPlayerIds).toEqual(['p2'])
  })

  it('the confirm button re-disables once every player is deselected', () => {
    render(<SessionAssign />)
    const badges = screen.getAllByTestId('selectable-player-badge')
    fireEvent.click(badges[0])
    expect(screen.getByRole('button', { name: /start singing/i })).not.toBeDisabled()
    fireEvent.click(badges[0])
    expect(screen.getByRole('button', { name: /start singing/i })).toBeDisabled()
  })
})

/**
 * A singer gets a mic in the order they were picked, not by roster position:
 * pick Sam first and Sam is Mic 1 tonight even though Alex is roster index 0.
 */
describe('SessionAssign mic assignment', () => {
  beforeEach(() => {
    vi.mocked(playersApi.list).mockResolvedValue([])
    useSceneStore.setState({ current: 'session-assign', history: [] })
    usePlayersStore.setState({
      players: [
        { id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' },
        { id: 'p2', name: 'Sam', color: 'gold', avatarUrl: '' },
        { id: 'p3', name: 'Jo', color: 'cyan', avatarUrl: '' },
      ],
    })
    useSessionStore.setState({
      phase: 'assign',
      selectedSong: null,
      assignedPlayerIds: [],
      lastResult: null,
      songsPlayedThisSession: 0,
    })
  })

  it('gives the first player picked Mic 1 regardless of their roster position', () => {
    render(<SessionAssign />)
    const badges = screen.getAllByTestId('selectable-player-badge')

    fireEvent.click(badges[1]) // Sam, roster index 1

    expect(badges[1]).toHaveAttribute('data-mic-number', '1')
    expect(within(badges[1]).getByTestId('mic-number-badge')).toHaveTextContent('1')
  })

  it('numbers further picks in the order they were made', () => {
    render(<SessionAssign />)
    const badges = screen.getAllByTestId('selectable-player-badge')

    fireEvent.click(badges[2]) // Jo
    fireEvent.click(badges[0]) // Alex

    expect(badges[2]).toHaveAttribute('data-mic-number', '1')
    expect(badges[0]).toHaveAttribute('data-mic-number', '2')
  })

  // Mics are contiguous physical inputs: dropping Mic 1 must not leave input 1
  // dark while someone sings into input 2.
  it('renumbers the remaining singers when one drops out', () => {
    render(<SessionAssign />)
    const badges = screen.getAllByTestId('selectable-player-badge')

    fireEvent.click(badges[0])
    fireEvent.click(badges[1])
    fireEvent.click(badges[2])
    fireEvent.click(badges[0]) // Alex leaves; Sam and Jo shuffle down a mic

    expect(badges[1]).toHaveAttribute('data-mic-number', '1')
    expect(badges[2]).toHaveAttribute('data-mic-number', '2')
  })

  it('assigns the players in mic order, so mic 1 is the first id handed to the session', () => {
    render(<SessionAssign />)
    const badges = screen.getAllByTestId('selectable-player-badge')

    fireEvent.click(badges[2]) // Jo -> Mic 1
    fireEvent.click(badges[0]) // Alex -> Mic 2
    fireEvent.click(screen.getByRole('button', { name: /start singing/i }))

    expect(useSessionStore.getState().assignedPlayerIds).toEqual(['p3', 'p1'])
  })

  it('carries no mic number on a player nobody picked', () => {
    render(<SessionAssign />)

    expect(screen.getAllByTestId('selectable-player-badge')[0]).not.toHaveAttribute('data-mic-number')
  })

  it('stops at eight singers because there are only eight inputs', () => {
    usePlayersStore.setState({
      players: Array.from({ length: 9 }, (_, i) => ({
        id: `p${i + 1}`,
        name: `Player ${i + 1}`,
        color: 'coral',
        avatarUrl: '',
      })),
    })
    render(<SessionAssign />)
    const badges = screen.getAllByTestId('selectable-player-badge')

    badges.forEach((badge) => fireEvent.click(badge))

    expect(badges.filter((badge) => badge.getAttribute('data-selected') === 'true')).toHaveLength(8)
    expect(badges[8]).toHaveAttribute('aria-disabled', 'true')
  })
})

/**
 * Picking a singer *claims* one of the microphones set up in Settings. The mic
 * numbers offered are the rig's, not 1..n -- so a party running on Mic 2 and
 * Mic 5 hands out 2 and 5, and the number the singer is shown is the input
 * their voice actually arrives on.
 */
describe('SessionAssign claims configured mics', () => {
  const ROSTER = [
    { id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' },
    { id: 'p2', name: 'Sam', color: 'gold', avatarUrl: '' },
    { id: 'p3', name: 'Jo', color: 'cyan', avatarUrl: '' },
  ]

  beforeEach(() => {
    // Resolved with the real roster, not []: this screen reloads players on
    // mount, so a stub that empties the roster swaps the grid for the
    // empty-state panel the moment any assertion awaits.
    vi.mocked(playersApi.list).mockResolvedValue(ROSTER)
    useSceneStore.setState({ current: 'session-assign', history: [] })
    usePlayersStore.setState({ players: ROSTER })
    useSessionStore.setState({
      phase: 'assign',
      selectedSong: null,
      assignedPlayerIds: [],
      lastResult: null,
      songsPlayedThisSession: 0,
    })
  })

  /** Re-queried every time: a click re-renders the grid, and a stale node lies. */
  const badges = () => screen.getAllByTestId('selectable-player-badge')

  it('hands out the configured mic numbers, skipping the ones with no input', async () => {
    seedMicSlots([
      { slotNumber: 2, deviceId: 'dev-2', channelIndex: 0 },
      { slotNumber: 5, deviceId: 'iface', channelIndex: 3 },
    ])
    render(<SessionAssign />)
    await waitFor(() => expect(badges()).toHaveLength(3))

    fireEvent.click(badges()[1])
    fireEvent.click(badges()[0])

    expect(badges()[1]).toHaveAttribute('data-mic-number', '2')
    expect(badges()[0]).toHaveAttribute('data-mic-number', '5')
  })

  it('stops picking once every configured mic is claimed, not at eight', async () => {
    seedMicSlots([{ slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 }])
    render(<SessionAssign />)
    await waitFor(() => expect(badges()).toHaveLength(3))

    fireEvent.click(badges()[0])

    expect(badges()[1]).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText(/all 1 mic is taken/i)).toBeInTheDocument()
  })

  it('names the mics on offer as a range when the rig is contiguous', async () => {
    seedMicSlots([
      { slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 },
      { slotNumber: 2, deviceId: 'dev-2', channelIndex: 0 },
      { slotNumber: 3, deviceId: 'dev-3', channelIndex: 0 },
    ])
    render(<SessionAssign />)

    expect(await screen.findByText(/mics 1 to 3, in the order you pick them/i)).toBeInTheDocument()
  })

  // "Mics 1 to 4" would promise a microphone that is not there.
  it('lists the mics on offer when the rig has a gap in it', async () => {
    seedMicSlots([
      { slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 },
      { slotNumber: 4, deviceId: 'dev-4', channelIndex: 0 },
    ])
    render(<SessionAssign />)

    expect(await screen.findByText(/mics 1, 4, in the order you pick them/i)).toBeInTheDocument()
  })

  // A fresh install has nothing set up. Refusing to let anyone sing until they
  // visit Settings would be worse than the app's existing single-mic fallback.
  it('still offers all eight mics when nothing has been set up yet', async () => {
    render(<SessionAssign />)
    await waitFor(() => expect(badges()).toHaveLength(3))

    fireEvent.click(badges()[0])

    expect(badges()[0]).toHaveAttribute('data-mic-number', '1')
    expect(badges()[1]).not.toHaveAttribute('aria-disabled')
  })
})

/**
 * The layout regression. `flex gap-4 flex-wrap justify-center` reserved only the
 * badge's *unscaled* 190px footprint, while selection and hover grow it by a
 * transform that paints outside that box -- so a selected badge reached ~10px
 * into a 16px gutter from both sides at once, and a ragged wrapped row put the
 * short row's badges under the gaps of the row above.
 */
describe('SessionAssign layout', () => {
  beforeEach(() => {
    vi.mocked(playersApi.list).mockResolvedValue([])
    useSceneStore.setState({ current: 'session-assign', history: [] })
    useSessionStore.setState({
      phase: 'assign',
      selectedSong: null,
      assignedPlayerIds: [],
      lastResult: null,
      songsPlayedThisSession: 0,
    })
  })

  function seedRoster(count: number) {
    usePlayersStore.setState({
      players: Array.from({ length: count }, (_, i) => ({
        id: `p${i + 1}`,
        name: `Player ${i + 1}`,
        color: 'coral',
        avatarUrl: '',
      })),
    })
  }

  it('lays the badges out on an explicit grid, not a wrapping flex row', () => {
    seedRoster(8)
    render(<SessionAssign />)

    const grid = screen.getByTestId('session-assign-grid')
    expect(grid).toHaveStyle({ display: 'grid' })
    expect(grid.className).not.toMatch(/flex-wrap/)
  })

  it('balances eight players over four columns rather than wrapping them raggedly', () => {
    seedRoster(8)
    render(<SessionAssign />)

    const grid = screen.getByTestId('session-assign-grid')
    expect(grid.style.gridTemplateColumns).toMatch(/^repeat\(4, \d+px\)$/)
  })

  it('gives a small party one column per player', () => {
    seedRoster(3)
    render(<SessionAssign />)

    expect(screen.getByTestId('session-assign-grid').style.gridTemplateColumns).toMatch(/^repeat\(3, \d+px\)$/)
  })

  it('leaves a gutter wider than the growth a selected badge can reach into it', () => {
    seedRoster(8)
    render(<SessionAssign />)

    const grid = screen.getByTestId('session-assign-grid')
    const badgeSize = Number.parseFloat(screen.getAllByTestId('selectable-player-badge')[0].style.width)
    const gap = Number.parseFloat(grid.style.gap)

    expect(gap / 2).toBeGreaterThanOrEqual((badgeSize * (MAX_SELECTED_SCALE - 1)) / 2 + FOCUS_RING_EXTENT)
  })

  it('sizes the badges from the viewport rather than a hardcoded 190px', () => {
    seedRoster(4)
    const { unmount } = render(<SessionAssign />)
    const small = screen.getAllByTestId('selectable-player-badge')[0].style.width
    unmount()

    window.innerWidth = 3840
    window.innerHeight = 2160
    render(<SessionAssign />)

    expect(screen.getAllByTestId('selectable-player-badge')[0].style.width).not.toBe(small)
  })
})

// Regression: the screen read usePlayersStore.players but never called
// load(), so arriving here directly (the normal path from song select)
// showed an empty roster with a disabled button and no explanation.
describe('SessionAssign roster loading and empty state', () => {
  beforeEach(() => {
    vi.mocked(playersApi.list).mockResolvedValue([])
    usePlayersStore.setState({ players: [] })
    useSessionStore.setState({
      phase: 'assign',
      selectedSong: null,
      assignedPlayerIds: [],
      lastResult: null,
      songsPlayedThisSession: 0,
    })
    useSceneStore.setState({ current: 'session-assign', history: [] })
  })

  it('loads the roster on mount instead of relying on another screen having populated it', async () => {
    render(<SessionAssign />)

    await waitFor(() => expect(playersApi.list).toHaveBeenCalled())
  })

  it('reactively shows the players the mount-time load brings back', async () => {
    vi.mocked(playersApi.list).mockResolvedValue([{ id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' }])

    render(<SessionAssign />)
    expect(screen.queryAllByTestId('selectable-player-badge')).toHaveLength(0)

    await waitFor(() => expect(screen.getAllByTestId('selectable-player-badge')).toHaveLength(1))
  })

  it('explains why the screen is empty rather than showing a bare disabled button', () => {
    render(<SessionAssign />)

    expect(screen.getByTestId('session-assign-empty')).toBeInTheDocument()
    expect(screen.getByText(/no players yet/i)).toBeInTheDocument()
  })

  it('offers a way out of the empty state to the roster', () => {
    render(<SessionAssign />)

    fireEvent.click(screen.getByRole('button', { name: /add a player/i }))

    expect(useSceneStore.getState().current).toBe('players')
  })

  it('renders no empty state once the roster has someone in it', async () => {
    vi.mocked(playersApi.list).mockResolvedValue([{ id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' }])

    render(<SessionAssign />)

    await waitFor(() => expect(screen.getByRole('button', { name: /start singing/i })).toBeInTheDocument())
    expect(screen.queryByTestId('session-assign-empty')).not.toBeInTheDocument()
  })

  // This scene is self-headed (sceneChrome.ts): Back in its heading row is the only way out.
  describe('the way back out', () => {
    it('draws the shell Back control as the leading item of its heading row', async () => {
      const onBack = vi.fn()
      vi.mocked(playersApi.list).mockResolvedValue([])

      render(
        <BackAuthorityProvider onBack={onBack}>
          <SessionAssign />
        </BackAuthorityProvider>,
      )

      const back = await screen.findByRole('button', { name: 'Back' })
      const header = back.closest('header')

      // One row: Back, then the question it lets you back out of.
      expect(header).not.toBeNull()
      expect(header).toHaveTextContent("Who's singing?")
      expect(header?.className).toContain('items-center')
      // Leading, not centred -- the treatment that made the pill look pasted on.
      expect(header?.className).not.toContain('items-center gap-1')
      expect(header?.className).not.toContain('text-center')

      fireEvent.click(back)

      expect(onBack).toHaveBeenCalledTimes(1)
    })

    // The empty roster is the branch a first-run user meets, and the one where
    // "no players yet" and "how do I leave" are the only things on the page.
    it('keeps Back on the empty-roster branch', async () => {
      vi.mocked(playersApi.list).mockResolvedValue([])

      render(<SessionAssign />)

      await waitFor(() => expect(screen.getByTestId('session-assign-empty')).toBeInTheDocument())
      expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    })
  })
})

/**
 * The audience display shows the line-up while it forms, before "Start
 * singing" commits anything; `null` on unmount hands back to its DOM mirror.
 */
describe('SessionAssign publishes its in-progress line-up', () => {
  beforeEach(() => {
    vi.mocked(playersApi.list).mockResolvedValue([])
    useSceneStore.setState({ current: 'session-assign', history: [] })
    usePlayersStore.setState({
      players: [
        { id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' },
        { id: 'p2', name: 'Sam', color: 'gold', avatarUrl: '' },
      ],
    })
    useSessionStore.setState({
      phase: 'assign',
      selectedSong: null,
      assignedPlayerIds: [],
      lastResult: null,
      songsPlayedThisSession: 0,
    })
  })

  it('publishes each pick as it happens, and clears on unmount', async () => {
    const publish = vi.mocked(setAudienceAssignSelection)
    publish.mockClear()
    const { unmount } = render(<SessionAssign />)

    fireEvent.click(screen.getAllByTestId('selectable-player-badge')[0])

    expect(publish).toHaveBeenCalledWith(['p1'])

    unmount()
    expect(publish).toHaveBeenLastCalledWith(null)
  })
})

describe('SessionAssign per-singer difficulty', () => {
  beforeEach(() => {
    const roster = [
      { id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' },
      { id: 'p2', name: 'Sam', color: 'gold', avatarUrl: '' },
    ]
    // The screen reloads the roster on mount; it must come back the same, or
    // the cells under test vanish while a write is awaited.
    vi.mocked(playersApi.list).mockResolvedValue(roster)
    window.api = undefined
    useSceneStore.setState({ current: 'session-assign', history: [] })
    usePlayersStore.setState({ players: roster })
    useCalibrationStore.setState({
      settings: {
        outputOffsetMs: 0,
        inputDevices: {},
        players: { p2: { difficulty: 'hard', transpositionSemitones: 1 } },
      },
      loaded: true,
    })
    useSessionStore.setState({ phase: 'assign', selectedSong: null, assignedPlayerIds: [], lastResult: null, songsPlayedThisSession: 0 })
  })

  it('offers no difficulty until somebody is picked', () => {
    render(<SessionAssign />)
    expect(screen.queryByTestId('singer-difficulty-p1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('singer-difficulty-p2')).not.toBeInTheDocument()
  })

  it('defaults each picked singer to their last choice, Normal for a first-timer', () => {
    render(<SessionAssign />)
    const badges = screen.getAllByTestId('selectable-player-badge')
    fireEvent.click(badges[0])
    fireEvent.click(badges[1])

    expect(screen.getByTestId('singer-difficulty-p1')).toHaveAttribute('data-difficulty', 'normal')
    expect(screen.getByTestId('singer-difficulty-p2')).toHaveAttribute('data-difficulty', 'hard')
    expect(screen.getByRole('button', { name: 'Difficulty for Alex: Normal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Difficulty for Sam: Hard' })).toBeInTheDocument()
  })

  it('a press cycles the level and writes it to the per-player calibration, keeping the transposition', async () => {
    render(<SessionAssign />)
    fireEvent.click(screen.getAllByTestId('selectable-player-badge')[1])

    // Hard wraps round to Easy: A on the pad, Enter, or a click.
    fireEvent.click(screen.getByTestId('singer-difficulty-p2'))

    await waitFor(() =>
      expect(useCalibrationStore.getState().settings.players.p2).toEqual({ difficulty: 'easy', transpositionSemitones: 1 }),
    )
    expect(screen.getByTestId('singer-difficulty-p2')).toHaveAttribute('data-difficulty', 'easy')
  })

  it('Left and Right step the level while the chip is focused, and claim the key so focus stays put', async () => {
    render(<SessionAssign />)
    fireEvent.click(screen.getAllByTestId('selectable-player-badge')[0])
    const chip = screen.getByTestId('singer-difficulty-p1')
    chip.focus()

    // fireEvent returns false when the handler called preventDefault, which is
    // what tells the window-level couch navigation to leave focus alone.
    expect(fireEvent.keyDown(chip, { key: 'ArrowRight' })).toBe(false)
    await waitFor(() => expect(chip).toHaveAttribute('data-difficulty', 'hard'))
    // Already at the hardest: still claimed, nothing changes.
    expect(fireEvent.keyDown(chip, { key: 'ArrowRight' })).toBe(false)
    expect(chip).toHaveAttribute('data-difficulty', 'hard')

    fireEvent.keyDown(chip, { key: 'ArrowLeft' })
    await waitFor(() => expect(chip).toHaveAttribute('data-difficulty', 'normal'))
    fireEvent.keyDown(chip, { key: 'ArrowLeft' })
    await waitFor(() => expect(chip).toHaveAttribute('data-difficulty', 'easy'))
    expect(document.activeElement).toBe(chip)

    // Up/Down are not the chip's: they still navigate.
    expect(fireEvent.keyDown(chip, { key: 'ArrowDown' })).toBe(true)
  })

  it("takes the D-pad's Left/Right the same way, through the shared data-dpad-horizontal hook", async () => {
    render(<SessionAssign />)
    fireEvent.click(screen.getAllByTestId('selectable-player-badge')[0])
    const chip = screen.getByTestId('singer-difficulty-p1')
    expect(chip).toHaveAttribute('data-dpad-horizontal', 'adjust')
    chip.focus()

    // What useGamepadNavigation does on a D-pad press before it would move focus.
    expect(adjustFocused('right')).toBe(true)
    await waitFor(() => expect(chip).toHaveAttribute('data-difficulty', 'hard'))
    expect(adjustFocused('left')).toBe(true)
    await waitFor(() => expect(chip).toHaveAttribute('data-difficulty', 'normal'))
    expect(document.activeElement).toBe(chip)
    // Down is still navigation.
    expect(adjustFocused('down')).toBe(false)
  })

  it('the arrows on the chip step the level for a mouse', async () => {
    render(<SessionAssign />)
    fireEvent.click(screen.getAllByTestId('selectable-player-badge')[0])
    const chip = screen.getByTestId('singer-difficulty-p1')

    fireEvent.click(within(chip).getByTestId('singer-difficulty-easier'))
    await waitFor(() => expect(chip).toHaveAttribute('data-difficulty', 'easy'))
    fireEvent.click(within(chip).getByTestId('singer-difficulty-harder'))
    await waitFor(() => expect(chip).toHaveAttribute('data-difficulty', 'normal'))
  })

  it("sits in the singer's own grid cell: focus order is singer, difficulty, next singer, then Start", () => {
    render(<SessionAssign />)
    const badges = screen.getAllByTestId('selectable-player-badge')
    fireEvent.click(badges[0])
    fireEvent.click(badges[1])

    const cells = screen.getAllByTestId('session-assign-cell')
    expect(within(cells[0]).getByTestId('singer-difficulty-p1')).toBeInTheDocument()
    expect(within(cells[1]).getByTestId('singer-difficulty-p2')).toBeInTheDocument()

    const order = Array.from(document.querySelectorAll<HTMLElement>('button:not([disabled])')).map(
      (button) => button.dataset.testid ?? button.getAttribute('aria-label') ?? button.textContent,
    )
    const at = (id: string) => order.indexOf(id)
    expect(at('singer-difficulty-p1')).toBe(order.indexOf('selectable-player-badge') + 1)
    expect(at('singer-difficulty-p2')).toBe(order.lastIndexOf('selectable-player-badge') + 1)
    expect(at('session-assign-start')).toBe(order.length - 1)
  })

  it("keeps a picked singer's cell the same height as an unpicked one, so picking never reflows the grid", () => {
    render(<SessionAssign />)
    fireEvent.click(screen.getAllByTestId('selectable-player-badge')[0])
    const [picked, unpicked] = screen.getAllByTestId('session-assign-cell')
    const chip = within(picked).getByTestId('singer-difficulty-p1')
    const placeholder = unpicked.lastElementChild as HTMLElement
    const chipBand = parseFloat(chip.style.height) + parseFloat(chip.style.marginTop)
    expect(parseFloat(placeholder.style.height)).toBe(chipBand)
  })
})

describe('SessionAssign keeps Start reachable', () => {
  beforeEach(() => {
    vi.mocked(playersApi.list).mockResolvedValue([])
    window.api = undefined
    useSceneStore.setState({ current: 'session-assign', history: [] })
    usePlayersStore.setState({
      players: Array.from({ length: 8 }, (_, index) => ({
        id: `p${index + 1}`,
        name: `Singer ${index + 1}`,
        color: 'coral',
        avatarUrl: '',
      })),
    })
    useSessionStore.setState({ phase: 'assign', selectedSong: null, assignedPlayerIds: [], lastResult: null, songsPlayedThisSession: 0 })
  })

  it('puts Start in a footer outside the scrolling roster, on a screen exactly one window tall', () => {
    window.innerWidth = 1024
    window.innerHeight = 640
    render(<SessionAssign />)
    for (const badge of screen.getAllByTestId('selectable-player-badge')) fireEvent.click(badge)

    const screenRoot = screen.getByTestId('session-assign')
    const body = screen.getByTestId('session-assign-body')
    const footer = screen.getByTestId('session-assign-footer')
    const start = screen.getByTestId('session-assign-start')

    expect(screenRoot.style.height).toBe('100vh')
    expect(screenRoot).toHaveClass('overflow-hidden')
    // The roster band is the only thing that scrolls; Start is never inside it.
    expect(body).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto')
    expect(body).not.toContainElement(start)
    expect(footer).toContainElement(start)
    expect(footer).toHaveClass('shrink-0')
    // And no difficulty control lives in the footer to cover it.
    expect(within(footer).queryByTestId(/singer-difficulty/)).not.toBeInTheDocument()
    expect(start).toBeEnabled()
  })
})

/**
 * Versus is a duel: exactly two singers. A third pick is blocked (with the
 * reason said), Start waits for the second, and a line-up formed before the
 * switch to Versus keeps its first two picks.
 */
describe('SessionAssign in Versus', () => {
  const ROSTER = [
    { id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' },
    { id: 'p2', name: 'Sam', color: 'gold', avatarUrl: '' },
    { id: 'p3', name: 'Jo', color: 'cyan', avatarUrl: '' },
    { id: 'p4', name: 'Kim', color: 'lime', avatarUrl: '' },
  ]

  beforeEach(() => {
    vi.mocked(playersApi.list).mockResolvedValue(ROSTER)
    useSceneStore.setState({ current: 'session-assign', history: [] })
    usePlayersStore.setState({ players: ROSTER })
    useSessionStore.setState({
      mode: 'battle',
      phase: 'assign',
      selectedSong: null,
      assignedPlayerIds: [],
      lastResult: null,
      songsPlayedThisSession: 0,
    })
  })

  afterEach(() => {
    useSessionStore.setState({ mode: 'classic' })
  })

  const badges = () => screen.getAllByTestId('selectable-player-badge')
  const picked = () => badges().filter((badge) => badge.getAttribute('data-selected') === 'true')
  const start = () => screen.getByTestId('session-assign-start')

  it('blocks a third pick and says why', () => {
    render(<SessionAssign />)

    fireEvent.click(badges()[0])
    fireEvent.click(badges()[1])
    fireEvent.click(badges()[2])

    expect(picked()).toHaveLength(2)
    expect(badges()[2]).not.toHaveAttribute('data-mic-number')
    expect(badges()[2]).toHaveAttribute('aria-disabled', 'true')
    expect(badges()[3]).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('session-assign-versus-full')).toHaveTextContent(/versus is 1 against 1/i)
    // Not the "all mics are taken" hint: six mics are still free.
    expect(screen.queryByTestId('session-assign-full')).not.toBeInTheDocument()
  })

  it('needs exactly two singers to start, with a hint while only one is picked', () => {
    render(<SessionAssign />)

    fireEvent.click(badges()[0])
    expect(start()).toBeDisabled()
    expect(screen.getByTestId('session-assign-versus-pick')).toHaveTextContent(/pick two singers/i)

    fireEvent.click(start())
    expect(useSessionStore.getState().phase).toBe('assign')

    fireEvent.click(badges()[1])
    expect(start()).toBeEnabled()
    fireEvent.click(start())
    expect(useSessionStore.getState().assignedPlayerIds).toEqual(['p1', 'p2'])
    expect(useSessionStore.getState().phase).toBe('starting')
  })

  it('lets a singer be swapped out once the duel is full', () => {
    render(<SessionAssign />)

    fireEvent.click(badges()[0])
    fireEvent.click(badges()[1])
    fireEvent.click(badges()[0]) // Alex steps down
    fireEvent.click(badges()[3]) // Kim steps up

    expect(badges()[1]).toHaveAttribute('data-mic-number', '1')
    expect(badges()[3]).toHaveAttribute('data-mic-number', '2')
    expect(picked()).toHaveLength(2)
  })

  it('keeps the first two picks when the mode switches to Versus with more already picked', () => {
    useSessionStore.setState({ mode: 'classic' })
    render(<SessionAssign />)
    fireEvent.click(badges()[2]) // Jo -> Mic 1
    fireEvent.click(badges()[0]) // Alex -> Mic 2
    fireEvent.click(badges()[3]) // Kim -> Mic 3
    expect(picked()).toHaveLength(3)

    act(() => useSessionStore.getState().setMode('battle'))

    expect(picked()).toHaveLength(2)
    expect(badges()[2]).toHaveAttribute('data-mic-number', '1')
    expect(badges()[0]).toHaveAttribute('data-mic-number', '2')
    expect(badges()[3]).not.toHaveAttribute('data-mic-number')
    expect(vi.mocked(setAudienceAssignSelection)).toHaveBeenLastCalledWith(['p3', 'p1'])

    fireEvent.click(start())
    expect(useSessionStore.getState().assignedPlayerIds).toEqual(['p3', 'p1'])
  })

  it('says Versus needs a second mic when only one is set up', async () => {
    seedMicSlots([{ slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 }])
    render(<SessionAssign />)
    await waitFor(() => expect(badges()).toHaveLength(4))

    fireEvent.click(badges()[0])

    expect(start()).toBeDisabled()
    expect(screen.getByTestId('session-assign-versus-mics')).toHaveTextContent(/versus needs two mics/i)
  })

  it('leaves Solo/Duet at one singer per mic, up to eight', () => {
    useSessionStore.setState({ mode: 'classic' })
    render(<SessionAssign />)

    badges().forEach((badge) => fireEvent.click(badge))
    expect(picked()).toHaveLength(4)
    expect(screen.queryByTestId('session-assign-versus-full')).not.toBeInTheDocument()

    fireEvent.click(badges()[1])
    fireEvent.click(badges()[2])
    fireEvent.click(badges()[3])
    expect(start()).toBeEnabled() // a solo is fine outside Versus
  })
})
