// The party draw's full-screen frame and header, shared by every state of the
// screen (loading, empty, the draw itself).
import type { ReactNode } from 'react'
import { useT } from '../../i18n'
import { BackButton } from '../../scenes/SceneHeader'
import { du } from '../../scenes/designUnits'
import { CARD_STYLE, SESSION_BACK_BUTTON_STYLE, TEXT, displayType, sessionScreenStyle } from '../sessionTheme'

export function PartyDrawFrame({ trailing, children }: { trailing?: ReactNode; children: ReactNode }) {
  const t = useT()
  return (
    // Exactly one window tall (not min-h-screen): the song gallery takes what
    // the header, singers and footer leave, so nothing is pushed off the bottom
    // -- the old grid's covers were, at any common window size.
    <div
      className="flex w-full flex-none flex-col overflow-hidden"
      style={sessionScreenStyle({ height: '100vh', padding: `${du(36)} ${du(64)} ${du(32)}`, gap: du(24) })}
      data-testid="session-party-draw"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between" style={{ gap: du(24) }}>
        <div className="flex items-center" style={{ gap: du(20) }}>
          <BackButton style={SESSION_BACK_BUTTON_STYLE} />
          <h1 style={displayType(48)}>{t('party.title')}</h1>
        </div>
        {trailing}
      </header>
      {children}
    </div>
  )
}

/** A centred message card: the loading and empty states. */
export function PartyNotice({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div
      className="m-auto flex flex-col items-center text-center"
      style={{ ...CARD_STYLE, padding: du(48), maxWidth: du(640), gap: du(16) }}
    >
      <h2 style={displayType(30)}>{title}</h2>
      {description && (
        <p style={{ fontSize: `max(1rem, ${du(19)})`, color: TEXT.secondary, lineHeight: 1.4 }}>{description}</p>
      )}
      {action && <div style={{ marginTop: du(12) }}>{action}</div>}
    </div>
  )
}
