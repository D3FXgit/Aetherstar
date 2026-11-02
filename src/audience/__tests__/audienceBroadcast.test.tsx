import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { SelectablePlayerBadge } from '../../session/SelectablePlayerBadge'
import { useSceneStore } from '../../scenes/sceneStore'
import { useSessionStore } from '../../session/sessionStore'
import { usePlayersStore } from '../../players/store'
import { useStageStore } from '../../stage/stageStore'
import {
  AUDIENCE_PUBLISH_INTERVAL_MS,
  composeAudienceState,
  flushAudiencePublish,
  installAudienceHostBroadcast,
  publishAudienceState,
  requestAudiencePublish,
  resetAudienceBroadcastForTests,
  setAudienceAssignSelection,
  setAudienceScoreSource,
} from '../audienceBroadcast'
import { useHitStore } from '../../game/state/useHitStore'
import { AUDIENCE_CLEAR_WINDOW } from '../types'
import type { LibrarySong } from '../../library/types'

const SONG: LibrarySong = {
  path: '/songs/nova',
  artist: 'Nova Lane',
  title: 'Glasswing',
  durationMs: 262000,
  thumbnailPath: '/nova/cover.jpg',
  mp3Path: '/songs/nova/song.mp3',
  videoPath: null,
  bpm: 250,
  gap: 0,
  hasVideo: false,
  hasCover: true,
  isDuet: false,
  isPlayable: true,
  addedAt: 0,
}

const PROFILES = [
  { id: 'p1', name: 'Alex', color: '#fff', avatarUrl: 'app-media://media/alex.png' },
  { id: 'p2', name: 'Sam', color: '#fff', avatarUrl: '' },
]

let uninstall: (() => void) | null = null

beforeEach(() => {
  // @ts-expect-error -- only the audience surface matters here
  window.api = { audience: { reportScoreState: vi.fn() } } as Window['api']
  useSceneStore.setState({ current: 'home', history: [] })
  useSessionStore.setState({
    phase: 'idle',
    sessionId: null,
    selectedSong: null,
    assignedPlayerIds: [],
    lastResult: null,
    songsPlayedThisSession: 0,
  })
  usePlayersStore.setState({ players: PROFILES })
  useStageStore.getState().reset()
  resetAudienceBroadcastForTests()
})

afterEach(() => {
  uninstall?.()
  uninstall = null
  resetAudienceBroadcastForTests()
  delete window.api
})

function lastSent() {
  const mock = window.api!.audience.reportScoreState as unknown as ReturnType<typeof vi.fn>
  return mock.mock.calls.at(-1)?.[0]
}

describe('composeAudienceState -- which screen the audience mirrors', () => {
  it('is the idle attract screen on Home, and on every screen the room is not part of', () => {
    for (const scene of ['home', 'session-select', 'settings', 'players'] as const) {
      useSceneStore.setState({ current: scene })
      expect(composeAudienceState().view).toBe('idle')
    }
  })

  it('is the line-up on player selection, and stays there through the 3-2-1 transition', () => {
    useSceneStore.setState({ current: 'session-assign' })
    expect(composeAudienceState().view).toBe('lineup')
    useSceneStore.setState({ current: 'session-starting' })
    expect(composeAudienceState().view).toBe('lineup')
  })

  it('is the singer view while the song is playing, and the celebration after it', () => {
    useSceneStore.setState({ current: 'session-play' })
    expect(composeAudienceState().view).toBe('play')
    useSceneStore.setState({ current: 'session-results' })
    expect(composeAudienceState().view).toBe('results')
  })

  it('keeps the celebration up while the host browses the leaderboard, then returns to idle', () => {
    useSceneStore.setState({ current: 'session-leaderboard' })
    expect(composeAudienceState().view).toBe('results')
    useSceneStore.setState({ current: 'home' })
    expect(composeAudienceState().view).toBe('idle')
  })

  it('carries the chosen song with a resolved cover URL', () => {
    useSceneStore.setState({ current: 'session-assign' })
    useSessionStore.setState({ selectedSong: SONG })
    expect(composeAudienceState().song).toEqual({
      path: '/songs/nova',
      title: 'Glasswing',
      artist: 'Nova Lane',
      coverUrl: 'aetherstar-media://roots/nova/cover.jpg',
    })
  })

  it('carries a null cover for a song with no artwork rather than a broken URL', () => {
    useSceneStore.setState({ current: 'session-assign' })
    useSessionStore.setState({ selectedSong: { ...SONG, thumbnailPath: null, hasCover: false } })
    expect(composeAudienceState().song?.coverUrl).toBeNull()
  })

  it('numbers the confirmed singers by their microphone, resolving names and avatars from the roster', () => {
    useSceneStore.setState({ current: 'session-play' })
    useSessionStore.setState({ selectedSong: SONG, assignedPlayerIds: ['p2', 'p1'] })
    expect(composeAudienceState().singers).toEqual([
      { playerId: 'p2', name: 'Sam', micNumber: 1, avatarUrl: '' },
      { playerId: 'p1', name: 'Alex', micNumber: 2, avatarUrl: 'app-media://media/alex.png' },
    ])
  })

  it('mirrors the lyric position only while the song is playing', () => {
    useStageStore.setState({ currentLineIndex: 7, activeSyllableIndex: 3 })
    useSceneStore.setState({ current: 'session-play' })
    expect(composeAudienceState().lyrics).toEqual({ currentLineIndex: 7, activeSyllableIndex: 3 })

    useSceneStore.setState({ current: 'session-results' })
    expect(composeAudienceState().lyrics).toBeNull()
  })

  it('ranks the result rows highest-first and gives each one its mic number', () => {
    useSceneStore.setState({ current: 'session-results' })
    useSessionStore.setState({
      selectedSong: SONG,
      assignedPlayerIds: ['p1', 'p2'],
      lastResult: [
        { playerId: 'p1', score: 100, epicCount: 1, goodCount: 0, awfulCount: 0, bestLine: 'a' },
        { playerId: 'p2', score: 900, epicCount: 9, goodCount: 0, awfulCount: 0, bestLine: 'b' },
      ],
    })

    const results = composeAudienceState().results
    expect(results.map((row) => [row.name, row.score, row.micNumber])).toEqual([
      ['Sam', 900, 2],
      ['Alex', 100, 1],
    ])
  })

  it('reports no results outside the results screen, so the TV cannot show last song\'s winner over this one', () => {
    useSceneStore.setState({ current: 'session-play' })
    useSessionStore.setState({
      assignedPlayerIds: ['p1'],
      lastResult: [{ playerId: 'p1', score: 100, epicCount: 1, goodCount: 0, awfulCount: 0, bestLine: null }],
    })
    expect(composeAudienceState().results).toEqual([])
  })
})

describe('audienceBroadcast -- one sender on the channel', () => {
  it('sends the composed screen, not a bare score table', () => {
    useSceneStore.setState({ current: 'session-assign' })
    useSessionStore.setState({ selectedSong: SONG })
    publishAudienceState()
    expect(lastSent()).toMatchObject({ view: 'lineup', song: { title: 'Glasswing' } })
  })

  it('publishes on every scene, session, roster and stage change once installed', () => {
    uninstall = installAudienceHostBroadcast()
    const mock = window.api!.audience.reportScoreState as unknown as ReturnType<typeof vi.fn>
    const afterInstall = mock.mock.calls.length
    expect(afterInstall).toBeGreaterThan(0)

    useSceneStore.setState({ current: 'session-play' })
    flushAudiencePublish()
    useSessionStore.setState({ selectedSong: SONG })
    flushAudiencePublish()
    useStageStore.setState({ currentLineIndex: 2 })
    flushAudiencePublish()

    expect(mock.mock.calls.length).toBe(afterInstall + 3)
    expect(lastSent()).toMatchObject({ view: 'play', lyrics: { currentLineIndex: 2 } })
  })

  it('is idempotent -- installing twice does not double the traffic', () => {
    uninstall = installAudienceHostBroadcast()
    const second = installAudienceHostBroadcast()
    const mock = window.api!.audience.reportScoreState as unknown as ReturnType<typeof vi.fn>
    const before = mock.mock.calls.length
    useSceneStore.setState({ current: 'session-play' })
    flushAudiencePublish()
    expect(mock.mock.calls.length).toBe(before + 1)
    second()
  })

  // Eight notes ending in the same frame must not mean eight payloads: a burst
  // is the leading send plus one trailing send carrying the final state.
  it('coalesces a burst of store changes into a leading and one trailing send', () => {
    vi.useFakeTimers()
    try {
      uninstall = installAudienceHostBroadcast()
      const mock = window.api!.audience.reportScoreState as unknown as ReturnType<typeof vi.fn>
      vi.advanceTimersByTime(AUDIENCE_PUBLISH_INTERVAL_MS)
      const before = mock.mock.calls.length

      useSceneStore.setState({ current: 'session-play' })
      for (let line = 1; line <= 8; line++) useStageStore.setState({ currentLineIndex: line })
      expect(mock.mock.calls.length).toBe(before + 1)

      vi.advanceTimersByTime(AUDIENCE_PUBLISH_INTERVAL_MS)
      expect(mock.mock.calls.length).toBe(before + 2)
      expect(lastSent()).toMatchObject({ view: 'play', lyrics: { currentLineIndex: 8 } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('never sends more often than the relay forwards', () => {
    vi.useFakeTimers()
    try {
      uninstall = installAudienceHostBroadcast()
      const mock = window.api!.audience.reportScoreState as unknown as ReturnType<typeof vi.fn>
      const before = mock.mock.calls.length

      // A change every 5 ms for 330 ms: at most one send per interval.
      for (let tick = 0; tick < 66; tick++) {
        useStageStore.setState({ currentLineIndex: tick })
        vi.advanceTimersByTime(5)
      }
      vi.advanceTimersByTime(AUDIENCE_PUBLISH_INTERVAL_MS)
      const sends = mock.mock.calls.length - before
      expect(sends).toBeGreaterThan(0)
      expect(sends).toBeLessThanOrEqual(Math.ceil(330 / AUDIENCE_PUBLISH_INTERVAL_MS) + 1)
      expect(lastSent()).toMatchObject({ lyrics: null })
    } finally {
      vi.useRealTimers()
    }
  })

  it('composes nothing while the preload reports no audience window, and catches up when one opens', () => {
    let presence: ((open: boolean) => void) | undefined
    const reportScoreState = vi.fn()
    // @ts-expect-error -- only the audience surface matters here
    window.api = {
      audience: {
        reportScoreState,
        onWindowPresence: (callback: (open: boolean) => void) => {
          presence = callback
          callback(false)
          return () => {}
        },
      },
    } as Window['api']

    uninstall = installAudienceHostBroadcast()
    useSceneStore.setState({ current: 'session-assign' })
    requestAudiencePublish()
    flushAudiencePublish()
    publishAudienceState()
    expect(reportScoreState).not.toHaveBeenCalled()

    presence?.(true)
    expect(reportScoreState).toHaveBeenCalledOnce()
    expect(lastSent()).toMatchObject({ view: 'lineup' })
  })

  it('takes the live score table from whichever store is registered, and drops it when unregistered', () => {
    let listener: (() => void) | undefined
    const store = {
      getState: () => ({
        players: [{ playerId: 'p1', name: 'Alex', score: 4200, combo: 3, rank: 1 }],
        combo: 3,
        rank: ['p1'],
      }),
      subscribe: (fn: () => void) => {
        listener = fn
        return () => {
          listener = undefined
        }
      },
    }

    const unregister = setAudienceScoreSource(store)
    listener?.()
    flushAudiencePublish()
    // combo is deprecated: whatever the store holds, the audience is told 0.
    expect(lastSent()).toMatchObject({ players: [{ playerId: 'p1', score: 4200 }], combo: 0, rank: ['p1'] })

    unregister()
    expect(lastSent()).toMatchObject({ players: [], combo: 0, rank: [] })
  })
})

describe('audienceBroadcast -- the line-up as it is being picked', () => {
  it('lists the singers picked on the selection screen before "Start singing" commits them', () => {
    useSceneStore.setState({ current: 'session-assign' })
    useSessionStore.setState({ selectedSong: SONG })
    render(
      <div>
        <SelectablePlayerBadge name="Alex" avatarUrl="" micNumber={1} size={120} onClick={() => {}} />
        <SelectablePlayerBadge name="Sam" avatarUrl="" micNumber={2} size={120} onClick={() => {}} />
      </div>,
    )

    uninstall = installAudienceHostBroadcast()

    expect(lastSent()).toMatchObject({
      view: 'lineup',
      singers: [
        { playerId: 'p1', name: 'Alex', micNumber: 1 },
        { playerId: 'p2', name: 'Sam', micNumber: 2 },
      ],
    })
  })

  it('prefers an explicitly published selection over the screen mirror', () => {
    useSceneStore.setState({ current: 'session-assign' })
    uninstall = installAudienceHostBroadcast()

    setAudienceAssignSelection(['p2'])
    expect(lastSent()).toMatchObject({ singers: [{ playerId: 'p2', name: 'Sam', micNumber: 1 }] })

    setAudienceAssignSelection(null)
    expect(lastSent()).toMatchObject({ singers: [] })
  })
})

describe('audienceBroadcast -- the clock anchor and the note clears', () => {
  function mountHostClock(currentTime: number, paused = false) {
    document.body.innerHTML = '<audio data-testid="stage-clock-audio"></audio>'
    const element = document.querySelector('audio') as HTMLAudioElement
    Object.defineProperty(element, 'currentTime', { value: currentTime, configurable: true })
    Object.defineProperty(element, 'paused', { value: paused, configurable: true })
    return element
  }

  afterEach(() => {
    document.body.innerHTML = ''
    useHitStore.getState().reset()
  })

  it('carries the host clock, stamped with the wall clock both windows share', () => {
    // This anchor is the audience window's entire sense of time: without it the
    // note lanes cannot scroll and the backdrop video cannot follow the song.
    useSceneStore.setState({ current: 'session-play' })
    mountHostClock(42.5)
    const before = Date.now()

    const state = composeAudienceState()
    expect(state.playback?.positionMs).toBe(42500)
    expect(state.playback?.paused).toBe(false)
    expect(state.playback?.atEpochMs).toBeGreaterThanOrEqual(before)
  })

  it('sends no clock and no clears off the singing screen', () => {
    // A `querySelector` on every publish, on every screen, for a reading nothing
    // can use -- and a lineup payload that claimed a position would have the
    // audience animate a song that has not started.
    mountHostClock(42.5)
    useHitStore.getState().recordHit({ playerId: 'p1', noteId: 'note-0', tier: 'epic', deviationCents: 0, t: 0 })

    for (const scene of ['home', 'session-assign', 'session-results'] as const) {
      useSceneStore.setState({ current: scene })
      expect(composeAudienceState().playback).toBeNull()
      expect(composeAudienceState().clears).toEqual([])
    }
  })

  it('carries the recent judgements, with the partial credit that decides how far a pill fills', () => {
    useSceneStore.setState({ current: 'session-play' })
    useHitStore.getState().recordHits([
      { playerId: 'p1', noteId: 'note-0', tier: 'epic', deviationCents: 4, t: 1, credit: 1 },
      { playerId: 'p2', noteId: 'note-0', tier: 'good', deviationCents: 40, t: 2, credit: 0.6 },
    ])

    expect(composeAudienceState().clears).toEqual([
      { playerId: 'p1', noteId: 'note-0', tier: 'epic', credit: 1 },
      { playerId: 'p2', noteId: 'note-0', tier: 'good', credit: 0.6 },
    ])
  })

  it('bounds the payload to the recent tail, however long the song is', () => {
    // The payload is re-sent whole ten times a second; an unbounded history
    // would grow the message all song. A clear only has to arrive before its
    // note leaves the lane.
    useSceneStore.setState({ current: 'session-play' })
    useHitStore.getState().recordHits(
      Array.from({ length: AUDIENCE_CLEAR_WINDOW + 40 }, (_, index) => ({
        playerId: 'p1',
        noteId: `note-${index}`,
        tier: 'epic' as const,
        deviationCents: 0,
        t: index,
      })),
    )

    const clears = composeAudienceState().clears
    expect(clears).toHaveLength(AUDIENCE_CLEAR_WINDOW)
    // The *newest* end is the one that matters -- those are the notes still on
    // screen.
    expect(clears.at(-1)?.noteId).toBe(`note-${AUDIENCE_CLEAR_WINDOW + 39}`)
  })

  // The clears tail is the one big array in the payload. Re-sending it
  // unchanged ~30 times a second is pure copying; it goes in full while it is
  // changing and is marked unchanged otherwise.
  it('re-sends the clears tail only while it is changing', () => {
    useSceneStore.setState({ current: 'session-play' })
    useHitStore.getState().recordHit({ playerId: 'p1', noteId: 'note-0', tier: 'epic', deviationCents: 0, t: 0 })

    const sent = () => lastSent() as { clears: unknown[]; clearsUnchanged?: true }
    // A few full sends right after the change, to survive a dropped message...
    for (let index = 0; index < 3; index++) {
      publishAudienceState()
      expect(sent().clears).toHaveLength(1)
      expect(sent().clearsUnchanged).toBeUndefined()
    }
    // ...then only the marker until something new is judged.
    publishAudienceState()
    expect(sent().clears).toEqual([])
    expect(sent().clearsUnchanged).toBe(true)

    useHitStore.getState().recordHit({ playerId: 'p1', noteId: 'note-1', tier: 'good', deviationCents: 0, t: 1 })
    publishAudienceState()
    expect(sent().clears).toHaveLength(2)
    expect(sent().clearsUnchanged).toBeUndefined()
  })

  // Review finding: note ids restart at `note-0` every song, and the hit store
  // was not cleared between songs, so song 1's tail was replayed onto song 2's
  // lanes -- and then suppressed song 2's real judgements as duplicates.
  it('never sends the judgements of the last song once the next song is on', () => {
    useSceneStore.setState({ current: 'session-play' })
    useSessionStore.setState({ selectedSong: SONG })
    useHitStore.getState().recordHit({ playerId: 'p1', noteId: 'note-0', tier: 'epic', deviationCents: 0, t: 0 })
    expect(composeAudienceState().clears).toHaveLength(1)

    // The next song comes on before its gameplay has reset the hit store.
    useSessionStore.setState({ selectedSong: { ...SONG, path: '/library/next-song' } })
    expect(composeAudienceState().clears).toEqual([])

    // Its own judgements still go out...
    useHitStore.getState().recordHit({ playerId: 'p1', noteId: 'note-0', tier: 'good', deviationCents: 0, t: 1 })
    expect(composeAudienceState().clears).toEqual([{ playerId: 'p1', noteId: 'note-0', tier: 'good', credit: undefined }])

    // ...and a reset (gameplay mounting) starts a clean run for this song.
    useHitStore.getState().reset()
    expect(composeAudienceState().clears).toEqual([])
    useHitStore.getState().recordHit({ playerId: 'p2', noteId: 'note-3', tier: 'epic', deviationCents: 0, t: 2 })
    expect(composeAudienceState().clears.map((clear) => clear.noteId)).toEqual(['note-3'])
  })

  it('polls the host clock only while a song is on screen', () => {
    vi.useFakeTimers()
    try {
      const element = mountHostClock(1)
      useSceneStore.setState({ current: 'session-play' })
      uninstall = installAudienceHostBroadcast()

      const mock = window.api!.audience.reportScoreState as unknown as ReturnType<typeof vi.fn>
      const atInstall = mock.mock.calls.length
      Object.defineProperty(element, 'currentTime', { value: 1.5, configurable: true })
      vi.advanceTimersByTime(300)
      expect(mock.mock.calls.length).toBeGreaterThan(atInstall)

      // Leaving the song stops the poll: nothing else on the audience display
      // moves per-frame, and a timer running on the home screen is a timer
      // nobody asked for.
      useSceneStore.setState({ current: 'home' })
      // The scene change itself is one (coalesced) publish; flush it so only
      // clock-driven traffic is counted below.
      flushAudiencePublish()
      const atHome = mock.mock.calls.length
      Object.defineProperty(element, 'currentTime', { value: 2.5, configurable: true })
      vi.advanceTimersByTime(1000)
      expect(mock.mock.calls.length).toBe(atHome)
    } finally {
      vi.useRealTimers()
    }
  })
})
