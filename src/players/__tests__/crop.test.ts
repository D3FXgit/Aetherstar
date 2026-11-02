import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cropImageToDataUrl } from '../crop'

class FakeImage {
  onload: (() => void) | null = null
  src = ''
  width = 800
  height = 600
  constructor() {
    setTimeout(() => this.onload?.(), 0)
  }
}

describe('cropImageToDataUrl', () => {
  let drawImageCalls: unknown[][]
  let translateCalls: unknown[][]
  let rotateCalls: unknown[][]
  let canvas: HTMLCanvasElement

  beforeEach(() => {
    drawImageCalls = []
    translateCalls = []
    rotateCalls = []
    vi.stubGlobal('Image', FakeImage)

    canvas = document.createElement('canvas')
    const fakeCtx = {
      translate: (...args: unknown[]) => translateCalls.push(args),
      rotate: (...args: unknown[]) => rotateCalls.push(args),
      drawImage: (...args: unknown[]) => drawImageCalls.push(args),
      save: () => {},
      restore: () => {},
    }
    // Cast through the spy's own inferred return type, not a fixed
    // `CanvasRenderingContext2D`: pixi.js pulls in @webgpu/types,
    // which globally augments HTMLCanvasElement.getContext()'s overloads with
    // a 'webgpu' mode, widening what vi.spyOn infers here.
    vi.spyOn(canvas, 'getContext').mockReturnValue(fakeCtx as unknown as ReturnType<typeof canvas.getContext>)
    vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/jpeg;base64,cropped')
    vi.spyOn(document, 'createElement').mockReturnValue(canvas)
  })

  it('sizes the canvas to the requested output size and draws the crop-box region into it', async () => {
    const cropAreaPixels = { x: 50, y: 20, width: 300, height: 300 }

    const result = await cropImageToDataUrl('data:image/jpeg;base64,source', cropAreaPixels, 0, 256)

    expect(canvas.width).toBe(256)
    expect(canvas.height).toBe(256)
    expect(drawImageCalls[0]).toEqual([
      expect.anything(),
      cropAreaPixels.x,
      cropAreaPixels.y,
      cropAreaPixels.width,
      cropAreaPixels.height,
      0,
      0,
      256,
      256,
    ])
    expect(result).toBe('data:image/jpeg;base64,cropped')
  })

  it('applies a translate+rotate around the canvas center for a non-zero rotation', async () => {
    const cropAreaPixels = { x: 0, y: 0, width: 100, height: 100 }

    await cropImageToDataUrl('data:image/jpeg;base64,source', cropAreaPixels, 90, 128)

    expect(translateCalls[0]).toEqual([64, 64])
    expect(rotateCalls[0]).toEqual([(90 * Math.PI) / 180])
  })
})
