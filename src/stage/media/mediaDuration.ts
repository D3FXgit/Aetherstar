// How long a media element's source is, in seconds, or null while that is
// genuinely unknown.
//
// `HTMLMediaElement.duration` is NaN until `loadedmetadata`, and Infinity when
// Chromium treats the source as a stream -- which is what a WAV served through
// the app-media:// protocol can come back as. Neither is a length, so both fall
// through to what the element does know: how far it can seek, or (once the
// whole file is in) how far it has buffered.

type DurationSource = Pick<HTMLMediaElement, 'duration' | 'seekable' | 'buffered' | 'networkState'>

function isLength(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function lastRangeEnd(ranges: TimeRanges | null | undefined): number | null {
  try {
    if (!ranges || ranges.length === 0) return null
    const end = ranges.end(ranges.length - 1)
    return isLength(end) ? end : null
  } catch {
    return null
  }
}

/** The element's length in seconds, or null while it is unknown (no metadata yet, or a stream with no end). */
export function mediaDurationSec(element: DurationSource | null | undefined): number | null {
  if (!element) return null
  if (isLength(element.duration)) return element.duration
  const seekableEnd = lastRangeEnd(element.seekable)
  if (seekableEnd !== null) return seekableEnd
  // A stream-like source that has finished downloading: what is buffered is
  // the whole file. While it is still loading, the buffered end is only how
  // far it got, not how long the song is.
  if (element.networkState === 1 /* NETWORK_IDLE */) {
    const buffered = element.buffered
    if (buffered && buffered.length === 1) {
      try {
        if (buffered.start(0) <= 0.5) return lastRangeEnd(buffered)
      } catch {
        return null
      }
    }
  }
  return null
}
