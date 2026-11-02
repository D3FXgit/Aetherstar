import { describe, expect, it } from 'vitest'
import { nextBudget } from '../particleBudget'

const OVER_BUDGET_FRAME_MS = 25 // well past the 16.7ms/60fps threshold
const UNDER_BUDGET_FRAME_MS = 8

describe('nextBudget', () => {
  it('steps down under sustained over-budget frame times, down to a floor', () => {
    let state = { maxParticles: 200 }
    for (let i = 0; i < 50; i++) {
      state = nextBudget(state, OVER_BUDGET_FRAME_MS, false)
    }
    expect(state.maxParticles).toBeLessThan(200)
    const floor = state.maxParticles
    state = nextBudget(state, OVER_BUDGET_FRAME_MS, false)
    expect(state.maxParticles).toBeGreaterThanOrEqual(1)
    expect(state.maxParticles).toBeLessThanOrEqual(floor)
  })

  it('recovers back up under sustained headroom, up to a ceiling', () => {
    let state = { maxParticles: 10 }
    for (let i = 0; i < 50; i++) {
      state = nextBudget(state, UNDER_BUDGET_FRAME_MS, false)
    }
    expect(state.maxParticles).toBeGreaterThan(10)
    const ceiling = state.maxParticles
    state = nextBudget(state, UNDER_BUDGET_FRAME_MS, false)
    expect(state.maxParticles).toBeLessThanOrEqual(ceiling)
  })

  it('clamps to a low value regardless of frame time when reduceEffects is true', () => {
    const state = nextBudget({ maxParticles: 200 }, UNDER_BUDGET_FRAME_MS, true)
    expect(state.maxParticles).toBeLessThan(50)
  })
})
