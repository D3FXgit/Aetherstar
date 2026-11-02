/**
 * The canvas/DOM half of dominant-colour extraction, kept to one function so
 * it can be swapped out wholesale in tests.
 *
 * Two reasons this is a seam rather than inline code:
 *
 * 1. jsdom implements neither `createImageBitmap` nor
 *    `HTMLCanvasElement#getContext` (the suite already prints "Not
 *    implemented" for the latter), so nothing below can run under test. The
 *    codebase's established answer to that is an injectable factory -- see
 *    `webAudioApi.ts`'s `createAudioContext`, injected into
 *    `createWebAudioManager` -- and this follows it.
 * 2. Everything worth asserting about extraction is arithmetic over pixels,
 *    and that lives in `dominantColor.ts` where it needs no environment at
 *    all. What is left here is glue: fetch bytes, decode, scale, read back.
 *
 * Why `fetch` + `createImageBitmap` rather than an `<img>` drawn to a canvas:
 * covers are served over the privileged `aetherstar-media://` scheme, a
 * different origin from the app. An `<img>` from another origin taints the
 * canvas and makes `getImageData` throw `SecurityError`. A blob decoded via
 * `createImageBitmap` carries no origin, so the canvas stays clean. (The
 * `SecurityError` path is still handled -- see the catch -- because being
 * wrong about this must degrade the gradient, not break the transition.)
 */

/**
 * Edge length the cover is downscaled to before sampling: 32x32 = 1024 pixels.
 * A dominant colour is a low-frequency property of an image, so more pixels
 * buy nothing but latency on a screen that is on the critical path to
 * gameplay; the GPU-side downscale also pre-averages away compression noise.
 */
export const COVER_SAMPLE_SIZE = 32

/** Injectable: `src` -> RGBA bytes, or null if the image cannot be read for any reason. */
export type ImagePixelSampler = (src: string) => Promise<Uint8ClampedArray | null>

/**
 * The real sampler. Never rejects and never throws: a missing cover, a 404, a
 * corrupt file, a runtime without `createImageBitmap`, or a tainted canvas all
 * resolve to null, which the caller reads as "keep the default gradient".
 */
export const sampleImagePixels: ImagePixelSampler = async (src) => {
  try {
    if (typeof createImageBitmap !== 'function') return null

    const response = await fetch(src)
    if (!response.ok) return null

    const bitmap = await createImageBitmap(await response.blob(), {
      resizeWidth: COVER_SAMPLE_SIZE,
      resizeHeight: COVER_SAMPLE_SIZE,
      resizeQuality: 'low',
    })

    try {
      const canvas = document.createElement('canvas')
      canvas.width = COVER_SAMPLE_SIZE
      canvas.height = COVER_SAMPLE_SIZE

      // Null in jsdom, and in any renderer that has exhausted its canvas budget.
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return null

      context.drawImage(bitmap, 0, 0, COVER_SAMPLE_SIZE, COVER_SAMPLE_SIZE)
      return context.getImageData(0, 0, COVER_SAMPLE_SIZE, COVER_SAMPLE_SIZE).data
    } finally {
      bitmap.close?.()
    }
  } catch {
    return null
  }
}
