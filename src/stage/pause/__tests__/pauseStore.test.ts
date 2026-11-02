import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RESUME_LEAD_IN_SECONDS, isSongPaused, usePauseStore } from '../pauseStore'
import { useHitStore } from '../../../game/state/useHitStore'
import { useScoreStore } from '../../../game/state/useScoreStore'

describe('pauseStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    usePauseStore.getState().reset()
  })

  afterEach(() => {
    usePauseStore.getState().reset()
    vi.useRealTimers()
  })

  it('opens the menu from singing, and toggles back into the resume lead-in', () => {
    usePauseStore.getState().toggle()
    expect(usePauseStore.getState().phase).toBe('menu')
    expect(isSongPaused()).toBe(true)

    usePauseStore.getState().toggle()
    expect(usePauseStore.getState().phase).toBe('resuming')
    expect(usePauseStore.getState().resumeCountdown).toBe(RESUME_LEAD_IN_SECONDS)
  })

  it('counts 3, 2, 1 and only then lets the song run, marked as a resume', () => {
    usePauseStore.getState().pause()
    usePauseStore.getState().resume()

    vi.advanceTimersByTime(1000)
    expect(usePauseStore.getState().resumeCountdown).toBe(2)
    vi.advanceTimersByTime(1000)
    expect(usePauseStore.getState().resumeCountdown).toBe(1)
    expect(isSongPaused()).toBe(true)

    vi.advanceTimersByTime(1000)
    expect(usePauseStore.getState().phase).toBe('running')
    expect(usePauseStore.getState().lastTransition).toBe('resume')
    expect(usePauseStore.getState().resumeCountdown).toBeNull()
  })

  it('re-opens the menu if Back is pressed during the lead-in, and the old count never fires', () => {
    usePauseStore.getState().pause()
    usePauseStore.getState().resume()
    vi.advanceTimersByTime(1000)

    usePauseStore.getState().toggle()
    expect(usePauseStore.getState().phase).toBe('menu')
    vi.advanceTimersByTime(5000)
    expect(usePauseStore.getState().phase).toBe('menu')
  })

  it('restarts with fresh scores and hits, and a new restart token', () => {
    useScoreStore.getState().reset({ players: [{ playerId: 'p1', name: 'Alex', score: 4200, combo: 0, rank: 1 }], combo: 0, rank: ['p1'] })
    useHitStore.getState().recordHit({ playerId: 'p1', tier: 'epic', noteId: 'note-0', deviationCents: 0, t: 1 })
    const token = usePauseStore.getState().restartToken
    usePauseStore.getState().pause()

    usePauseStore.getState().restart()

    expect(usePauseStore.getState().phase).toBe('running')
    expect(usePauseStore.getState().lastTransition).toBe('restart')
    expect(usePauseStore.getState().restartToken).toBe(token + 1)
    expect(useScoreStore.getState().players).toEqual([expect.objectContaining({ playerId: 'p1', score: 0 })])
    expect(useHitStore.getState().events).toEqual([])
  })

  it('resets without a lead-in, and never counts that as a resume', () => {
    usePauseStore.getState().pause()
    usePauseStore.getState().reset()
    expect(usePauseStore.getState().phase).toBe('running')
    expect(usePauseStore.getState().lastTransition).toBe('reset')
  })
})
