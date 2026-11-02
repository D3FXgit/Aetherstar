import { create } from 'zustand'
import type { HitEvent, PitchSample, ScoreState } from '../types'
import { generatePitchSample } from './pitch'
import { generateHitEvent } from './hit'
import { generateScoreTick } from './score'

const PITCH_TICK_MS = 100 // ~10 Hz, per the PitchSample contract's intent
const HIT_TICK_MS = 1000
const SCORE_TICK_MS = 1000

interface PitchStoreState {
  latest: PitchSample | null
  samples: PitchSample[]
  start: (deviceId: string) => void
  stop: () => void
}

export const usePitchStore = create<PitchStoreState>((set, get) => {
  let intervalId: ReturnType<typeof setInterval> | null = null
  let t = 0

  return {
    latest: null,
    samples: [],
    start: (deviceId: string) => {
      if (intervalId !== null) return
      intervalId = setInterval(() => {
        t += PITCH_TICK_MS
        const sample = generatePitchSample(get().latest, t, deviceId)
        set((state) => ({ latest: sample, samples: [...state.samples, sample] }))
      }, PITCH_TICK_MS)
    },
    stop: () => {
      if (intervalId === null) return
      clearInterval(intervalId)
      intervalId = null
      t = 0
      set({ latest: null, samples: [] })
    },
  }
})

interface HitStoreState {
  latest: HitEvent | null
  events: HitEvent[]
  start: (playerId: string) => void
  stop: () => void
}

export const useHitStore = create<HitStoreState>((set) => {
  let intervalId: ReturnType<typeof setInterval> | null = null
  let t = 0

  return {
    latest: null,
    events: [],
    start: (playerId: string) => {
      if (intervalId !== null) return
      intervalId = setInterval(() => {
        t += HIT_TICK_MS
        const event = generateHitEvent(t, playerId)
        set((state) => ({ latest: event, events: [...state.events, event] }))
      }, HIT_TICK_MS)
    },
    stop: () => {
      if (intervalId === null) return
      clearInterval(intervalId)
      intervalId = null
      t = 0
      set({ latest: null, events: [] })
    },
  }
})

interface ScoreStoreState extends ScoreState {
  start: (seed: ScoreState) => void
  stop: () => void
}

const EMPTY_SCORE_STATE: ScoreState = { players: [], combo: 0, rank: [] }

export const useScoreStore = create<ScoreStoreState>((set, get) => {
  let intervalId: ReturnType<typeof setInterval> | null = null

  return {
    ...EMPTY_SCORE_STATE,
    start: (seed: ScoreState) => {
      if (intervalId !== null) return
      set(seed)
      intervalId = setInterval(() => {
        const { start: _start, stop: _stop, ...current } = get()
        set(generateScoreTick(current))
      }, SCORE_TICK_MS)
    },
    stop: () => {
      if (intervalId === null) return
      clearInterval(intervalId)
      intervalId = null
      set(EMPTY_SCORE_STATE)
    },
  }
})
