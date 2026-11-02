import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CROWN_BOX_UNITS, CROWN_IMAGE_URL } from '../resultsAssets'

/**
 * The crown is a file somebody can overwrite.
 *
 * It is `assets/ui/crown.png`, a Vite static import like the sounds in
 * `assets/sfx/`; these tests keep "drop a new file in, no code change" true.
 *
 * Vitest runs from the repo root (vite.config's `root`), so the tree is located
 * from the working directory rather than from `import.meta.url`, which is not a
 * file: URL under the jsdom environment.
 */
const CROWN_PATH = join(process.cwd(), 'assets', 'ui', 'crown.png')

/** width, height and colour type out of a PNG's IHDR chunk. */
function readPngHeader(bytes: Buffer) {
  const signature = bytes.subarray(0, 8).toString('hex')
  return {
    signature,
    chunk: bytes.subarray(12, 16).toString('ascii'),
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colourType: bytes[25],
  }
}

describe('the crown asset', () => {
  it('is imported from assets/ui/, so swapping the file needs no code change', () => {
    expect(CROWN_IMAGE_URL).toContain('crown')
    expect(CROWN_IMAGE_URL).toMatch(/\.png(\?|$)/)
  })

  it('actually exists on disk at the path the README tells people to overwrite', () => {
    expect(existsSync(CROWN_PATH)).toBe(true)
  })

  // A crown over an avatar with an opaque background is a visible rectangle on
  // the one element the whole room is looking at.
  it('is a real PNG with an alpha channel', () => {
    const header = readPngHeader(readFileSync(CROWN_PATH))

    expect(header.signature).toBe('89504e470d0a1a0a')
    expect(header.chunk).toBe('IHDR')
    // 6 = truecolour with alpha; 4 = greyscale with alpha. Anything else has no
    // transparency at all.
    expect([4, 6]).toContain(header.colourType)
    expect(header.bitDepth).toBeGreaterThanOrEqual(8)
  })

  /**
   * Resolution, against the display it has to survive.
   *
   * The crown is drawn at 86 design units wide -- 86 px at 1080p, 172 px at 4K,
   * and briefly more during the impact squash. The placeholder is 864 px, which
   * is 5x the 4K size; the floor here is 2x it, below which the artwork visibly
   * softens on a television.
   */
  it('carries enough pixels for a 4K display', () => {
    const header = readPngHeader(readFileSync(CROWN_PATH))
    const fourKWidthPx = CROWN_BOX_UNITS.width * 2

    expect(header.width).toBeGreaterThanOrEqual(fourKWidthPx * 2)
    expect(header.height).toBeGreaterThan(0)
  })

  // The landing animation is positioned and timed against this box (the crown
  // falls to `top: du(-44)` relative to the winner's badge), so it is the one
  // thing about the crown a replacement file cannot change.
  it('keeps the SVG’s own 86x60 unit box, which the landing animation is timed against', () => {
    expect(CROWN_BOX_UNITS).toEqual({ width: 86, height: 60 })
  })
})
