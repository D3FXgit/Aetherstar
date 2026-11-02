/**
 * Pre-warms audio and media elements in memory so Chromium reads and caches
 * the first chunks before Stage mounts, eliminating playback hitching.
 */
export function prefetchAudio(url: string | null | undefined): Promise<void> {
  if (!url || typeof Audio === "undefined") return Promise.resolve()

  return new Promise((resolve) => {
    try {
      const audio = new Audio()
      audio.preload = "auto"
      let settled = false

      const done = () => {
        if (settled) return
        settled = true
        audio.removeEventListener("canplaythrough", done)
        audio.removeEventListener("canplay", done)
        audio.removeEventListener("error", done)
        resolve()
      }

      audio.addEventListener("canplaythrough", done, { once: true })
      audio.addEventListener("canplay", done, { once: true })
      audio.addEventListener("error", done, { once: true })
      audio.src = url
      audio.load()

      // Safety timeout: never block longer than 2.5 seconds
      setTimeout(done, 2500)
    } catch {
      resolve()
    }
  })
}
