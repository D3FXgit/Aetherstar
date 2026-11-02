import { describe, expect, it } from 'vitest'
import { designUnitScale } from '../../scenes/designUnits'
import {
  CARD_INFO_HEIGHT,
  GALLERY_MIN_HEIGHT,
  fitGalleryCard,
  galleryCardWidth,
} from '../partyDraw/galleryLayout'

const REM = 16

/**
 * The band the gallery gets at a window size: the window minus the frame's
 * padding, the header, the singers strip (one row of slot cards), the songs
 * heading and the footer -- each `max(rem floor, n u)` as the components
 * declare them -- minus the band's own padding. A model of the layout, not a
 * measurement, but it is the same sum the components state.
 */
function bandFor(viewportWidth: number, viewportHeight: number) {
  const u = designUnitScale(viewportWidth, viewportHeight)
  const pad = Math.max(14, 18 * u)
  const header = Math.max(54 * u, 2.75 * REM + 10 * u)
  const singers = Math.max(54 * u, 2.75 * REM + 10 * u) + 12 * u + Math.max(117 * u, 82)
  const songsHeading = Math.max(29 * u, REM * 1.02) + 4 * u
  const footer = Math.max(62 * u, 2.75 * REM)
  const frameGaps = 3 * 24 * u
  const frameInsetY = (36 + 32) * u
  const height = viewportHeight - frameInsetY - header - singers - songsHeading - footer - frameGaps - 2 * pad
  const width = viewportWidth - 2 * 64 * u - 2 * pad
  return {
    u,
    width,
    height,
    gap: 28 * u,
    infoHeight: Math.max(7 * REM, 146 * u),
    minCard: 7 * REM,
    maxCard: 620 * u,
  }
}

const VIEWPORTS: [number, number][] = [
  [1024, 640],
  [1280, 720],
  [1366, 768],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
]

describe('party gallery geometry', () => {
  it('sizes the card from both axes of the band, never from width alone', () => {
    const css = galleryCardWidth(3)
    expect(css).toContain('100cqw')
    expect(css).toContain('100cqh')
    expect(css).toContain(CARD_INFO_HEIGHT)
    // One card does not subtract any gaps.
    expect(galleryCardWidth(1)).toContain('min(100cqw,')
  })

  it.each(VIEWPORTS)('fits three whole cards, cover and caption, at %ix%i', (width, height) => {
    const band = bandFor(width, height)
    const fit = fitGalleryCard({ ...band, count: 3 })

    expect(fit.cardHeight).toBeLessThanOrEqual(band.height + 0.5)
    expect(fit.rowWidth).toBeLessThanOrEqual(band.width + 0.5)
    // Still a cover you can recognise from the sofa.
    expect(fit.cardWidth).toBeGreaterThanOrEqual(140)
  })

  it('gives a 1080p screen covers several times the old minimum, without overflowing', () => {
    const band = bandFor(1920, 1080)
    const fit = fitGalleryCard({ ...band, count: 3 })
    expect(fit.cardWidth).toBeGreaterThan(350)

    // The regression: a third of the width as a square, plus the caption,
    // was taller than the band -- the bottom of every cover was cut off.
    const oldCover = (band.width - 2 * 24) / 3
    expect(oldCover + band.infoHeight).toBeGreaterThan(band.height)
  })

  it('scales with the display: a 4K cover is about twice a 1080p one', () => {
    const hd = fitGalleryCard({ ...bandFor(1920, 1080), count: 3 })
    const uhd = fitGalleryCard({ ...bandFor(3840, 2160), count: 3 })
    expect(uhd.cardWidth / hd.cardWidth).toBeGreaterThan(1.8)
    expect(uhd.cardWidth / hd.cardWidth).toBeLessThan(2.2)
  })

  it('keeps a floor below which the band scrolls instead of shrinking the cover to nothing', () => {
    const fit = fitGalleryCard({ width: 300, height: 120, count: 3, gap: 20, infoHeight: 112, minCard: 112, maxCard: 600 })
    expect(fit.cardWidth).toBe(112)
    expect(GALLERY_MIN_HEIGHT).toContain(CARD_INFO_HEIGHT)
  })
})
