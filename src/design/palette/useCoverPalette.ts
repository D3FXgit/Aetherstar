// Async, best-effort cover -> ambient palette. Returns null until (and unless)
// a usable colour comes back, so callers fall back with
// `palette ?? DEFAULT_AMBIENT_PALETTE`.
import { useEffect, useState } from 'react'
import { ambientPaletteFrom, dominantColorFromPixels, type AmbientPalette } from './dominantColor'
import { sampleImagePixels, type ImagePixelSampler } from './imagePixelSampler'

/**
 * @param coverUrl an already-resolved media URL, or undefined when the song has no cover.
 * @param sampler injectable pixel source -- the DOM/canvas seam (see `imagePixelSampler.ts`).
 */
export function useCoverPalette(
  coverUrl: string | undefined,
  sampler: ImagePixelSampler = sampleImagePixels,
): AmbientPalette | null {
  const [palette, setPalette] = useState<AmbientPalette | null>(null)

  useEffect(() => {
    setPalette(null)
    if (!coverUrl) return

    // `cancelled` rather than an AbortController: the work is a decode, not a
    // request we can meaningfully cancel, and the only thing that must not
    // happen is a setState after unmount. The transition is short-lived and
    // unmounts the instant the countdown ends, so this fires routinely.
    let cancelled = false

    void (async () => {
      // Defensive even though `sampleImagePixels` cannot reject: an injected
      // sampler might, and an unhandled rejection here would surface as a test
      // failure or a console error in the middle of gameplay.
      const pixels = await sampler(coverUrl).catch(() => null)
      if (cancelled || !pixels) return

      const dominant = dominantColorFromPixels(pixels)
      if (cancelled || !dominant) return

      setPalette(ambientPaletteFrom(dominant))
    })()

    return () => {
      cancelled = true
    }
  }, [coverUrl, sampler])

  return palette
}
