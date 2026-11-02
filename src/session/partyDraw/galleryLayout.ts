/**
 * Geometry for the party draw's song gallery.
 *
 * The old cards were `grid-cols-3` squares as wide as a third of the screen
 * with the caption stacked under them, so their height followed the *width*:
 * at 1920x1080 a ~560px cover plus its caption needed more room than the
 * screen had left under the singers, and the bottom of every cover was cut
 * off. Here a card is sized from both axes of the band it actually gets:
 *
 *   card width = cover edge = min(column width, band height - caption height)
 *
 * The band is a size container (`container-type: size`, flex-1 + min-h-0), so
 * `100cqw` / `100cqh` are whatever is left after the header, singers and
 * footer at any window size, and the caption has a fixed height in design
 * units with a rem floor -- so `cover + caption` can never exceed the band.
 * No measuring, no first-frame jump. `fitGalleryCard` restates the same sum in
 * numbers so the fit can be asserted without a layout engine.
 */
import { du } from '../../scenes/designUnits'

/** Gap between two cards. */
export const GALLERY_GAP = du(28)

/**
 * Air inside the band on every side, outside the `cq` sizes: room for the
 * selected card's ring (5u), its 2% hover lift, and the 6px couch focus outline,
 * none of which may be clipped by the band's scrollport.
 */
export const GALLERY_PADDING = `max(14px, ${du(18)})`

/**
 * The caption under the cover: title, artist, a chip row and the record line,
 * each a single clamped line. Summed from their line boxes at 1080p (~137u)
 * and at the smallest design unit, where the rem floors win (~105px).
 */
export const CARD_INFO_HEIGHT = `max(7rem, ${du(146)})`

/** Below this a cover stops reading as a cover; the band scrolls rather than shrinking further. */
export const MIN_CARD_WIDTH = '7rem'

/** A cap so an ultrawide or 8K panel does not get posters. */
export const MAX_CARD_WIDTH = du(620)

/** The card (= cover) width as CSS, for `count` cards in one row. */
export function galleryCardWidth(count: number): string {
  const n = Math.max(1, Math.round(count))
  const byWidth = n === 1 ? '100cqw' : `calc((100cqw - ${n - 1} * ${GALLERY_GAP}) / ${n})`
  const byHeight = `calc(100cqh - ${CARD_INFO_HEIGHT})`
  return `max(${MIN_CARD_WIDTH}, min(${byWidth}, ${byHeight}, ${MAX_CARD_WIDTH}))`
}

export interface GalleryFitInput {
  /** The band's content box, in px. */
  width: number
  height: number
  count: number
  /** Resolved px values of the constants above, for one viewport. */
  gap: number
  infoHeight: number
  minCard: number
  maxCard: number
}

export interface GalleryFit {
  /** Card width, which is also the cover's edge. */
  cardWidth: number
  cardHeight: number
  /** Whole row, gaps included. */
  rowWidth: number
}

/** `galleryCardWidth` in numbers. */
export function fitGalleryCard({ width, height, count, gap, infoHeight, minCard, maxCard }: GalleryFitInput): GalleryFit {
  const n = Math.max(1, Math.round(count))
  const byWidth = (width - (n - 1) * gap) / n
  const byHeight = height - infoHeight
  const cardWidth = Math.max(minCard, Math.min(byWidth, byHeight, maxCard))
  return { cardWidth, cardHeight: cardWidth + infoHeight, rowWidth: n * cardWidth + (n - 1) * gap }
}

/**
 * The least height the band keeps for itself: one minimum card plus its
 * padding. Below this it is the singers strip that gives way (and scrolls),
 * not the songs -- which is what the screen is for.
 */
export const GALLERY_MIN_HEIGHT = `calc(${MIN_CARD_WIDTH} + ${CARD_INFO_HEIGHT} + 2 * ${GALLERY_PADDING})`
