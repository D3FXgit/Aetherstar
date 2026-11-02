export interface BudgetState {
  maxParticles: number
}

const FRAME_BUDGET_MS = 1000 / 60
const FLOOR_PARTICLES = 20
const CEILING_PARTICLES = 200
const STEP_DOWN = 20
const STEP_UP = 10
const REDUCE_EFFECTS_CAP = 30

/** Steps the particle budget down when frames run over the 60fps threshold, back up when there's headroom. */
export function nextBudget(state: BudgetState, frameTimeMs: number, reduceEffects: boolean): BudgetState {
  if (reduceEffects) {
    return { maxParticles: Math.min(state.maxParticles, REDUCE_EFFECTS_CAP) }
  }

  if (frameTimeMs > FRAME_BUDGET_MS) {
    return { maxParticles: Math.max(FLOOR_PARTICLES, state.maxParticles - STEP_DOWN) }
  }

  return { maxParticles: Math.min(CEILING_PARTICLES, state.maxParticles + STEP_UP) }
}
