/**
 * Every line starts with `[AetherStar`, so one grep captures the song-load
 * trace and any crash in order (how far a load got, not just that it failed).
 * Console-only on purpose: it must work in a packaged build with just DevTools.
 */
export const CRASH_PREFIX = '[AetherStar crash]'
export const SONGLOAD_PREFIX = '[AetherStar songload]'

/** Normalizes anything throwable/rejectable (strings, DOM events, plain objects) into a real Error. */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'string') return new Error(value)
  try {
    // `JSON.stringify(undefined)` is `undefined`, which would leave the Error
    // with an empty message.
    return new Error(JSON.stringify(value) ?? String(value))
  } catch {
    return new Error(String(value))
  }
}

/**
 * The single crash channel: render-phase throws caught by ErrorBoundary,
 * unhandled promise rejections, and failed song-load steps all land here so
 * they look identical in the log.
 */
export function logCrash(where: string, error: unknown, details: Record<string, unknown> = {}): void {
  const normalized = toError(error)
  console.error(`${CRASH_PREFIX} ${where}: ${normalized.message}`, {
    ...details,
    error: normalized,
    stack: normalized.stack,
  })
}

/** One step of the song-load sequence completed. */
export function logSongLoad(step: string, details: Record<string, unknown> = {}): void {
  console.info(`${SONGLOAD_PREFIX} ${step}`, details)
}

/** One step of the song-load sequence failed -- same crash channel, tagged with the step it died on. */
export function logSongLoadError(step: string, error: unknown, details: Record<string, unknown> = {}): void {
  logCrash(`songload/${step}`, error, details)
}
