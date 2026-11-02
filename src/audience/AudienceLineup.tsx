import { AnimatePresence, motion } from 'framer-motion'
import { AudienceCover } from './AudienceCover'
import { AudienceSingerRow, AudienceSurface } from './AudienceSurface'
import { tokens } from '../design/tokens'
import { useT } from '../i18n'
import type { AudienceSinger, AudienceSong } from './types'

/**
 * Player selection as the room sees it: the song's cover in the middle, and
 * each singer arriving underneath with their mic number as the host picks them.
 *
 * Rows animate in and out because the moment someone is picked (or un-picked,
 * and the mic numbers shuffle down) is the whole point of this screen.
 */
export function AudienceLineup({ song, singers }: { song: AudienceSong | null; singers: AudienceSinger[] }) {
  const t = useT()

  return (
    <AudienceSurface testId="audience-lineup">
      <div className="flex h-full w-full flex-col items-center justify-center gap-[4vh] px-[6vw] py-[5vh]">
        {song ? (
          <AudienceCover song={song} />
        ) : (
          <p className="text-[clamp(1.25rem,2.4vw,2.5rem)] font-semibold text-ink-tertiary">
            {t('audience.lineup.choosingSong')}
          </p>
        )}

        {singers.length === 0 ? (
          <p data-testid="audience-lineup-waiting" className="text-[clamp(1.1rem,1.8vw,1.75rem)] font-semibold text-ink-tertiary">
            {t('audience.lineup.waiting')}
          </p>
        ) : (
          <ul data-testid="audience-lineup-list" className="flex w-full max-w-[52vw] min-w-[min(100%,28rem)] flex-col gap-3">
            <AnimatePresence initial={false}>
              {singers.map((singer) => (
                <motion.div
                  key={`${singer.micNumber}-${singer.name}`}
                  layout
                  initial={{ opacity: 0, y: 18, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.98 }}
                  transition={tokens.spring.panelEnter}
                >
                  <AudienceSingerRow singer={singer} testId="audience-lineup-singer" />
                </motion.div>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </AudienceSurface>
  )
}
