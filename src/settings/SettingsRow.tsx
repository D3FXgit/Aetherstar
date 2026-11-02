import type { ReactNode } from 'react'
import { useSfx } from '../audio/useSfx'
import { ROW_CLASS, ROW_DESCRIPTION_CLASS, ROW_LABEL_CLASS } from './settingsStyles'

interface SettingsRowProps {
  label: ReactNode
  description?: ReactNode
  /** The trailing control (toggle, button, status text). */
  children?: ReactNode
  className?: string
}

/**
 * The value-changing row: label (+ optional secondary line) on the leading
 * side, the control that changes it on the trailing side. Every such row in
 * Settings uses this, so row height, padding and column alignment are
 * identical across panels instead of per-panel ad hoc flex.
 */
export function SettingsRow({ label, description, children, className }: SettingsRowProps) {
  return (
    <div className={[ROW_CLASS, className].filter(Boolean).join(' ')}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className={ROW_LABEL_CLASS}>{label}</span>
        {description ? <span className={ROW_DESCRIPTION_CLASS}>{description}</span> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  )
}

interface SettingsLinkRowProps {
  label: ReactNode
  description?: ReactNode
  /** The action this row performs, e.g. "Manage players". Doubles as the button's accessible name. */
  action: string
  onClick: () => void
}

/**
 * The navigational row: it leaves Settings for a full scene rather than
 * changing a value here, so it is one whole-row target with a chevron.
 */
export function SettingsLinkRow({ label, description, action, onClick }: SettingsLinkRowProps) {
  const playSfx = useSfx((state) => state.play)

  return (
    // A full-bleed row inside a clipped card, so it answers with a fill, not a scale.
    <button
      type="button"
      aria-label={action}
      // data-focus-inset: full-bleed row, so the shared focus ring is drawn
      // just inside rather than being clipped by the panel edge.
      data-focus-inset
      className={`${ROW_CLASS} group rounded-none transition-colors duration-150 hover:bg-surface-hover active:bg-surface-raised`}
      onMouseEnter={() => playSfx('hover')}
      onClick={() => {
        playSfx('click')
        onClick()
      }}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className={ROW_LABEL_CLASS}>{label}</span>
        {description ? <span className={ROW_DESCRIPTION_CLASS}>{description}</span> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[13px] font-medium text-ink-secondary transition-colors group-hover:text-ink-primary">{action}</span>
        <Chevron />
      </div>
    </button>
  )
}

function Chevron() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4 text-ink-tertiary transition-colors group-hover:text-ink-secondary"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}
