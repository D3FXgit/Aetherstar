const NATIVELY_PLAYABLE_EXTENSIONS = ['.mp4', '.webm']

/** Whether Chromium's <video> can decode this file natively -- anything else falls back to the ambient audio-only path (never transcoded). */
export function isNativelyPlayableVideo(path: string | undefined): boolean {
  if (!path) return false
  const lowerPath = path.toLowerCase()
  return NATIVELY_PLAYABLE_EXTENSIONS.some((extension) => lowerPath.endsWith(extension))
}
