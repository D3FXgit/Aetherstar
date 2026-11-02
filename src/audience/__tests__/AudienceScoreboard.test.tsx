import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { AudienceScoreboard } from '../AudienceScoreboard'
import { useSfx } from '../../audio/useSfx'
import { resetChartCacheForTests } from '../../stage/chart/useChartLoader'
import { t } from '../../i18n'
import type { AudienceState } from '../types'

// Matches this test's own row testids (player-p1, player-p2, ...) without also
// matching PlayerBadge's internal data-testid="player-badge".
const ROW_TESTID_PATTERN = /^player-p\d+$/

const PROFILE_A = { id: 'p1', name: 'Alex', color: 'oklch(0.78 0.19 195)', avatarUrl: '' }

const SONG = { path: '/songs/nova', title: 'Glasswing', artist: 'Nova Lane', coverUrl: 'aetherstar-media://roots/c.jpg' }

let scoreStateCallback: ((state: unknown) => void) | undefined
let realPlay: ReturnType<typeof useSfx.getState>['play']
let playSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  scoreStateCallback = undefined
  // @ts-expect-error -- only the fields this test touches matter
  window.api = {
    audience: {
      onScoreState: vi.fn((cb: (state: unknown) => void) => {
        scoreStateCallback = cb
        return () => {}
      }),
    },
    players: { list: vi.fn().mockResolvedValue([PROFILE_A]) },
  } as Window['api']

  // The audience window must never make a sound. Swapping the sfx player for a
  // spy is how that is asserted rather than assumed -- see the silence block.
  realPlay = useSfx.getState().play
  playSpy = vi.fn()
  // Cast because the sfx player's return type is not this test's concern --
  // nothing in the audience tree is allowed to call it at all.
  useSfx.setState({ play: playSpy as unknown as typeof realPlay })

  // The singer/results views load the song's chart over app-media://; jsdom has
  // no such scheme, so answer it here rather than letting the loader log a
  // failed fetch on every render.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no media scheme in jsdom')))
})

afterEach(() => {
  useSfx.setState({ play: realPlay })
  vi.unstubAllGlobals()
  delete window.api
})

function push(state: Partial<AudienceState>) {
  act(() => scoreStateCallback?.(state))
}

describe('AudienceScoreboard -- mirroring the host, minus the controls', () => {
  it('shows the main screen (no buttons) while the host is idle', () => {
    render(<AudienceScoreboard />)
    expect(screen.getByTestId('audience-idle')).toBeInTheDocument()
    // HeroFrame *is* Home's screen; Home's two CTAs are what is missing.
    expect(screen.getByText(/^aetherstar$/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the song cover centred, and the singers as they are picked, during player selection', () => {
    render(<AudienceScoreboard />)

    push({ view: 'lineup', song: SONG, singers: [] })
    expect(screen.getByTestId('audience-lineup')).toBeInTheDocument()
    expect(screen.getByTestId('audience-cover-image')).toHaveAttribute('src', SONG.coverUrl)
    expect(screen.getByTestId('audience-song-title')).toHaveTextContent('Glasswing')
    expect(screen.queryByTestId('audience-lineup-list')).not.toBeInTheDocument()
    expect(screen.getByTestId('audience-lineup-waiting')).toHaveTextContent(t('audience.lineup.waiting'))

    push({
      view: 'lineup',
      song: SONG,
      singers: [
        { playerId: 'p1', name: 'Alex', micNumber: 1, avatarUrl: '' },
        { playerId: 'p2', name: 'Sam', micNumber: 2, avatarUrl: '' },
      ],
    })

    const rows = screen.getAllByTestId('audience-lineup-singer')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Alex')
    expect(rows[0]).toHaveAttribute('data-mic-number', '1')
    expect(rows[1]).toHaveAttribute('data-mic-number', '2')
    // The number is the identifier, always drawn -- colour is only reinforcement.
    expect(rows[1]).toHaveTextContent('2')
  })

  it('shows the singer view -- the song and the live scores -- while the song is playing', () => {
    render(<AudienceScoreboard />)

    push({
      view: 'play',
      song: SONG,
      singers: [{ playerId: 'p1', name: 'Alex', micNumber: 1, avatarUrl: '' }],
      players: [{ playerId: 'p1', name: 'Alex', score: 4200, combo: 5, rank: 1 }],
      rank: ['p1'],
      lyrics: { currentLineIndex: 0, activeSyllableIndex: 1 },
    })

    expect(screen.getByTestId('audience-singer-view')).toBeInTheDocument()
    expect(screen.getByTestId('audience-song-title')).toHaveTextContent('Glasswing')
    const board = screen.getAllByTestId('audience-live-score')
    expect(board).toHaveLength(1)
    expect(board[0]).toHaveTextContent('4,200')
    expect(board[0]).toHaveAttribute('data-mic-number', '1')
  })

  it('shows the celebration, without the buttons, on results', () => {
    render(<AudienceScoreboard />)

    push({
      view: 'results',
      song: SONG,
      results: [
        { playerId: 'p2', name: 'Sam', micNumber: 2, avatarUrl: '', score: 9000, epicCount: 9, goodCount: 0, awfulCount: 0, bestLine: 'we are angels' },
        { playerId: 'p1', name: 'Alex', micNumber: 1, avatarUrl: '', score: 1000, epicCount: 1, goodCount: 0, awfulCount: 0, bestLine: null },
      ],
    })

    expect(screen.getByTestId('audience-results')).toBeInTheDocument()
    expect(screen.getByTestId('audience-results-winner')).toHaveTextContent('Sam')
    expect(screen.getByTestId('audience-results-score')).toHaveTextContent('9,000')
    expect(screen.getAllByTestId('audience-results-row')).toHaveLength(1)
    // Every singer gets a rank of their own on the 10,000 scale, not just the winner.
    expect(screen.getByText('Superstar')).toBeInTheDocument()
    expect(screen.getByTestId('audience-results-row-rating')).toHaveTextContent('Tone Deaf')
    expect(screen.getByTestId('audience-results-winner-label')).toHaveTextContent(t('audience.results.winner'))
    // Choose New Song / Leave / Leaderboard belong to the host alone.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('goes back to idle when the host does', () => {
    render(<AudienceScoreboard />)
    push({ view: 'results', song: SONG, results: [] })
    expect(screen.getByTestId('audience-results')).toBeInTheDocument()
    push({ view: 'idle' })
    expect(screen.getByTestId('audience-idle')).toBeInTheDocument()
  })
})

describe('AudienceScoreboard -- the second screen never makes a sound', () => {
  const VIEWS: Partial<AudienceState>[] = [
    { view: 'idle' },
    { view: 'lineup', song: SONG, singers: [{ playerId: 'p1', name: 'Alex', micNumber: 1, avatarUrl: '' }] },
    {
      view: 'play',
      song: SONG,
      singers: [{ playerId: 'p1', name: 'Alex', micNumber: 1, avatarUrl: '' }],
      players: [{ playerId: 'p1', name: 'Alex', score: 10, combo: 0, rank: 1 }],
      lyrics: { currentLineIndex: 0, activeSyllableIndex: 0 },
    },
    {
      view: 'results',
      song: SONG,
      results: [{ playerId: 'p1', name: 'Alex', micNumber: 1, avatarUrl: '', score: 10, epicCount: 0, goodCount: 1, awfulCount: 0, bestLine: null }],
    },
    { view: 'scoreboard', players: [{ playerId: 'p1', name: 'Alex', score: 10, combo: 0, rank: 1 }], rank: ['p1'] },
  ]

  it('renders no <audio> and fires no sound cue on any screen it can show', () => {
    const { container } = render(<AudienceScoreboard />)

    for (const view of VIEWS) {
      push(view)
      // The song's audio belongs to the host machine alone. The singing view
      // carries a *video* backdrop (see the next case for how it is muted), but
      // nothing here can produce a sample, on any screen, ever.
      expect(container.querySelectorAll('audio')).toHaveLength(0)
    }

    expect(playSpy).not.toHaveBeenCalled()
  })

  it('hard-mutes the one media element it does have, and adds no audio alongside it', async () => {
    // Attribute, defaultMuted, property and volume, because React writes only
    // the property and a re-created element reads the attribute.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => '/songs/nova/notes.txt' },
        text: () =>
          Promise.resolve(
            ['#ARTIST:A', '#TITLE:T', '#MP3:song.mp3', '#VIDEO:clip.mp4', '#BPM:60', '#GAP:0', ': 0 4 60 la', 'E', ''].join('\n'),
          ),
      }),
    )
    const { container } = render(<AudienceScoreboard />)
    push({
      view: 'play',
      song: SONG,
      singers: [{ playerId: 'p1', name: 'Alex', micNumber: 1, avatarUrl: '' }],
      lyrics: { currentLineIndex: 0, activeSyllableIndex: 0 },
      playback: { positionMs: 0, atEpochMs: Date.now(), paused: false },
    })

    const video = (await screen.findByTestId('audience-stage-video')) as HTMLVideoElement
    expect(video.hasAttribute('muted')).toBe(true)
    expect(video.defaultMuted).toBe(true)
    expect(video.muted).toBe(true)
    expect(video.volume).toBe(0)
    expect(container.querySelectorAll('audio')).toHaveLength(0)
    expect(playSpy).not.toHaveBeenCalled()
    resetChartCacheForTests()
  })
})

describe('AudienceScoreboard -- the ranked table (lab scene and legacy payloads)', () => {
  it('falls back to the scoreboard for a payload that reports scores but names no screen', async () => {
    render(<AudienceScoreboard />)

    push({
      players: [{ playerId: 'p1', name: 'Alex', score: 1200, combo: 8, rank: 1 }],
      combo: 8,
      rank: ['p1'],
    })

    await waitFor(() => expect(screen.getByTestId('player-p1')).toBeInTheDocument())
    expect(screen.getByTestId('player-p1')).toHaveTextContent('Alex')
    expect(screen.getByTestId('player-p1')).toHaveTextContent('1200')
    expect(screen.queryByTestId('audience-idle')).not.toBeInTheDocument()
  })

  it('marks the rank[0] player as the leader', async () => {
    render(<AudienceScoreboard />)

    push({
      view: 'scoreboard',
      players: [{ playerId: 'p1', name: 'Alex', score: 1200, combo: 8, rank: 1 }],
      combo: 8,
      rank: ['p1'],
    })

    await waitFor(() => expect(screen.getByTestId('leader')).toBeInTheDocument())
    expect(screen.getByTestId('leader')).toHaveTextContent('Alex')
    // A sentence-case label, not a shouted mono one.
    expect(screen.getByText(t('audience.scoreboard.leader'))).toBeInTheDocument()
    expect(screen.queryByText('CURRENT LEADER')).not.toBeInTheDocument()
  })

  it('falls back to initials for a playerId with no matching profile', async () => {
    render(<AudienceScoreboard />)

    push({
      view: 'scoreboard',
      players: [{ playerId: 'unknown-id', name: 'Ghost', score: 10, combo: 0, rank: 1 }],
      combo: 0,
      rank: ['unknown-id'],
    })

    await waitFor(() => expect(screen.getByTestId('player-unknown-id')).toBeInTheDocument())
    expect(screen.getByTestId('player-unknown-id')).toHaveTextContent('Ghost')
  })

  it('re-orders rendered rows when rank order changes', async () => {
    render(<AudienceScoreboard />)

    push({
      view: 'scoreboard',
      players: [
        { playerId: 'p1', name: 'Alex', score: 100, combo: 0, rank: 2 },
        { playerId: 'p2', name: 'Sam', score: 200, combo: 0, rank: 1 },
      ],
      combo: 0,
      rank: ['p2', 'p1'],
    })

    await waitFor(() => expect(screen.getByTestId('player-p1')).toBeInTheDocument())
    let rows = screen.getAllByTestId(ROW_TESTID_PATTERN)
    expect(rows.map((r) => r.dataset.testid)).toEqual(['player-p2', 'player-p1'])

    push({
      view: 'scoreboard',
      players: [
        { playerId: 'p1', name: 'Alex', score: 300, combo: 0, rank: 1 },
        { playerId: 'p2', name: 'Sam', score: 200, combo: 0, rank: 2 },
      ],
      combo: 0,
      rank: ['p1', 'p2'],
    })

    await waitFor(() => {
      rows = screen.getAllByTestId(ROW_TESTID_PATTERN)
      expect(rows.map((r) => r.dataset.testid)).toEqual(['player-p1', 'player-p2'])
    })
  })
})
