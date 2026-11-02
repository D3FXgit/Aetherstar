// @vitest-environment node
// describe/expect/it come from Vitest's globals (vite.config.ts test.globals: true)
const { pickTargetDisplay } = require('../display-targeting.cjs')

const PRIMARY = { id: 1, isPrimary: true }
const SECONDARY = { id: 2, isPrimary: false }
const DISPLAYS = [PRIMARY, SECONDARY]

describe('pickTargetDisplay', () => {
  it('picks the first non-primary display when there is no persisted preference', () => {
    const result = pickTargetDisplay(DISPLAYS, 1, null)
    expect(result.display).toBe(SECONDARY)
    expect(result.isSingleDisplayFallback).toBe(false)
  })

  it('honors a persisted preference that still exists', () => {
    const result = pickTargetDisplay(DISPLAYS, 1, 2)
    expect(result.display).toBe(SECONDARY)
  })

  it('falls back to the first non-primary display when the persisted id no longer exists', () => {
    const result = pickTargetDisplay(DISPLAYS, 1, 99)
    expect(result.display).toBe(SECONDARY)
  })

  it('falls back to the primary display and signals single-display mode when only one display exists', () => {
    const result = pickTargetDisplay([PRIMARY], 1, null)
    expect(result.display).toBe(PRIMARY)
    expect(result.isSingleDisplayFallback).toBe(true)
  })
})
