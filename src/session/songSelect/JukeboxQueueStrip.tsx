// The jukebox queue under the grid: what plays next, with remove, shuffle and play.
import { useT } from '../../i18n'
import { useSfx } from '../../audio/useSfx'
import type { LibrarySong } from '../../library/types'
import { useSessionStore } from '../sessionStore'
import { ACCENT_GOLD, FOCUS_OUTLINE_GUTTER, SURFACE, TEXT, u } from './layout'

const chipButtonClass = 'transition-colors duration-150 hover:bg-[var(--ae-surface-hover,#2a2638)]'

export function JukeboxQueueStrip({ shuffleSource }: { shuffleSource: LibrarySong[] }) {
  const t = useT()
  const playSfx = useSfx((state) => state.play)
  const queue = useSessionStore((state) => state.jukeboxQueue)

  const actionStyle = {
    padding: `${u(10)} ${u(18)}`,
    borderRadius: u(12),
    fontSize: u(17),
    fontWeight: 600,
    background: SURFACE.raised,
    border: `1px solid ${SURFACE.line}`,
    color: TEXT.primary,
    flexShrink: 0,
  }

  return (
    <section
      aria-label={t('songSelect.queue.title')}
      className="flex shrink-0 items-center"
      style={{
        marginTop: u(20),
        gap: u(14),
        padding: `${u(14)} ${u(22)}`,
        borderRadius: u(20),
        background: SURFACE.panel,
        border: `1px solid ${SURFACE.line}`,
      }}
      data-testid="jukebox-queue"
    >
      <span className="shrink-0" style={{ fontSize: u(18), fontWeight: 700, color: TEXT.primary }}>
        {t('songSelect.queue.title')}
      </span>
      <span className="shrink-0" style={{ fontSize: u(16), color: TEXT.tertiary }}>
        {t('songSelect.queue.count', { count: queue.length })}
      </span>
      <ol
        className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ gap: u(10), padding: FOCUS_OUTLINE_GUTTER }}
      >
        {queue.length === 0 ? (
          <li style={{ fontSize: u(17), color: TEXT.tertiary }}>{t('songSelect.queue.empty')}</li>
        ) : (
          queue.map((song, index) => (
            <li
              key={`${song.path}#${index}`}
              className="flex shrink-0 items-center"
              style={{ gap: u(8), padding: `${u(6)} ${u(6)} ${u(6)} ${u(14)}`, borderRadius: u(12), background: SURFACE.raised }}
              data-testid="jukebox-queue-item"
            >
              <span style={{ fontSize: u(15), fontWeight: 700, color: ACCENT_GOLD, fontVariantNumeric: 'tabular-nums' }}>
                {index + 1}
              </span>
              <span className="truncate" style={{ maxWidth: u(260), fontSize: u(17), color: TEXT.primary }}>
                {song.title}
              </span>
              <button
                type="button"
                aria-label={t('songSelect.queue.remove', { title: song.title })}
                onClick={() => {
                  playSfx('back')
                  useSessionStore.getState().removeFromJukeboxQueue(index)
                }}
                className={`flex items-center justify-center ${chipButtonClass}`}
                style={{ width: u(32), height: u(32), borderRadius: '999px', color: TEXT.secondary, fontSize: u(18) }}
              >
                ×
              </button>
            </li>
          ))
        )}
      </ol>
      <button
        type="button"
        onClick={() => {
          playSfx('click')
          useSessionStore.getState().shuffleIntoJukeboxQueue(shuffleSource)
        }}
        className={chipButtonClass}
        style={actionStyle}
      >
        {t('songSelect.queue.shuffleAll')}
      </button>
      {queue.length > 0 && (
        <button
          type="button"
          onClick={() => {
            playSfx('confirm')
            useSessionStore.getState().nextJukeboxSong()
          }}
          className="transition-[filter] duration-150 hover:brightness-110"
          style={{ ...actionStyle, background: ACCENT_GOLD, color: '#1a1405', border: 'none' }}
        >
          {t('songSelect.queue.play')}
        </button>
      )}
    </section>
  )
}
