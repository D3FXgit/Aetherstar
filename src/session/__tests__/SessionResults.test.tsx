import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionResults } from '../SessionResults'
import { CROWN_BOX_UNITS, CROWN_IMAGE_URL } from '../resultsAssets'
import { useSessionStore } from '../sessionStore'
import { usePlayersStore } from '../../players/store'
import { useSfx } from '../../audio/useSfx'
import { BEAT_ORDER, beatSchedule } from '../resultsChoreography'
import { computeRating } from '../rating'
import { setLanguage } from '../../i18n'
import type { SfxName } from '../../audio/sfxContract'
import type { LibrarySong } from '../../library/types'
import type { SongChart } from '../../contracts/types'

const SONG: LibrarySong = {
  path: '/library/nova',
  artist: 'Nova Lane',
  title: 'Paper Satellites',
  durationMs: 180000,
  thumbnailPath: null,
  mp3Path: '/library/nova/song.mp3',
  videoPath: null,
  bpm: 250,
  gap: 24065,
  hasVideo: true,
  hasCover: true,
  isDuet: false,
  isPlayable: true,
  addedAt: 1,
}

// One epic-scored normal note (length 4): computeTheoreticalMaxScore = 10*4*1 = 40.
const CHART: SongChart = {
  meta: { artist: 'Nova Lane', title: 'Paper Satellites', mp3Path: 'song.mp3', bpm: 120, gap: 0, videoGap: 0 },
  lines: [{ part: 'solo', notes: [{ kind: 'normal', startBeat: 0, length: 4, pitch: 60, syllable: 'Hello' }] }],
}

vi.mock('../../stage/chart/useChartLoader', () => ({
  useChartLoader: () => ({ status: 'ready', chart: CHART, sourceDir: '/library/nova', error: null }),
}))

const motionMocks = vi.hoisted(() => ({ reducedMotion: false }))

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return { ...actual, useReducedMotion: () => motionMocks.reducedMotion }
})

const playSfx = vi.fn<(name: SfxName) => void>()

const WINNER_SCORE = 10000
const RUNNER_UP_SCORE = 4200

function mockApi() {
  window.api = {
    session: { start: vi.fn(), recordEntry: vi.fn().mockResolvedValue(undefined), listLeaderboard: vi.fn() },
    players: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
      reorder: vi.fn(),
      readImportedPhoto: vi.fn(),
    },
  } as unknown as Window['api']
}

/** Two singers, Mira the winner -- the shape that exercises every beat. */
function seedDuo() {
  useSessionStore.setState({
    phase: 'results',
    sessionId: 's1',
    selectedSong: SONG,
    assignedPlayerIds: ['p1', 'p2'],
    lastResult: [
      { playerId: 'p1', score: RUNNER_UP_SCORE, epicCount: 0, goodCount: 1, awfulCount: 0, bestLine: 'Alex line' },
      { playerId: 'p2', score: WINNER_SCORE, epicCount: 1, goodCount: 0, awfulCount: 0, bestLine: 'Hello' },
    ],
    songsPlayedThisSession: 1,
  })
  usePlayersStore.setState({
    players: [
      { id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '', songsSung: 2, bestScore: 30 },
      { id: 'p2', name: 'Mira', color: 'gold', avatarUrl: '', songsSung: 4, bestScore: 10 },
    ],
  })
  mockApi()
}

/** One singer -- beats 3 and 4 have nothing to reveal. */
function seedSolo() {
  useSessionStore.setState({
    phase: 'results',
    sessionId: 's1',
    selectedSong: SONG,
    assignedPlayerIds: ['p1'],
    lastResult: [{ playerId: 'p1', score: 40, epicCount: 1, goodCount: 0, awfulCount: 0, bestLine: 'Hello' }],
    songsPlayedThisSession: 1,
  })
  usePlayersStore.setState({
    players: [{ id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '', songsSung: 2, bestScore: 30 }],
  })
  mockApi()
}

const SCHEDULE = beatSchedule(WINNER_SCORE)
const SEQUENCE_END_MS = SCHEDULE.actions + 500

let clock = 0

/**
 * Advance the fake clock to an absolute offset from mount, in small slices.
 *
 * The slicing matters. One big `advanceTimersByTime` fires every due timer
 * before React ever commits, so an animation a beat *starts* would be handed a
 * clock that had already run past its own duration and would never step. Moving
 * in ~frame-sized increments lets renders, effects and the frame loop interleave
 * the way they do in real time.
 */
const STEP_MS = 25

function advanceTo(ms: number) {
  while (clock < ms) {
    const step = Math.min(STEP_MS, ms - clock)
    act(() => {
      vi.advanceTimersByTime(step)
    })
    clock += step
  }
}

function beat(): string {
  return screen.getByTestId('session-results').getAttribute('data-beat') ?? ''
}

function sfxCount(name: SfxName): number {
  return playSfx.mock.calls.filter(([called]) => called === name).length
}

beforeEach(() => {
  motionMocks.reducedMotion = false
  playSfx.mockClear()
  useSfx.setState({ play: playSfx })
  clock = 0
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('SessionResults choreography', () => {
  beforeEach(seedDuo)

  // Beat 1. The payoff has to be on screen immediately -- nothing about the
  // winner is behind a delay.
  it('opens on beat 1 with the winner and a Winner label, and nothing else yet', () => {
    render(<SessionResults />)

    expect(beat()).toBe('winner')
    expect(screen.getByTestId('results-winner')).toHaveTextContent('Mira')
    expect(screen.getByTestId('results-winner-label')).toHaveTextContent(/winner/i)

    expect(screen.queryByTestId('results-crown')).not.toBeInTheDocument()
    expect(screen.queryByTestId('results-confetti')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('results-player-row')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /choose new song/i })).not.toBeInTheDocument()
  })

  // Beat 2. The crown, the cheer and the confetti are one moment, not three.
  it('lands the crown on beat 2, firing crownLand and cheer once each and bursting the confetti', () => {
    render(<SessionResults />)
    expect(sfxCount('crownLand')).toBe(0)
    expect(sfxCount('cheer')).toBe(0)

    advanceTo(SCHEDULE.crown + 1)

    expect(beat()).toBe('crown')
    expect(screen.getByTestId('results-crown')).toBeInTheDocument()
    expect(screen.getByTestId('results-confetti')).toBeInTheDocument()
    expect(sfxCount('crownLand')).toBe(1)
    expect(sfxCount('cheer')).toBe(1)
  })

  it('does not re-fire the crown beat as the sequence continues', () => {
    render(<SessionResults />)
    advanceTo(SEQUENCE_END_MS)

    expect(sfxCount('crownLand')).toBe(1)
    expect(sfxCount('cheer')).toBe(1)
  })

  // Beat 3.
  it('slides the winner across on beat 3', () => {
    render(<SessionResults />)
    advanceTo(SCHEDULE.slide + 1)

    expect(beat()).toBe('slide')
    expect(screen.getByTestId('results-winner-column')).toHaveAttribute('data-slid', 'true')
  })

  // Beat 4. "Remaining players" -- the winner is the hero on the left, so the
  // column that fades in is everybody else, ranked.
  it('fades the remaining players in on beat 4, ranked, one row each', () => {
    render(<SessionResults />)
    advanceTo(SCHEDULE.slide + 1)
    expect(screen.queryAllByTestId('results-player-row')).toHaveLength(0)

    advanceTo(SCHEDULE.roster + 1)

    expect(beat()).toBe('roster')
    const rows = screen.getAllByTestId('results-player-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Alex')
    expect(rows[0]).toHaveAttribute('data-rank', '2')
  })

  // Beat 5. The roll itself is framer-motion's frame loop, which runs on the
  // real requestAnimationFrame it captured at import and so cannot be stepped
  // by a fake clock -- it is proved end to end in
  // SessionResultsSequence.test.tsx, and in ScoreCounter's own suite. What is deterministic here, and what
  // matters here, is that the readout starts at a zero-padded zero and carries
  // the authoritative score the whole time.
  it('holds a zero-padded zero until beat 5, and the real score as data throughout', () => {
    render(<SessionResults />)

    expect(screen.getByTestId('results-score')).toHaveAttribute('data-final-score', String(WINNER_SCORE))
    advanceTo(SCHEDULE.count - STEP_MS)
    expect(screen.getByTestId('results-score')).toHaveTextContent('00000')
    expect(sfxCount('scoreTick')).toBe(0)
  })

  // Beat 6.
  it('fades the actions in on beat 6 with a bing and a bong, once each', () => {
    render(<SessionResults />)
    advanceTo(SCHEDULE.actions - 1)
    expect(screen.queryByRole('button', { name: /choose new song/i })).not.toBeInTheDocument()
    expect(sfxCount('uiBing')).toBe(0)

    advanceTo(SEQUENCE_END_MS)

    expect(beat()).toBe('actions')
    expect(screen.getByRole('button', { name: /choose new song/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /leave/i })).toBeInTheDocument()
    expect(sfxCount('uiBing')).toBe(1)
    expect(sfxCount('uiBong')).toBe(1)
  })

  it('sounds the bong after the bing, so the pair reads as two notes not a chord', () => {
    render(<SessionResults />)
    advanceTo(SEQUENCE_END_MS)

    const names = playSfx.mock.calls.map(([name]) => name)
    expect(names.indexOf('uiBing')).toBeLessThan(names.indexOf('uiBong'))
  })

  // The order is the specification. Everything else on this screen is tuning.
  it('reaches every beat exactly once, in the specified order', () => {
    render(<SessionResults />)

    const seen: string[] = [beat()]
    for (let ms = 0; ms <= SEQUENCE_END_MS; ms += 20) {
      advanceTo(ms)
      if (beat() !== seen[seen.length - 1]) seen.push(beat())
    }

    expect(seen).toEqual([...BEAT_ORDER])
  })

  it('fires the celebration sounds in beat order', () => {
    render(<SessionResults />)
    advanceTo(SEQUENCE_END_MS)

    const names = playSfx.mock.calls.map(([name]) => name)
    expect(names.indexOf('crownLand')).toBeLessThan(names.indexOf('uiBing'))
    expect(names.indexOf('cheer')).toBeLessThan(names.indexOf('uiBing'))
  })
})

// The end-to-end pass on the real clock lives in SessionResultsSequence.test.tsx:
// framer-motion's frame loop is a module singleton that closes over the
// requestAnimationFrame present when it was imported, so a file that has already
// installed a fake clock cannot then drive it on the real one.

describe('SessionResults data', () => {
  beforeEach(seedDuo)

  it('shows every assigned player exactly once -- the winner as the hero, the rest as rows', () => {
    render(<SessionResults />)
    advanceTo(SEQUENCE_END_MS)

    expect(screen.getAllByText('Mira')).toHaveLength(1)
    expect(screen.getAllByText('Alex')).toHaveLength(1)
    expect(screen.getByTestId('results-player-score')).toHaveAttribute('data-final-score', String(RUNNER_UP_SCORE))
  })

  it('declares the highest scorer the winner, even though they were assigned second', () => {
    render(<SessionResults />)
    expect(screen.getByTestId('results-winner')).toHaveTextContent('Mira')
  })

  it('renders the rating.ts-computed title and stars', () => {
    render(<SessionResults />)
    advanceTo(SEQUENCE_END_MS)

    expect(screen.getByText('Superstar')).toBeInTheDocument()
    expect(screen.getByTestId('results-stars')).toHaveTextContent('★★★★★')
  })

  it('renders the tier breakdown and best-line callout', () => {
    render(<SessionResults />)
    advanceTo(SEQUENCE_END_MS)

    expect(screen.getByTestId('results-tier-breakdown')).toHaveTextContent('1')
    expect(screen.getByTestId('results-best-line')).toHaveTextContent('Hello')
  })

  it('quotes no best line for a winner who scored nothing', () => {
    useSessionStore.setState({
      lastResult: [
        { playerId: 'p1', score: 0, epicCount: 0, goodCount: 0, awfulCount: 3, bestLine: 'Wake up, the night' },
        { playerId: 'p2', score: 0, epicCount: 0, goodCount: 0, awfulCount: 2, bestLine: 'Hello' },
      ],
    })
    render(<SessionResults />)
    advanceTo(SEQUENCE_END_MS)

    expect(screen.getByTestId('results-winner')).toBeInTheDocument()
    expect(screen.queryByTestId('results-best-line')).not.toBeInTheDocument()
  })

  // Mic number is the identity carrier; the rim colour is reinforcement, and
  // must never be the only thing distinguishing two players.
  it('keeps the mic number visible for the winner and for every ranked row', () => {
    render(<SessionResults />)
    advanceTo(SEQUENCE_END_MS)

    expect(screen.getByTestId('results-winner-mic')).toHaveTextContent('2')
    expect(screen.getByTestId('results-player-row')).toHaveTextContent('1')
  })

  // The number spinning on screen is decoration; a screen reader gets the whole
  // result as one sentence, immediately, without waiting out the sequence.
  it('announces the full result in a live region from the very first frame', () => {
    render(<SessionResults />)

    const announcer = screen.getByTestId('results-announcer')
    expect(announcer).toHaveTextContent('Mira')
    expect(announcer).toHaveTextContent('10,000')
    expect(announcer).toHaveTextContent('Superstar')
    expect(announcer).toHaveTextContent('Alex')
  })

  // "★★★★★" reads as "black star black star black star..." A screen reader gets
  // "5 out of 5 stars" from the announcer instead.
  it('hides the star glyphs from assistive tech, which hears the rating in words', () => {
    render(<SessionResults />)
    advanceTo(SEQUENCE_END_MS)

    expect(screen.getByTestId('results-stars')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('results-announcer')).toHaveTextContent('5 out of 5 stars')
  })

  it('names the winner by microphone number, not by colour, in the announcement', () => {
    render(<SessionResults />)
    expect(screen.getByTestId('results-announcer')).toHaveTextContent('microphone 2')
  })

  it('falls back to the empty state when there is no result', () => {
    useSessionStore.setState({ lastResult: null })
    render(<SessionResults />)
    expect(screen.getByText(/no results yet/i)).toBeInTheDocument()
  })
})

describe('SessionResults as a full-screen surface', () => {
  beforeEach(seedDuo)

  it('fills the viewport rather than floating a panel in the middle of it', () => {
    render(<SessionResults />)

    const surface = screen.getByTestId('session-results')
    expect(surface.style.height).toBe('100dvh')
    expect(surface.className).toContain('w-full')
    expect(surface.className).not.toContain('m-auto')
  })

  // Every dimension is a multiple of `--u`, so the screen scales with the display.
  it('states the design unit on its root, so every dimension under it scales', () => {
    render(<SessionResults />)

    expect(screen.getByTestId('session-results').style.getPropertyValue('--u')).toContain('100vw / 1920')
  })

  it('leads its own header row with Back, then names the song just sung', () => {
    render(<SessionResults />)

    const back = screen.getByRole('button', { name: 'Back' })
    const heading = screen.getByRole('heading', { level: 1, name: 'Paper Satellites' })

    expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Nova Lane')).toBeInTheDocument()
  })

  it('carries Back on the empty branch too', () => {
    useSessionStore.setState({ lastResult: null })
    render(<SessionResults />)

    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  // In flow, not `absolute inset-0 z-50`: SceneTransition serialises in-flow
  // scenes, and an overlay would cover the mic-recovery and abandon dialogs.
  it('takes the viewport in flow, never by lifting itself out of the scene stack', () => {
    render(<SessionResults />)

    const surface = screen.getByTestId('session-results')
    expect(surface.className).not.toContain('absolute')
    expect(surface.className).not.toContain('z-50')
    expect(surface.style.position).not.toBe('absolute')
    expect(surface.style.height).toBe('100dvh')
  })

  // Seven rows must never push the winner or the actions off a short window.
  it('keeps a full party of eight on screen, scrolling the ranked column if it must', () => {
    useSessionStore.setState({
      assignedPlayerIds: ['p1', 'p2'],
      lastResult: [
        { playerId: 'p2', score: WINNER_SCORE, epicCount: 1, goodCount: 0, awfulCount: 0, bestLine: 'Hello' },
        ...Array.from({ length: 7 }, (_, i) => ({
          playerId: `extra-${i}`,
          score: 1000 - i,
          epicCount: 0,
          goodCount: 1,
          awfulCount: 0,
          bestLine: null,
        })),
      ],
    })
    render(<SessionResults />)
    advanceTo(SEQUENCE_END_MS)

    expect(screen.getAllByTestId('results-player-row')).toHaveLength(7)
    expect(screen.getByTestId('results-ranked-column').className).toContain('overflow-y-auto')
    expect(screen.getByTestId('results-winner')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /choose new song/i })).toBeInTheDocument()
  })
})

// The crown is an image file (assets/ui/crown.png via resultsAssets.ts) so the
// artwork can be swapped without touching code.
describe('SessionResults crown artwork', () => {
  beforeEach(seedDuo)

  it('draws the crown as an image, not as drawing instructions in the component', () => {
    render(<SessionResults />)
    advanceTo(SCHEDULE.crown + 1)

    const crown = screen.getByTestId('results-crown')
    const image = crown.querySelector('img')
    expect(image).not.toBeNull()
    expect(image!.getAttribute('src')).toBe(CROWN_IMAGE_URL)
    expect(crown.querySelector('svg')).toBeNull()
  })

  // The box the flight is aimed at. A replacement PNG of a different shape is
  // fitted inside it rather than stretched to it, so swapping the file can never
  // move where the crown lands.
  it('holds the crown in the same 86x60 unit box the SVG occupied, fitted not stretched', () => {
    render(<SessionResults />)
    advanceTo(SCHEDULE.crown + 1)

    const image = screen.getByTestId('results-crown-image')
    expect(image.style.width).toBe(`calc(${CROWN_BOX_UNITS.width} * var(--u, 1px))`)
    expect(image.style.height).toBe(`calc(${CROWN_BOX_UNITS.height} * var(--u, 1px))`)
    expect(image.style.objectFit).toBe('contain')
  })

  // It is decoration: the result is spoken by the live region.
  it('hides the crown from assistive tech', () => {
    render(<SessionResults />)
    advanceTo(SCHEDULE.crown + 1)

    expect(screen.getByTestId('results-crown')).toHaveAttribute('aria-hidden')
    expect(screen.getByTestId('results-crown-image')).toHaveAttribute('alt', '')
  })

  // Reduce Motion has no flight, but it still has a winner wearing a crown.
  it('still wears the crown under reduced motion, as the same image', () => {
    motionMocks.reducedMotion = true
    render(<SessionResults />)

    expect(screen.getByTestId('results-crown-image').getAttribute('src')).toBe(CROWN_IMAGE_URL)
  })
})

describe('SessionResults actions', () => {
  beforeEach(seedDuo)

  it('"Choose New Song" steps the session back to song selection', () => {
    render(<SessionResults />)
    advanceTo(SEQUENCE_END_MS)

    fireEvent.click(screen.getByRole('button', { name: /choose new song/i }))
    expect(useSessionStore.getState().phase).toBe('select')
  })

  it('"Leave" ends the session outright', () => {
    render(<SessionResults />)
    advanceTo(SEQUENCE_END_MS)

    fireEvent.click(screen.getByRole('button', { name: /leave/i }))
    expect(useSessionStore.getState().phase).toBe('idle')
  })

  // The leaderboard scene is only ever opened from here, so removing its way in
  // would strand it. It stays, visually subordinate to the two named actions.
  it('still offers the leaderboard, subordinate to the two primary actions', () => {
    render(<SessionResults />)
    advanceTo(SEQUENCE_END_MS)

    fireEvent.click(screen.getByRole('button', { name: /leaderboard/i }))
    expect(useSessionStore.getState().phase).toBe('leaderboard')
  })
})

describe('SessionResults skip', () => {
  beforeEach(seedDuo)

  // Seen once per song, all night: nobody should have to wait it out.
  it('offers a real, focusable skip control while the sequence runs', () => {
    render(<SessionResults />)

    const skip = screen.getByTestId('results-skip')
    expect(skip.tagName).toBe('BUTTON')
    expect(skip).toHaveFocus()
  })

  it('jumps straight to the finished state when the skip control is pressed', () => {
    render(<SessionResults />)
    fireEvent.click(screen.getByTestId('results-skip'))

    expect(beat()).toBe('actions')
    expect(screen.getByTestId('results-score')).toHaveTextContent('10000')
    expect(screen.getByRole('button', { name: /choose new song/i })).toBeInTheDocument()
    expect(screen.getByTestId('results-player-row')).toBeInTheDocument()
  })

  it('jumps to the finished state on any keypress, without hunting for the control', () => {
    render(<SessionResults />)
    act(() => {
      fireEvent.keyDown(window, { key: 'a' })
    })
    expect(beat()).toBe('actions')
  })

  // Escape is the global Back binding. Swallowing it here would make leaving
  // the results screen take two presses.
  it('leaves Escape to the global Back handler', () => {
    render(<SessionResults />)
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(beat()).toBe('winner')
  })

  it('removes the skip control once the sequence is over', () => {
    render(<SessionResults />)
    advanceTo(SEQUENCE_END_MS)
    expect(screen.queryByTestId('results-skip')).not.toBeInTheDocument()
  })

  // When the focused Skip control disappears, focus is handed on so a gamepad
  // is not left pointing at nothing.
  it('hands focus to the primary action when the skip control disappears', () => {
    render(<SessionResults />)
    advanceTo(SEQUENCE_END_MS)

    expect(screen.getByRole('button', { name: /choose new song/i })).toHaveFocus()
  })

  it('tears the confetti down when skipped mid-burst', () => {
    render(<SessionResults />)
    advanceTo(SCHEDULE.crown + 1)
    expect(screen.getByTestId('results-confetti')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('results-skip'))
    expect(screen.queryByTestId('results-confetti')).not.toBeInTheDocument()
  })

  // Skipping is the user saying "stop", so it must not dump every remaining
  // cue at once.
  it('plays no further choreography sounds after a skip', () => {
    render(<SessionResults />)
    fireEvent.click(screen.getByTestId('results-skip'))
    playSfx.mockClear()

    advanceTo(SEQUENCE_END_MS)

    for (const name of ['crownLand', 'cheer', 'scoreTick', 'uiBing', 'uiBong'] as SfxName[]) {
      expect(sfxCount(name)).toBe(0)
    }
  })

  it('never fires the celebration at all when skipped before the crown lands', () => {
    render(<SessionResults />)
    fireEvent.click(screen.getByTestId('results-skip'))
    advanceTo(SEQUENCE_END_MS)

    expect(sfxCount('crownLand')).toBe(0)
    expect(sfxCount('cheer')).toBe(0)
  })
})

describe('SessionResults under reduced motion', () => {
  beforeEach(() => {
    motionMocks.reducedMotion = true
    seedDuo()
  })

  // Someone who asked for less motion still gets their result -- all of it,
  // instantly, with no sequence to sit through.
  it('collapses to the finished state on the first frame', () => {
    render(<SessionResults />)

    expect(beat()).toBe('actions')
    expect(screen.getByTestId('results-winner')).toHaveTextContent('Mira')
    expect(screen.getByTestId('results-score')).toHaveTextContent('10000')
    expect(screen.getByTestId('results-player-row')).toHaveTextContent('Alex')
    expect(screen.getByTestId('results-stars')).toHaveTextContent('★★★★★')
    expect(screen.getByRole('button', { name: /choose new song/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /leave/i })).toBeInTheDocument()
  })

  it('shows no confetti and no crown flight', () => {
    render(<SessionResults />)
    advanceTo(SEQUENCE_END_MS)
    expect(screen.queryByTestId('results-confetti')).not.toBeInTheDocument()
  })

  it('offers no skip control -- there is nothing left to skip', () => {
    render(<SessionResults />)
    expect(screen.queryByTestId('results-skip')).not.toBeInTheDocument()
  })

  // Reduced motion is about motion, not celebration. The one sound that is not
  // tied to a movement still plays; the impact, tick and fade-in cues, whose
  // beats no longer exist, do not.
  it('still cheers, once, but fires none of the motion-tied cues', () => {
    render(<SessionResults />)
    advanceTo(SEQUENCE_END_MS)

    expect(sfxCount('cheer')).toBe(1)
    expect(sfxCount('crownLand')).toBe(0)
    expect(sfxCount('scoreTick')).toBe(0)
    expect(sfxCount('uiBing')).toBe(0)
    expect(sfxCount('uiBong')).toBe(0)
  })

  it('puts focus on the primary action, since there is no skip control to hold it', () => {
    render(<SessionResults />)
    expect(screen.getByRole('button', { name: /choose new song/i })).toHaveFocus()
  })
})

describe('SessionResults solo result', () => {
  beforeEach(seedSolo)

  // Sliding the winner aside to reveal an empty column would be motion for its
  // own sake, so with nobody else to reveal the hero stays centred.
  it('keeps the lone singer centred -- beats 3 and 4 have nothing to reveal', () => {
    render(<SessionResults />)
    advanceTo(beatSchedule(40).actions + 500)

    expect(screen.getByTestId('results-winner-column')).toHaveAttribute('data-slid', 'false')
    expect(screen.queryAllByTestId('results-player-row')).toHaveLength(0)
  })

  it('still runs the sequence to the actions beat, on a four-digit readout', () => {
    render(<SessionResults />)
    advanceTo(beatSchedule(40).actions + 500)

    expect(beat()).toBe('actions')
    expect(screen.getByTestId('results-score')).toHaveAttribute('data-final-score', '40')
  })

  it('pads a two-digit score to the four digits the roll starts from', () => {
    render(<SessionResults />)
    expect(screen.getByTestId('results-score')).toHaveTextContent('0000')
  })
})

describe('SessionResults write-backs', () => {
  beforeEach(seedDuo)

  it('records the session entry and writes back player stats for every assigned player', async () => {
    render(<SessionResults />)

    await vi.waitFor(() =>
      expect(window.api!.session.recordEntry).toHaveBeenCalledWith({
        sessionId: 's1',
        songPath: '/library/nova',
        playerId: 'p1',
        score: RUNNER_UP_SCORE,
        epicCount: 0,
        goodCount: 1,
        awfulCount: 0,
        difficulty: 'normal',
      }),
    )
    expect(window.api!.session.recordEntry).toHaveBeenCalledWith({
      sessionId: 's1',
      songPath: '/library/nova',
      playerId: 'p2',
      score: WINNER_SCORE,
      epicCount: 1,
      goodCount: 0,
      awfulCount: 0,
      difficulty: 'normal',
    })

    expect(window.api!.players.update).toHaveBeenCalledWith({ id: 'p1', songsSung: 3, bestScore: RUNNER_UP_SCORE })
    expect(window.api!.players.update).toHaveBeenCalledWith({ id: 'p2', songsSung: 5, bestScore: WINNER_SCORE })
  })

  // The regression the longer choreography puts at risk: the write-backs are
  // fired once on mount, independent of every beat, so a sequence that now runs
  // for seconds can neither replay them nor drop them.
  it('fires each write-back exactly once across the whole sequence', () => {
    render(<SessionResults />)
    advanceTo(SEQUENCE_END_MS)

    expect(window.api!.session.recordEntry).toHaveBeenCalledTimes(2)
    expect(window.api!.players.update).toHaveBeenCalledTimes(2)
  })

  it('does not replay them when the sequence is skipped', () => {
    render(<SessionResults />)
    fireEvent.click(screen.getByTestId('results-skip'))
    advanceTo(SEQUENCE_END_MS)

    expect(window.api!.session.recordEntry).toHaveBeenCalledTimes(2)
    expect(window.api!.players.update).toHaveBeenCalledTimes(2)
  })

  // Someone hitting Back the instant the screen appears must not lose the song
  // they just sang.
  it('has already fired them if the screen is left before the first beat ends', () => {
    const { unmount } = render(<SessionResults />)
    unmount()

    expect(window.api!.session.recordEntry).toHaveBeenCalledTimes(2)
    expect(window.api!.players.update).toHaveBeenCalledTimes(2)
  })

  it('leaves no timers behind when the screen is left mid-sequence', () => {
    const { unmount } = render(<SessionResults />)
    advanceTo(SCHEDULE.crown + 1)
    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('SessionResults per-singer ranks and records', () => {
  beforeEach(() => {
    seedDuo()
    motionMocks.reducedMotion = true
  })

  it('calls missed notes missed', () => {
    render(<SessionResults />)
    expect(screen.getByTestId('results-tier-breakdown')).toHaveTextContent('Missed 0')
    expect(screen.getByTestId('results-tier-breakdown')).not.toHaveTextContent(/awful/i)
  })

  it('ranks every singer, each against their own part, not only the winner', () => {
    render(<SessionResults />)
    // The runner-up sang P1's part, whose ceiling is the full 10,000 scale.
    expect(screen.getByTestId('results-player-rating')).toHaveTextContent(computeRating(RUNNER_UP_SCORE, 10000).title)
  })

  it('marks the singer who beat the song record on their difficulty', async () => {
    window.api!.session.listSongHighscores = vi.fn().mockResolvedValue([
      { sessionId: 'old', songPath: '/library/nova', playerId: 'p9', score: 9000, epicCount: 0, goodCount: 0, awfulCount: 0, playedAt: 1, difficulty: 'normal' },
    ])
    render(<SessionResults />)

    await vi.waitFor(() => expect(screen.getAllByTestId('results-new-highscore')).toHaveLength(1))
    expect(screen.getByTestId('results-winner-column')).toHaveTextContent('New highscore!')
    expect(window.api!.session.listSongHighscores).toHaveBeenCalledWith({ songPath: '/library/nova', limit: 3 })
  })

  it('claims no record when the old one still stands', async () => {
    const list = vi.fn().mockResolvedValue([
      { sessionId: 'old', songPath: '/library/nova', playerId: 'p9', score: 10000, epicCount: 0, goodCount: 0, awfulCount: 0, playedAt: 1, difficulty: 'normal' },
    ])
    window.api!.session.listSongHighscores = list
    render(<SessionResults />)

    await vi.waitFor(() => expect(list).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByTestId('results-new-highscore')).not.toBeInTheDocument()
  })
})

describe('SessionResults for every singer', () => {
  beforeEach(() => {
    seedDuo()
    motionMocks.reducedMotion = true
  })

  it('gives each ranked singer a rolling score, stars, a rank and a note summary of their own', () => {
    render(<SessionResults />)

    const row = screen.getByTestId('results-player-row')
    expect(screen.getByTestId('results-player-score')).toHaveTextContent('4200')
    expect(screen.getByTestId('results-player-stars')).toHaveTextContent('★★☆☆☆')
    expect(row).toHaveTextContent(computeRating(RUNNER_UP_SCORE).title)
    expect(screen.getByTestId('results-player-tiers')).toHaveTextContent('Good 1')
  })

  it('summarises the lines each singer earned, in the verdicts they saw', () => {
    const [runnerUp, winner] = useSessionStore.getState().lastResult!
    useSessionStore.setState({
      lastResult: [
        { ...runnerUp, lineCounts: { perfect: 0, great: 2, good: 1, ok: 0 } },
        { ...winner, lineCounts: { perfect: 3, great: 0, good: 0, ok: 1 } },
      ],
    })
    render(<SessionResults />)

    expect(screen.getByTestId('results-player-tiers')).toHaveTextContent('Great ×2Good ×1')
    expect(screen.getByTestId('results-player-tiers')).not.toHaveTextContent('Perfect')
    expect(screen.getByTestId('results-tier-breakdown')).toHaveTextContent('Perfect ×3OK ×1')
  })

  it('counts the singers in the footer', () => {
    render(<SessionResults />)
    expect(screen.getByText('2 singers')).toBeInTheDocument()
  })
})

describe('SessionResults in Versus', () => {
  beforeEach(() => {
    seedDuo()
    useSessionStore.setState({ mode: 'battle' })
    motionMocks.reducedMotion = true
  })

  afterEach(() => {
    useSessionStore.setState({ mode: 'classic' })
  })

  it('calls the duel in a banner: who won, and by how much', () => {
    render(<SessionResults />)

    const banner = screen.getByTestId('battle-results-banner')
    expect(banner).toHaveTextContent('Mira wins!')
    expect(banner).toHaveTextContent('Beats Alex by 5,800 points')
    expect(screen.getByTestId('results-winner-label')).toHaveTextContent('Versus winner!')
    expect(screen.getByTestId('results-rematch')).toBeInTheDocument()
  })

  it('calls a level score a tie rather than naming a winner', () => {
    useSessionStore.setState({
      lastResult: [
        { playerId: 'p1', score: 5000, epicCount: 0, goodCount: 1, awfulCount: 0, bestLine: null },
        { playerId: 'p2', score: 5000, epicCount: 1, goodCount: 0, awfulCount: 0, bestLine: null },
      ],
    })
    render(<SessionResults />)

    const banner = screen.getByTestId('battle-results-banner')
    expect(banner).toHaveAttribute('data-tie', 'true')
    expect(banner).toHaveTextContent("It's a tie!")
    expect(screen.getByTestId('results-winner-label')).not.toHaveTextContent(/winner/i)
  })

  it('shows no banner outside Versus', () => {
    useSessionStore.setState({ mode: 'classic' })
    render(<SessionResults />)
    expect(screen.queryByTestId('battle-results-banner')).not.toBeInTheDocument()
  })
})

describe('SessionResults in German', () => {
  beforeEach(() => {
    seedDuo()
    motionMocks.reducedMotion = true
  })

  afterEach(async () => {
    await setLanguage(null)
  })

  it('translates the screen, keeps rank names, and formats numbers the German way', async () => {
    await act(() => setLanguage('de'))
    render(<SessionResults />)

    expect(screen.getByRole('button', { name: 'Neuen Song wählen' })).toBeInTheDocument()
    expect(screen.getByText('Superstar')).toBeInTheDocument()
    expect(screen.getByText('2 Stimmen')).toBeInTheDocument()
    expect(screen.getByTestId('results-announcer')).toHaveTextContent('10.000 Punkten')
  })
})
