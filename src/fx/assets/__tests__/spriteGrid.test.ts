import { describe, expect, it } from 'vitest'
import { computeGridFrames, parseGridFromFilename } from '../spriteGrid'

describe('parseGridFromFilename', () => {
  it('parses a cols x rows suffix', () => {
    expect(parseGridFromFilename('trail_neon_4x2.png')).toEqual({ cols: 4, rows: 2 })
  })

  it('returns null when there is no grid suffix', () => {
    expect(parseGridFromFilename('star_gold.png')).toBeNull()
  })
})

describe('computeGridFrames', () => {
  it('slices a texture into equal-sized frames at the correct origins', () => {
    const frames = computeGridFrames(2, 2, 256, 256)

    expect(frames).toEqual([
      { x: 0, y: 0, width: 128, height: 128 },
      { x: 128, y: 0, width: 128, height: 128 },
      { x: 0, y: 128, width: 128, height: 128 },
      { x: 128, y: 128, width: 128, height: 128 },
    ])
  })
})
