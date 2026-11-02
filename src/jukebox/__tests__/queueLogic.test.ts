import { describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT,
  formatPlaybackTime,
  moveQueueItem,
  nextRepeat,
  nextStep,
  pickRandomSong,
  previousStep,
  withCycle,
  withHistory,
  type JukeboxPlayOrder,
} from '../queueLogic'
import type { LibrarySong } from '../../library/types'

function song(name: string, playable = true): LibrarySong {
  return {
    path: `/library/${name}`,
    artist: 'Artist',
    title: name,
    durationMs: 180000,
    thumbnailPath: null,
    mp3Path: `/library/${name}/song.mp3`,
    videoPath: null,
    bpm: 120,
    gap: 0,
    hasVideo: false,
    hasCover: false,
    isDuet: false,
    isPlayable: playable,
    addedAt: 1,
  }
}

const A = song('a')
const B = song('b')
const C = song('c')
const D = song('d')

function order(overrides: Partial<JukeboxPlayOrder> = {}): JukeboxPlayOrder {
  return { current: A, queue: [], history: [], cycle: [A], shuffle: false, repeat: 'off', autoplay: false, ...overrides }
}

/** A deterministic "random": always the first candidate, and shuffles that leave the order alone. */
const first = () => 0

describe('nextStep', () => {
  it('plays the queue in order', () => {
    expect(nextStep(order({ queue: [B, C] }), { ended: true, pool: [] })).toMatchObject({
      kind: 'play',
      song: B,
      queue: [C],
      replay: false,
      autoplayed: false,
    })
  })

  it('Repeat one plays the song again when it ends, but a skip still moves on', () => {
    const repeatOne = order({ queue: [B], repeat: 'one' })
    expect(nextStep(repeatOne, { ended: true, pool: [] })).toMatchObject({ kind: 'play', song: A, queue: [B], replay: true })
    expect(nextStep(repeatOne, { ended: false, pool: [] })).toMatchObject({ kind: 'play', song: B, queue: [], replay: false })
  })

  it('Repeat all loops everything played this cycle once the queue runs out', () => {
    const step = nextStep(order({ current: C, cycle: [A, B, C], repeat: 'all', autoplay: true }), { ended: true, pool: [D] })
    expect(step).toMatchObject({ kind: 'play', song: A, queue: [B, C], cycle: [], autoplayed: false })
  })

  it('Repeat all with shuffle on plays the loop in a shuffled order', () => {
    // random() = 0 swaps every slot with the first: [a, b, c] -> [c, b, a] -> [b, c, a].
    const step = nextStep(order({ current: C, cycle: [A, B, C], repeat: 'all', shuffle: true }), {
      ended: true,
      pool: [],
      random: first,
    })
    expect(step).toMatchObject({ kind: 'play', song: B, queue: [C, A] })
  })

  it('autoplay picks a random playable song the library has not just played', () => {
    const step = nextStep(order({ current: B, history: [A], autoplay: true }), {
      ended: true,
      pool: [A, B, song('broken', false), C],
      random: first,
    })
    expect(step).toMatchObject({ kind: 'play', song: C, queue: [], autoplayed: true })
  })

  it('is finished when the queue is empty, Repeat is off and autoplay is off', () => {
    expect(nextStep(order(), { ended: true, pool: [B, C] })).toEqual({ kind: 'finished' })
  })

  it('is finished when autoplay has nothing playable to pick', () => {
    expect(nextStep(order({ autoplay: true }), { ended: true, pool: [song('broken', false)] })).toEqual({ kind: 'finished' })
  })

  it('from the list (no current song) starts the queue', () => {
    expect(nextStep(order({ current: null, cycle: [], queue: [C] }), { ended: false, pool: [] })).toMatchObject({
      kind: 'play',
      song: C,
    })
  })
})

describe('previousStep', () => {
  it('restarts the song once it is more than three seconds in', () => {
    expect(previousStep(order({ history: [B] }), 3.5)).toEqual({ kind: 'restart' })
  })

  it('goes back one song in the first three seconds, putting the current one back on the queue', () => {
    expect(previousStep(order({ history: [C, B], queue: [D] }), 1)).toEqual({
      kind: 'play',
      song: B,
      queue: [A, D],
      history: [C],
    })
  })

  it('restarts when there is nothing before it', () => {
    expect(previousStep(order(), 0)).toEqual({ kind: 'restart' })
  })
})

describe('queue helpers', () => {
  it('moves a queued song up and down, ignoring moves off either end', () => {
    expect(moveQueueItem([A, B, C], 2, -1)).toEqual([A, C, B])
    expect(moveQueueItem([A, B, C], 0, 1)).toEqual([B, A, C])
    expect(moveQueueItem([A, B, C], 0, -1)).toEqual([A, B, C])
    expect(moveQueueItem([A, B, C], 2, 1)).toEqual([A, B, C])
  })

  it('steps Repeat off -> all -> one -> off', () => {
    expect(nextRepeat('off')).toBe('all')
    expect(nextRepeat('all')).toBe('one')
    expect(nextRepeat('one')).toBe('off')
  })

  it('caps the history and keeps the cycle distinct', () => {
    const long = Array.from({ length: HISTORY_LIMIT }, (_, i) => song(`s${i}`))
    const next = withHistory(long, A)
    expect(next).toHaveLength(HISTORY_LIMIT)
    expect(next.at(-1)).toBe(A)
    expect(withHistory([B], null)).toEqual([B])
    expect(withCycle([A, B], A)).toEqual([A, B])
    expect(withCycle([A], B)).toEqual([A, B])
  })

  it('autoplay falls back to anything but the current song, then to the current song itself', () => {
    expect(pickRandomSong([A, B], [A, B], A, first)).toBe(B)
    expect(pickRandomSong([A], [], A, first)).toBe(A)
    expect(pickRandomSong([], [], A, first)).toBeNull()
  })

  it('formats playback times', () => {
    expect(formatPlaybackTime(0)).toBe('0:00')
    expect(formatPlaybackTime(72.9)).toBe('1:12')
    expect(formatPlaybackTime(3725)).toBe('1:02:05')
    expect(formatPlaybackTime(Number.NaN)).toBe('0:00')
  })
})
