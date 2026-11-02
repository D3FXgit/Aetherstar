import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, render } from '@testing-library/react'
import {
  ingestAudiencePayload,
  normalizeAudienceState,
  resetAudienceStoreForTests,
  shareAudienceState,
  useAudienceFeed,
  useAudienceSlice,
  useAudienceState,
  useAudienceStore,
} from '../useAudienceState'
import { EMPTY_AUDIENCE_STATE } from '../types'

let scoreStateCallback: ((state: unknown) => void) | undefined

beforeEach(() => {
  resetAudienceStoreForTests()
  scoreStateCallback = undefined
  // @ts-expect-error -- only onScoreState matters for this test
  window.api = {
    audience: {
      onScoreState: vi.fn((cb: (state: unknown) => void) => {
        scoreStateCallback = cb
        return () => {}
      }),
    },
  } as Window['api']
})

afterEach(() => {
  resetAudienceStoreForTests()
  delete window.api
})

describe('normalizeAudienceState', () => {
  it('reads a payload that names no screen the way the old scoreboard-only channel did', () => {
    expect(normalizeAudienceState({ players: [], combo: 0, rank: [] }).view).toBe('idle')
    expect(
      normalizeAudienceState({
        players: [{ playerId: 'p1', name: 'Alex', score: 10, combo: 0, rank: 1 }],
        combo: 0,
        rank: ['p1'],
      }).view,
    ).toBe('scoreboard')
  })

  it('fills in every field a partial payload leaves out', () => {
    expect(normalizeAudienceState({ view: 'lineup' })).toEqual({ ...EMPTY_AUDIENCE_STATE, view: 'lineup' })
    expect(normalizeAudienceState(null)).toEqual(EMPTY_AUDIENCE_STATE)
  })
})

describe('useAudienceState', () => {
  it('starts idle and follows main\'s throttled broadcast', () => {
    const { result } = renderHook(() => useAudienceState())
    expect(result.current).toEqual(EMPTY_AUDIENCE_STATE)

    act(() => {
      scoreStateCallback?.({
        view: 'play',
        song: { path: '/s', title: 'Glasswing', artist: 'Nova', coverUrl: null },
        singers: [{ playerId: 'p1', name: 'Alex', micNumber: 1, avatarUrl: '' }],
        players: [{ playerId: 'p1', name: 'Alex', score: 50, combo: 1, rank: 1 }],
        combo: 1,
        rank: ['p1'],
        results: [],
        lyrics: { currentLineIndex: 4, activeSyllableIndex: 2 },
      })
    })

    expect(result.current.view).toBe('play')
    expect(result.current.song?.title).toBe('Glasswing')
    expect(result.current.lyrics).toEqual({ currentLineIndex: 4, activeSyllableIndex: 2 })
  })
})

const SINGER = { playerId: 'p1', name: 'Alex', micNumber: 1, avatarUrl: '' }
const CLEAR = { noteId: 'n1', playerId: 'p1', tier: 'epic' as const }

describe('the audience store -- only what changed re-renders', () => {
  it('keeps the identity of every field whose content did not change', () => {
    ingestAudiencePayload({ view: 'play', singers: [SINGER], playback: { positionMs: 0, atEpochMs: 1, paused: false } })
    const before = useAudienceStore.getState()

    // A fresh object graph, as every IPC message is -- only the clock moved.
    ingestAudiencePayload({
      view: 'play',
      singers: [{ ...SINGER }],
      playback: { positionMs: 34, atEpochMs: 35, paused: false },
    })
    const after = useAudienceStore.getState()

    expect(after).not.toBe(before)
    expect(after.singers).toBe(before.singers)
    expect(after.playback).not.toBe(before.playback)
  })

  it('does not notify at all for a message that changes nothing', () => {
    ingestAudiencePayload({ view: 'lineup', singers: [SINGER] })
    const listener = vi.fn()
    const unsubscribe = useAudienceStore.subscribe(listener)
    ingestAudiencePayload({ view: 'lineup', singers: [{ ...SINGER }] })
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('keeps unchanged elements of a changed array', () => {
    const previous = normalizeAudienceState({
      view: 'play',
      players: [
        { playerId: 'p1', name: 'Alex', score: 10, combo: 0, rank: 1 },
        { playerId: 'p2', name: 'Sam', score: 5, combo: 0, rank: 2 },
      ],
    })
    const next = shareAudienceState(
      previous,
      normalizeAudienceState({
        view: 'play',
        players: [
          { playerId: 'p1', name: 'Alex', score: 10, combo: 0, rank: 1 },
          { playerId: 'p2', name: 'Sam', score: 50, combo: 0, rank: 1 },
        ],
      }),
    )
    expect(next.players).not.toBe(previous.players)
    expect(next.players[0]).toBe(previous.players[0])
    expect(next.players[1]).not.toBe(previous.players[1])
  })

  it('re-renders a slice consumer only when its own fields change', () => {
    const renders = vi.fn()
    function SingersOnly() {
      useAudienceFeed()
      const { singers } = useAudienceSlice('singers')
      renders(singers.length)
      return null
    }
    render(<SingersOnly />)
    act(() => scoreStateCallback?.({ view: 'play', singers: [SINGER] }))
    const afterSingers = renders.mock.calls.length

    for (let tick = 1; tick <= 5; tick++) {
      act(() =>
        scoreStateCallback?.({
          view: 'play',
          singers: [{ ...SINGER }],
          playback: { positionMs: tick * 34, atEpochMs: tick * 34, paused: false },
        }),
      )
    }
    expect(renders.mock.calls.length).toBe(afterSingers)
  })

  it('keeps the clears it holds when the host marks them unchanged, and drops the marker', () => {
    ingestAudiencePayload({ view: 'play', clears: [CLEAR] })
    ingestAudiencePayload({ view: 'play', clears: [], clearsUnchanged: true })
    expect(useAudienceStore.getState().clears).toEqual([CLEAR])
    expect('clearsUnchanged' in useAudienceStore.getState()).toBe(false)
  })

  it('does not carry clears across a change of screen, marker or not', () => {
    ingestAudiencePayload({ view: 'play', clears: [CLEAR] })
    ingestAudiencePayload({ view: 'results', clears: [], clearsUnchanged: true })
    expect(useAudienceStore.getState().clears).toEqual([])
  })
})
