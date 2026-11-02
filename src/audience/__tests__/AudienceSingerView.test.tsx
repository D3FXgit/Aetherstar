import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AudienceSingerView } from '../AudienceSingerView'
import { resetChartCacheForTests } from '../../stage/chart/useChartLoader'
import { useHitStore } from '../../game/state/useHitStore'
import type { AudienceNoteClear, AudienceSingerPitch, AudiencePlayback, AudienceSinger } from '../types'

/**
 * Reduce Motion, switchable per case.
 *
 * `useReducedMotion` reads a module-level media query framer-motion initialises
 * once per process, so it cannot be stubbed per test through `matchMedia`.
 * Replacing just that one export leaves every other part of framer-motion --
 * the MotionValues the lanes scroll on, `useAnimationFrame` -- entirely real.
 */
let reduceMotion = false
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return { ...actual, useReducedMotion: () => reduceMotion }
})

const CHART = [
  '#ARTIST:Test Artist',
  '#TITLE:Test Song',
  '#MP3:song.mp3',
  '#VIDEO:clip.mpg',
  '#COVER:cover.jpg',
  '#BPM:60',
  '#GAP:0',
  ': 0 4 60 Aa',
  ': 8 4 62 Bb',
  '- 16',
  ': 20 4 64 Cc',
  'E',
  '',
].join('\n')

const SONG = { path: '/songs/test', title: 'Test Song', artist: 'Test Artist', coverUrl: null }

const SINGERS: AudienceSinger[] = [
  { playerId: 'p1', name: 'Alex', micNumber: 1, avatarUrl: '' },
  { playerId: 'p2', name: 'Sam', micNumber: 2, avatarUrl: '' },
]

/** Position 0 so the visible-window cull keeps every fixture note mounted, and the video needs no seek. */
const PLAYBACK: AudiencePlayback = { positionMs: 0, atEpochMs: Date.now(), paused: false }

function renderView(
  props: { clears?: AudienceNoteClear[]; playback?: AudiencePlayback | null; pitches?: AudienceSingerPitch[] } = {},
) {
  return render(
    <AudienceSingerView
      song={SONG}
      singers={SINGERS}
      players={[{ playerId: 'p1', name: 'Alex', score: 1234, combo: 2, rank: 1 }]}
      lyrics={{ currentLineIndex: 0, activeSyllableIndex: 0 }}
      playback={props.playback === undefined ? PLAYBACK : props.playback}
      micRigConfigured
        clears={props.clears ?? []}
        pitches={props.pitches ?? []}
    />,
  )
}

beforeEach(() => {
  reduceMotion = false
  useHitStore.getState().reset()
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      // The handler names the file it actually served, which is how the
      // renderer learns the song's real directory (a library song's path is its
      // *folder*, so the chart sits one level deeper).
      headers: { get: () => '/songs/test/notes.txt' },
      text: () => Promise.resolve(CHART),
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  useHitStore.getState().reset()
  // A module-level singleton that outlives both the React tree and this test's
  // fetch stub (see useChartLoader).
  resetChartCacheForTests()
})

const laneFor = (playerId: string) => screen.getByTestId(`audience-lane-${playerId}`)

describe('AudienceSingerView -- the note lanes on the television', () => {
  it('draws one real lane per microphone, in mic order, labelled by number', async () => {
    renderView()
    await waitFor(() => expect(screen.getByTestId('audience-lane-stack')).toBeInTheDocument())

    expect(screen.getByTestId('audience-lane-stack')).toHaveAttribute('data-lane-count', '2')
    // The mic number is the identifier and is always drawn; the rim colour only
    // reinforces it. Both come from the real LanePanel, not a lookalike.
    expect(within(laneFor('p1')).getByTestId('lane-slot-badge')).toHaveTextContent('Mic 1')
    expect(within(laneFor('p2')).getByTestId('lane-slot-badge')).toHaveTextContent('Mic 2')
    expect(within(laneFor('p1')).getByTestId('lane-singer-name')).toHaveTextContent('Alex')
    expect(laneFor('p1').getAttribute('data-player-color')).not.toBe(laneFor('p2').getAttribute('data-player-color'))
  })

  it('mounts the chart\'s notes in every lane, from the chart it loaded itself', async () => {
    renderView()
    await waitFor(() => expect(screen.getByTestId('audience-lane-stack')).toBeInTheDocument())

    // Nothing about the notes crosses the IPC boundary: the audience window
    // already loads this chart for the lyric box, so positions are free.
    expect(within(laneFor('p1')).getByTestId('note-lane').dataset.noteCount).toBe('3')
    expect(within(laneFor('p2')).getByTestId('note-lane').dataset.noteCount).toBe('3')
    // The lanes page line by line, exactly as the host's do: at the top of
    // the song only the first line (two notes) is up.
    expect(within(laneFor('p1')).getAllByTestId('note-block')).toHaveLength(2)
    expect(within(laneFor('p2')).getAllByTestId('note-block')).toHaveLength(2)
  })

  it('pages to the next line on its own clock, with no broadcast lyric indices', async () => {
    // Beat 18 at 60 BPM (250 ms a beat): past line one's break marker at 16.
    renderView({ playback: { positionMs: 18 * 250, atEpochMs: Date.now(), paused: true } })
    await waitFor(() => expect(within(laneFor('p1')).getAllByTestId('note-block')).toHaveLength(1))
    await waitFor(() => expect(screen.getByTestId('clock-lyrics')).toHaveTextContent('Cc'))
  })

  it("runs the lanes and lyrics on the host's #GAP + speaker-delay offset", async () => {
    // Beat 18 of the raw chart, but the host shifted #GAP by 1000 ms (4 beats
    // at 60 BPM): the host is at beat 14, still on line one.
    const { rerender } = renderView({ playback: { positionMs: 18 * 250, atEpochMs: Date.now(), paused: true, gapOffsetMs: 1000 } })
    await waitFor(() => expect(screen.getByTestId('audience-lane-stack')).toBeInTheDocument())
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(within(laneFor('p1')).getAllByTestId('note-block')).toHaveLength(2)

    // 22 raw beats - 4 = beat 18: now past the break, as on the host.
    rerender(
      <AudienceSingerView
        song={SONG}
        singers={SINGERS}
        players={[]}
        lyrics={{ currentLineIndex: 0, activeSyllableIndex: 0 }}
        playback={{ positionMs: 22 * 250, atEpochMs: Date.now(), paused: true, gapOffsetMs: 1000 }}
        micRigConfigured
        clears={[]}
        pitches={[]}
      />,
    )
    await waitFor(() => expect(within(laneFor('p1')).getAllByTestId('note-block')).toHaveLength(1))
  })

  // The host's pause menu reaches the room as a plain "Paused", not as a
  // frozen frame nobody can explain. A stopped clock alone (the lead-in, the
  // end of the song) says nothing.
  it('says Paused while the host has the song paused, and only then', async () => {
    const { rerender } = renderView({ playback: { ...PLAYBACK, paused: true } })
    await waitFor(() => expect(screen.getByTestId('audience-lane-stack')).toBeInTheDocument())
    expect(screen.queryByTestId('audience-paused')).not.toBeInTheDocument()

    const paused = { ...PLAYBACK, paused: true, pausedByHost: true } as AudiencePlayback
    rerender(
      <AudienceSingerView
        song={SONG}
        singers={SINGERS}
        players={[{ playerId: 'p1', name: 'Alex', score: 1234, combo: 2, rank: 1 }]}
        lyrics={{ currentLineIndex: 0, activeSyllableIndex: 0 }}
        playback={paused}
        micRigConfigured
        clears={[]}
        pitches={[]}
      />,
    )
    expect(screen.getByTestId('audience-paused')).toHaveTextContent('Paused')
  })

  it('shows no lanes at all before the chart has loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no media scheme')))
    renderView()
    await waitFor(() => expect(screen.getByTestId('audience-lyrics-pending')).toBeInTheDocument())
    expect(screen.queryByTestId('audience-lane-stack')).not.toBeInTheDocument()
  })

  it('carries no pitch line -- there is no microphone in this window, and no per-frame channel for one', async () => {
    renderView()
    await waitFor(() => expect(screen.getByTestId('audience-lane-stack')).toBeInTheDocument())
    // Pinned so a later pass cannot quietly add one back: it would have to be
    // fed either from a capture this window must never open, or through a
    // 34ms-coalesced relay that would make it stutter.
    expect(screen.queryByTestId('pitch-line')).not.toBeInTheDocument()
  })
})

describe('AudienceSingerView -- broadcast judgements clear the right notes', () => {
  it('lights a note in its own singer\'s lane and nobody else\'s', async () => {
    const { rerender } = renderView()
    await waitFor(() => expect(screen.getByTestId('audience-lane-stack')).toBeInTheDocument())

    rerender(
      <AudienceSingerView
        song={SONG}
        singers={SINGERS}
        players={[]}
        lyrics={{ currentLineIndex: 0, activeSyllableIndex: 0 }}
        playback={PLAYBACK}
        micRigConfigured
        pitches={[]}
        clears={[{ playerId: 'p1', noteId: 'note-0', tier: 'epic', credit: 1 }]}
      />,
    )

    const mine = within(laneFor('p1')).getAllByTestId('note-block')[0]
    const theirs = within(laneFor('p2')).getAllByTestId('note-block')[0]
    expect(mine).toHaveAttribute('data-cleared', 'epic')
    // Every lane draws the same chart under the same note ids, so without a
    // per-lane owner one singer's hit would light up all eight lanes.
    expect(theirs).not.toHaveAttribute('data-cleared')
  })

  it('fills a partly-sung note only as far as the credit it earned', async () => {
    const { rerender } = renderView()
    await waitFor(() => expect(screen.getByTestId('audience-lane-stack')).toBeInTheDocument())

    rerender(
      <AudienceSingerView
        song={SONG}
        singers={SINGERS}
        players={[]}
        lyrics={{ currentLineIndex: 0, activeSyllableIndex: 0 }}
        playback={PLAYBACK}
        micRigConfigured
        pitches={[]}
        clears={[{ playerId: 'p2', noteId: 'note-1', tier: 'good', credit: 0.4 }]}
      />,
    )

    // Partial credit is the reason the clears are replayed into the real hit
    // store rather than handed to NoteLane's declarative `hitTiers` prop, which
    // flattens every clear to a full fill.
    const note = within(laneFor('p2')).getAllByTestId('note-block')[1]
    expect(note).toHaveAttribute('data-cleared', 'good')
    expect(note).toHaveAttribute('data-partial', 'true')
    expect(note.style.getPropertyValue('--ae-note-fill')).toBe('0.4')
  })

  it('applies each judgement of a batch, not just the last', async () => {
    const { rerender } = renderView()
    await waitFor(() => expect(screen.getByTestId('audience-lane-stack')).toBeInTheDocument())

    rerender(
      <AudienceSingerView
        song={SONG}
        singers={SINGERS}
        players={[]}
        lyrics={{ currentLineIndex: 0, activeSyllableIndex: 0 }}
        playback={PLAYBACK}
        micRigConfigured
        pitches={[]}
        clears={[
          { playerId: 'p1', noteId: 'note-0', tier: 'epic', credit: 1 },
          { playerId: 'p1', noteId: 'note-1', tier: 'awful' },
          { playerId: 'p1', noteId: 'note-2', tier: 'good', credit: 1 },
        ]}
      />,
    )

    // The lane paints `latest`, so a batch written in one store call would show
    // one note and silently drop the rest. (The third note is on the next page;
    // it is painted when that page comes up.)
    const notes = within(laneFor('p1')).getAllByTestId('note-block')
    expect(notes.map((note) => note.getAttribute('data-cleared'))).toEqual(['epic', 'awful'])
  })

  it('paints the trail a window opened mid-song has already missed', async () => {
    // The chart is a fetch away and the audience display can be switched on
    // halfway through a song, so the first payloads always arrive before there
    // is a lane to paint them on. They are replayed when the lanes appear.
    renderView({ clears: [{ playerId: 'p2', noteId: 'note-1', tier: 'good', credit: 1 }] })
    await waitFor(() => expect(screen.getByTestId('audience-lane-stack')).toBeInTheDocument())
    expect(within(laneFor('p2')).getAllByTestId('note-block')[1]).toHaveAttribute('data-cleared', 'good')
  })

  it('does not inherit the previous song\'s judgements', async () => {
    const { rerender } = renderView({ clears: [{ playerId: 'p1', noteId: 'note-0', tier: 'epic', credit: 1 }] })
    await waitFor(() =>
      expect(within(laneFor('p1')).getAllByTestId('note-block')[0]).toHaveAttribute('data-cleared', 'epic'),
    )

    rerender(
      <AudienceSingerView
        song={{ ...SONG, path: '/songs/other' }}
        singers={SINGERS}
        players={[]}
        lyrics={{ currentLineIndex: 0, activeSyllableIndex: 0 }}
        playback={PLAYBACK}
        micRigConfigured
        pitches={[]}
        clears={[]}
      />,
    )

    await waitFor(() => expect(useHitStore.getState().events).toHaveLength(0))
    expect(within(laneFor('p1')).getAllByTestId('note-block')[0]).not.toHaveAttribute('data-cleared')
  })
})

describe('AudienceSingerView -- the video backdrop, and the silence rule', () => {
  it('plays the song\'s video behind the screen', async () => {
    renderView()
    const video = await screen.findByTestId('audience-stage-video')
    expect(video).toHaveAttribute('src', 'app-media://media/songs/test/clip.mpg')
  })

  it('mutes that video four ways, including the content attribute React will not write', async () => {
    renderView()
    const video = (await screen.findByTestId('audience-stage-video')) as HTMLVideoElement

    // React treats `muted` as a *property* and deliberately does not reflect the
    // content attribute -- which is what a freshly-created element (a src swap,
    // a codec fallback) consults for its initial state. All four, or the second
    // screen can make a sound.
    expect(video.hasAttribute('muted')).toBe(true)
    expect(video.defaultMuted).toBe(true)
    expect(video.muted).toBe(true)
    expect(video.volume).toBe(0)
  })

  it('has no <audio> element anywhere in the singing view', async () => {
    const { container } = renderView()
    await screen.findByTestId('audience-stage-video')
    // The audience window is a screen, not a second speaker. The song's audio
    // belongs to the host machine alone.
    expect(container.querySelectorAll('audio')).toHaveLength(0)
    expect(container.querySelectorAll('video')).toHaveLength(1)
  })

  it('degrades an undecodable video to the cover art rather than a black rectangle', async () => {
    renderView()
    const video = await screen.findByTestId('audience-stage-video')
    // Real UltraStar libraries are full of MPEG-2 .mpg and DivX .avi. The cover
    // is already painted underneath, so this is a removal, not a swap -- there
    // is never a flash of black.
    expect(screen.getByTestId('stage-ambient-cover')).toBeInTheDocument()
    fireEvent.error(video)
    await waitFor(() => expect(screen.queryByTestId('audience-stage-video')).not.toBeInTheDocument())
    expect(screen.getByTestId('stage-ambient-cover')).toBeInTheDocument()
    expect(screen.getByTestId('audience-lane-stack')).toBeInTheDocument()
  })

  it('shows the still cover instead of the video under Reduce Motion', async () => {
    reduceMotion = true
    renderView()
    await waitFor(() => expect(screen.getByTestId('audience-lane-stack')).toBeInTheDocument())
    expect(screen.queryByTestId('audience-stage-video')).not.toBeInTheDocument()
    expect(screen.getByTestId('stage-ambient-cover')).toBeInTheDocument()
  })

  it('offers the room nothing to press', async () => {
    renderView()
    await screen.findByTestId('audience-lane-stack')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

/**
 * The pitch rules on the television.
 *
 * Reported from a real party: "the audience screen also needs the pitch marker
 * and the filling pills, they currently don't show up." The rule had been left
 * out on purpose (see AudienceNoteLanes.tsx); this is that decision reversed.
 */
describe('the live pitch rules', () => {
  it('draws no rule for a singer with no broadcast pitch', async () => {
    renderView({ pitches: [] })
    await screen.findByTestId('audience-lane-stack')

    expect(screen.queryAllByTestId('pitch-line')).toHaveLength(0)
  })

  it('draws one rule per singer who is currently making a pitch', async () => {
    renderView({ pitches: [{ playerId: 'p1', semitone: 4 }] })
    await screen.findByTestId('audience-lane-stack')

    expect(screen.getAllByTestId('pitch-line')).toHaveLength(1)
  })

  it('draws the rule inside that singer\'s own lane, not the first one', async () => {
    renderView({ pitches: [{ playerId: 'p2', semitone: 4 }] })
    await screen.findByTestId('audience-lane-stack')

    const samsLane = screen.getByTestId('audience-lane-p2')
    expect(within(samsLane).getAllByTestId('pitch-line')).toHaveLength(1)
    expect(within(screen.getByTestId('audience-lane-p1')).queryAllByTestId('pitch-line')).toHaveLength(0)
  })

  it('draws a rule for every singer when both are singing', async () => {
    renderView({
      pitches: [
        { playerId: 'p1', semitone: 2 },
        { playerId: 'p2', semitone: 7 },
      ],
    })
    await screen.findByTestId('audience-lane-stack')

    expect(screen.getAllByTestId('pitch-line')).toHaveLength(2)
  })
})
