import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { PRESS_CLASS, PRESS_SCALE, pressMotion, usePressMotion } from '../motion'

const mocks = vi.hoisted(() => ({ reducedMotion: false }))

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return { ...actual, useReducedMotion: () => mocks.reducedMotion }
})

describe('press motion preset', () => {
  it('is subtle: a small lift on hover and a firm dip on press', () => {
    expect(PRESS_SCALE.hover).toBeLessThanOrEqual(1.03)
    expect(PRESS_SCALE.tap).toBeLessThan(1)
    expect(pressMotion.whileHover).toEqual({ scale: PRESS_SCALE.hover })
    expect(pressMotion.whileTap).toEqual({ scale: PRESS_SCALE.tap })
  })

  it('gives framer-motion elements the preset, and nothing under reduced motion', () => {
    mocks.reducedMotion = false
    expect(renderHook(() => usePressMotion()).result.current).toBe(pressMotion)
    mocks.reducedMotion = true
    expect(renderHook(() => usePressMotion()).result.current).toEqual({})
  })

  it('offers the same feel as classes, with the scale dropped under reduced motion', () => {
    expect(PRESS_CLASS).toContain(`hover:scale-[${PRESS_SCALE.hover}]`)
    expect(PRESS_CLASS).toContain(`active:scale-[${PRESS_SCALE.tap}]`)
    expect(PRESS_CLASS).toContain('motion-reduce:active:scale-100')
  })
})
