// A solid button for the session screens, audible like every button in the app.
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { useSfx } from '../audio/useSfx'
import type { SfxName } from '../audio/sfxContract'
import { BUTTON_HOVER_CLASS, SESSION_COLORS, TEXT, primaryButtonStyle, secondaryButtonStyle } from './sessionTheme'

interface SessionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` is the one action the screen is for; everything else is `secondary`. */
  tone?: 'primary' | 'secondary'
  /** Fill for a primary button -- a singer's colour, or the default accent. */
  color?: string
  sfx?: SfxName
}

export const SessionButton = forwardRef<HTMLButtonElement, SessionButtonProps>(function SessionButton(
  { tone = 'secondary', color, sfx = 'click', className, style, disabled, onClick, onMouseEnter, children, ...rest },
  ref,
) {
  const playSfx = useSfx((state) => state.play)
  const base =
    tone === 'primary'
      ? primaryButtonStyle(color, disabled ? { background: SESSION_COLORS.raised, color: TEXT.tertiary, cursor: 'not-allowed' } : undefined)
      : secondaryButtonStyle(disabled ? { color: TEXT.tertiary, cursor: 'not-allowed' } : undefined)
  return (
    <button
      ref={ref}
      disabled={disabled}
      className={[BUTTON_HOVER_CLASS, className].filter(Boolean).join(' ')}
      style={{ ...base, ...style }}
      onClick={(event) => {
        playSfx(sfx)
        onClick?.(event)
      }}
      onMouseEnter={(event) => {
        if (!disabled) playSfx('hover')
        onMouseEnter?.(event)
      }}
      {...rest}
    >
      {children}
    </button>
  )
})
