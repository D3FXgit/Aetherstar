import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { FxCanvas, type FxCanvasHandle } from '../FxCanvas'

const initMock = vi.fn().mockResolvedValue(undefined)
const destroyMock = vi.fn()
const addChildMock = vi.fn()

vi.mock('pixi.js', () => {
  class FakeApplication {
    canvas = document.createElement('canvas')
    stage = { addChild: addChildMock }
    init = initMock
    destroy = destroyMock
  }
  class FakeParticleContainer {
    addChild = vi.fn()
  }
  return { Application: FakeApplication, ParticleContainer: FakeParticleContainer }
})

describe('FxCanvas', () => {
  beforeEach(() => {
    initMock.mockClear()
    destroyMock.mockClear()
    addChildMock.mockClear()
  })

  it('creates and initializes exactly one Pixi Application on mount', async () => {
    render(<FxCanvas />)
    await waitFor(() => expect(initMock).toHaveBeenCalledTimes(1))
  })

  it('destroys the Application on unmount', async () => {
    const { unmount } = render(<FxCanvas />)
    await waitFor(() => expect(initMock).toHaveBeenCalledTimes(1))
    unmount()
    expect(destroyMock).toHaveBeenCalled()
  })

  it('trigger() acquires particles from the pool without throwing, even past exhaustion', async () => {
    const ref = createRef<FxCanvasHandle>()
    render(<FxCanvas ref={ref} />)
    await waitFor(() => expect(initMock).toHaveBeenCalledTimes(1))

    expect(() => ref.current!.trigger({ tier: 'epic' })).not.toThrow()
    // Firing many more bursts than the pool holds must still not throw (silent drop).
    for (let i = 0; i < 20; i++) {
      ref.current!.trigger({ tier: 'epic' })
    }
  })
})
