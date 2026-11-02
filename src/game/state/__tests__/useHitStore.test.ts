import { describe, expect, it, beforeEach } from 'vitest'
import { useHitStore } from '../useHitStore'
import type { HitEvent } from '../../../contracts/types'

const EVENT: HitEvent = { playerId: 'p1', tier: 'epic', noteId: 'note-0', deviationCents: 0, t: 1000 }

describe('useHitStore', () => {
  beforeEach(() => {
    useHitStore.getState().reset()
  })

  it('recordHit sets latest and appends to events', () => {
    useHitStore.getState().recordHit(EVENT)
    expect(useHitStore.getState().latest).toEqual(EVENT)
    expect(useHitStore.getState().events).toEqual([EVENT])
  })

  it('reset clears latest and events', () => {
    useHitStore.getState().recordHit(EVENT)
    useHitStore.getState().reset()
    expect(useHitStore.getState().latest).toBeNull()
    expect(useHitStore.getState().events).toEqual([])
  })
})
