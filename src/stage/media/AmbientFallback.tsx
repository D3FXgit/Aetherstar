import { useState } from 'react'

interface AmbientFallbackProps {
  /** The chart's `#BACKGROUND` image: a still made to fill the screen. Tried first. */
  backgroundUrl?: string | null
  /** The cover art: blurred and slowly panned behind the lyrics when there is no background. */
  coverUrl: string | null
}

/**
 * Fills the screen with no color at all: a tinted gradient, not the shell's
 * near-black Backdrop (which is fixed behind everything and reads as "nothing
 * loaded"). Two faint accent glows, so a song with no picture still looks lit.
 */
const AMBIENT_GRADIENT = [
  'radial-gradient(ellipse 70% 60% at 18% 8%, oklch(0.42 0.14 300 / .55), transparent 70%)',
  'radial-gradient(ellipse 65% 55% at 85% 95%, oklch(0.42 0.12 200 / .45), transparent 70%)',
  'linear-gradient(160deg, #15111f 0%, #0b0a12 60%, #0d0b16 100%)',
].join(', ')

/**
 * What sits behind the lyrics when there is no video, or until (or instead of)
 * it plays. In order, whichever loads:
 *
 *   1. `#BACKGROUND` -- full screen, darkened so the lyrics stay readable;
 *   2. the cover -- blurred, panned (Ken Burns) and darkened;
 *   3. the ambient gradient.
 *
 * Each image that fails to load hands over to the next, so a stale tag never
 * leaves the stage black.
 */
export function AmbientFallback({ backgroundUrl = null, coverUrl }: AmbientFallbackProps) {
  // Remembered per URL, so a new song's images get their own chance.
  const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(() => new Set())
  const markFailed = (url: string) => setFailedUrls((previous) => new Set(previous).add(url))

  const showBackground = Boolean(backgroundUrl) && !failedUrls.has(backgroundUrl!)
  const showCover = !showBackground && Boolean(coverUrl) && !failedUrls.has(coverUrl!)

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: AMBIENT_GRADIENT }}>
      {showBackground ? (
        <>
          <img
            data-testid="stage-ambient-background"
            src={backgroundUrl!}
            alt=""
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => markFailed(backgroundUrl!)}
          />
          {/* Darker toward the bottom, where the lyrics are. */}
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,.25), rgba(0,0,0,.35) 45%, rgba(0,0,0,.7))' }}
          />
        </>
      ) : showCover ? (
        <>
          <img
            data-testid="stage-ambient-cover"
            src={coverUrl!}
            alt=""
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover blur-2xl scale-110 animate-[ken-burns_24s_ease-in-out_infinite_alternate]"
            onError={() => markFailed(coverUrl!)}
          />
          <div className="absolute inset-0 bg-black/45" />
        </>
      ) : (
        <div data-testid="stage-ambient-gradient" className="absolute inset-0" />
      )}
    </div>
  )
}
