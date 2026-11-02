// The full-screen frame every branch of the results screen renders into:
// Back, the song just sung, and a trailing slot for Skip.
import type { ReactNode } from 'react'
import { useT } from '../../i18n'
import { BackButton } from '../../scenes/SceneHeader'
import { du } from '../../scenes/designUnits'
import { SESSION_BACK_BUTTON_STYLE, TEXT, displayType, sessionScreenStyle } from '../sessionTheme'
import type { ResultsBeat } from '../resultsChoreography'

interface ResultsSurfaceProps {
  children: ReactNode
  beat?: ResultsBeat
  song?: { title: string; artist: string } | null
  trailing?: ReactNode
}

export function ResultsSurface({ children, beat, song, trailing }: ResultsSurfaceProps) {
  const t = useT()
  return (
    <div
      // In flow rather than `absolute inset-0`: SceneTransition serialises
      // in-flow scenes, and an overlay would also cover the mic-recovery and
      // abandon dialogs that must stay reachable.
      data-testid="session-results"
      data-beat={beat}
      className="relative flex w-full flex-col overflow-hidden"
      style={sessionScreenStyle({ height: '100dvh', padding: `${du(48)} ${du(64)} ${du(44)}`, gap: du(24) })}
    >
      <header className="relative flex w-full shrink-0 items-center justify-between" style={{ gap: du(24) }}>
        <div className="flex min-w-0 items-baseline" style={{ gap: du(20) }}>
          <span className="self-center">
            <BackButton style={SESSION_BACK_BUTTON_STYLE} />
          </span>
          {song && (
            <h1 className="truncate" style={displayType(44)}>
              {song.title}
            </h1>
          )}
          {song && (
            <span className="truncate" style={{ fontSize: `max(1rem, ${du(26)})`, fontWeight: 700, color: TEXT.secondary }}>
              {song.artist}
            </span>
          )}
          <span className="shrink-0" style={{ fontSize: `max(1rem, ${du(26)})`, fontWeight: 600, color: TEXT.tertiary }}>
            {t('results.title')}
          </span>
        </div>
        {/* Height reserved, so losing Skip never shifts the row. */}
        <div className="flex shrink-0 items-center justify-end" style={{ minHeight: du(48), minWidth: du(140) }}>
          {trailing}
        </div>
      </header>

      {children}
    </div>
  )
}
