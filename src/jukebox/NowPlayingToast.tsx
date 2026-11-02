// "Now playing": cover, title, artist and edition, shown for a few seconds as a
// song starts, then out of the way. Glass, because it floats over the video.
import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useT } from '../i18n'
import { Panel } from '../design/primitives/GlassPanel'
import { springTransition } from '../design/tokens'
import type { LibrarySong } from '../library/types'
import { SongThumb } from './SongThumb'
import { songByline } from './queueLogic'

/** How long the card stays up at the start of a song. */
export const NOW_PLAYING_MS = 5000

/** Mounted per play (keyed by the caller), so every song gets its own few seconds. */
export function NowPlayingToast({ song }: { song: LibrarySong }) {
  const t = useT()
  const reduceMotion = useReducedMotion() ?? false
  const [shown, setShown] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setShown(false), NOW_PLAYING_MS)
    return () => clearTimeout(timer)
  }, [])

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          className="pointer-events-none absolute left-[clamp(1rem,2.5vw,3rem)] top-[clamp(1rem,2.5vw,2.5rem)] z-20 max-w-[min(34rem,60vw)]"
          initial={reduceMotion ? false : { opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16 }}
          transition={springTransition('panelEnter', reduceMotion)}
        >
          <Panel
            variant="glass"
            role="status"
            data-testid="jukebox-now-playing"
            className="flex items-center gap-5 rounded-3xl px-5 py-4 shadow-2xl"
          >
            <SongThumb song={song} className="size-20" />
            <div className="min-w-0">
              <div className="text-base font-semibold text-ink-tertiary">{t('jukebox.nowPlaying')}</div>
              <div className="truncate text-2xl font-bold text-ink-primary">{song.title}</div>
              <div className="truncate text-lg font-medium text-ink-secondary">{songByline(song)}</div>
            </div>
          </Panel>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
