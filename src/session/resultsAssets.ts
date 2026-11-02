// Static assets for the results celebration, bundled by Vite like assets/sfx/.
// To swap the crown, replace assets/ui/crown.png (see assets/ui/README.md).
import crownUrl from '../../assets/ui/crown.png'

/** The crown that lands on the winner (beat 2). A file, so the artwork can be replaced without code. */
export const CROWN_IMAGE_URL: string = crownUrl

/**
 * The crown's box in design units (`du()`). The landing is aimed at it, so a
 * replacement image of another shape is fitted inside (`object-fit: contain`).
 */
export const CROWN_BOX_UNITS = { width: 86, height: 60 } as const
